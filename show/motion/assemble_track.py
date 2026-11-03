#!/usr/bin/env python
"""移した動きを、曲の拍に沿って並べて 1 本の動きにする。足りない所(つなぎ・足の接地)だけ計算で足す。
使い方: assemble_track.py --plan <案.json> --clips <フォルダ> --timeline <timeline.json> --vrm <.vrm> --out <出力の頭>
出力: <頭>.bin(float32。コマ × [腰の x y z, 骨ごとの x y z w])と <頭>.json(骨の並び・コマの範囲)

案の形: {"from_sec": 58, "to_sec": 82.4, "segments": [ {"clip": 名前, "beat": 開始の拍(timeline の beats の番号), "beats": 拍数,
  "clip_from": 秒, "clip_to": 秒, "fade_beats": 1} ... ]}
秒で置くときは "at_sec" と "speed"(既定 1)を書く。"beat" と "beats" を書けば、clip_from から clip_to までがその拍数にちょうど入る。
"""
import argparse
import json
import pathlib

import numpy as np

from body_fix import BodyFix
from quat import q_conj, q_from_to, q_mul, q_nlerp, q_normalize, q_rotate
from vrm_rest import read_rest


class Clip:
    def __init__(self, path):
        z = np.load(path)
        self.fps = float(z['fps'])
        self.hips = z['hips']
        self.ankle = {'left': z['ankleL'], 'right': z['ankleR']}
        self.q = {k[2:]: z[k] for k in z.files if k.startswith('q_')}
        self.n = len(self.hips)
        self.length = (self.n - 1) / self.fps

    def sample(self, t):
        x = min(max(t, 0.0), self.length) * self.fps
        i = min(int(x), self.n - 2) if self.n > 1 else 0
        k = x - i
        i2 = min(i + 1, self.n - 1)
        q = {b: q_nlerp(v[i], v[i2], k) for b, v in self.q.items()}
        return {
            'q': q,
            'hips': self.hips[i] * (1 - k) + self.hips[i2] * k,
            'left': self.ankle['left'][i] * (1 - k) + self.ankle['left'][i2] * k,
            'right': self.ankle['right'][i] * (1 - k) + self.ankle['right'][i2] * k,
        }


def smooth(k):
    k = min(max(k, 0.0), 1.0)
    return k * k * (3 - 2 * k)


def blend(a, b, k):
    return {
        'q': {n: q_nlerp(a['q'][n], b['q'][n], k) for n in a['q']},
        'hips': a['hips'] * (1 - k) + b['hips'] * k,
        'left': a['left'] * (1 - k) + b['left'] * k,
        'right': a['right'] * (1 - k) + b['right'] * k,
    }


def beat_time(beats, b):
    """拍の番号 → 秒。端の外は同じ間隔でのばす。小数の拍も使える"""
    beats = np.asarray(beats)
    i = int(np.floor(b))
    if i < 0:
        return beats[0] + b * (beats[1] - beats[0])
    if i >= len(beats) - 1:
        return beats[-1] + (b - (len(beats) - 1)) * (beats[-1] - beats[-2])
    return beats[i] + (b - i) * (beats[i + 1] - beats[i])


def time_beat(beats, t):
    beats = np.asarray(beats)
    if t <= beats[0]:
        return (t - beats[0]) / (beats[1] - beats[0])
    if t >= beats[-1]:
        return len(beats) - 1 + (t - beats[-1]) / (beats[-1] - beats[-2])
    i = int(np.searchsorted(beats, t, side='right')) - 1
    return i + (t - beats[i]) / (beats[i + 1] - beats[i])


def make_segments(plan, clips, beats):
    out = []
    for s in plan['segments']:
        clip = clips[s['clip']]
        c0 = s.get('clip_from', 0.0)
        c1 = s.get('clip_to', clip.length)
        if 'beat' in s:
            b0, nb = s['beat'], s['beats']
            start, end = beat_time(beats, b0), beat_time(beats, b0 + nb)
            fade = s.get('fade_beats', 1) * (beats[1] - beats[0])
            clock = (lambda c0, c1, b0, nb: lambda t: c0 + (time_beat(beats, t) - b0) / nb * (c1 - c0))(c0, c1, b0, nb)
        else:
            start = s['at_sec']
            speed = s.get('speed', 1.0)
            end = s.get('end_sec', start + (c1 - c0) / speed)
            fade = s.get('fade_sec', 0.4)
            clock = (lambda c0, speed, start: lambda t: c0 + (t - start) * speed)(c0, speed, start)
        out.append({'clip': clip, 'start': start, 'end': end, 'fade': fade, 'clock': clock, 'name': s['clip']})
    return out


class Legs:
    """足首の狙いへ脚を合わせる。太ももと足の向きは動きのまま残す"""

    def __init__(self, rest, parents):
        self.rest = rest
        self.parents = parents

    def world_of(self, pose, bone):
        chain = []
        b = bone
        while b is not None:
            chain.append(b)
            b = self.parents.get(b)
        w = np.array([0.0, 0, 0, 1])
        for name in reversed(chain):
            w = q_mul(w, pose['q'][name])
        return w

    def solve(self, pose):
        q = dict(pose['q'])
        hips_pos = self.rest['hips'] + pose['hips']
        w_hips = q['hips']
        out = {'q': q, 'hips': pose['hips']}
        reach_fail = 0.0
        for side in ('left', 'right'):
            up, lo, ft = f'{side}UpperLeg', f'{side}LowerLeg', f'{side}Foot'
            v1 = self.rest[lo] - self.rest[up]
            v2 = self.rest[ft] - self.rest[lo]
            l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
            hip = hips_pos + q_rotate(w_hips, self.rest[up] - self.rest['hips'])
            w_thigh = q_mul(w_hips, q[up])
            w_calf = q_mul(w_thigh, q[lo])
            w_foot = q_mul(w_calf, q[ft])
            target = pose[side]
            knee_fk = hip + q_rotate(w_thigh, v1)
            d_vec = target - hip
            d = np.linalg.norm(d_vec)
            limit = (l1 + l2) * 0.9995
            if d > limit:
                reach_fail = max(reach_fail, d - limit)
                d_vec = d_vec / d * limit
                d = limit
                target = hip + d_vec
            axis = d_vec / d
            a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
            h = np.sqrt(max(l1 * l1 - a * a, 0.0))
            pole = knee_fk - hip
            pole = pole - axis * np.dot(pole, axis)
            n = np.linalg.norm(pole)
            pole = pole / n if n > 1e-5 else q_rotate(w_hips, np.array([0.0, 0, 1]))
            knee = hip + axis * a + pole * h
            w_thigh2 = q_normalize(q_mul(q_from_to(q_rotate(w_thigh, v1), knee - hip), w_thigh))
            w_calf2 = q_mul(w_thigh2, q[lo])
            w_calf2 = q_normalize(q_mul(q_from_to(q_rotate(w_calf2, v2), target - knee), w_calf2))
            q[up] = q_normalize(q_mul(q_conj(w_hips), w_thigh2))
            q[lo] = q_normalize(q_mul(q_conj(w_thigh2), w_calf2))
            q[ft] = q_normalize(q_mul(q_conj(w_calf2), w_foot))
        out['reach_fail'] = reach_fail
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', required=True)
    ap.add_argument('--clips', required=True)
    ap.add_argument('--timeline', required=True)
    ap.add_argument('--vrm', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    plan = json.loads(pathlib.Path(a.plan).read_text(encoding='utf-8'))
    timeline = json.loads(pathlib.Path(a.timeline).read_text(encoding='utf-8'))
    rest, parents = read_rest(a.vrm)
    fps = timeline['fps']
    beats = timeline['beats']
    names = {s['clip'] for s in plan['segments']}
    clips = {n: Clip(pathlib.Path(a.clips) / f'{n}.npz') for n in names}
    segments = make_segments(plan, clips, beats)
    bones = sorted(next(iter(clips.values())).q)
    first = round(plan['from_sec'] * fps)
    last = round(plan['to_sec'] * fps)
    legs = Legs(rest, parents)
    fix = BodyFix(rest, parents)
    frames = []
    worst_reach = 0.0
    face_fix = 0.0
    for f in range(first, last):
        t = f / fps
        cur = None
        for i, s in enumerate(segments):
            if s['start'] <= t:
                cur = i
        cur = 0 if cur is None else cur
        s = segments[cur]
        pose = s['clip'].sample(s['clock'](t))
        if cur > 0 and t - s['start'] < s['fade']:
            p = segments[cur - 1]
            pose = blend(p['clip'].sample(p['clock'](t)), pose, smooth((t - s['start']) / s['fade']))
        solved = legs.solve(pose)
        worst_reach = max(worst_reach, solved['reach_fail'])
        face_fix = max(face_fix, fix.limit_face(solved['q'], solved['hips']))
        frames.append(solved)
    push_most, push_frames = fix.fix_hands(frames)
    out = np.zeros((last - first, 3 + 4 * len(bones)), dtype=np.float32)
    for i, solved in enumerate(frames):
        row = [*solved['hips']]
        for b in bones:
            row += list(solved['q'][b])
        out[i] = row
    prefix = pathlib.Path(a.out)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    out.tofile(str(prefix) + '.bin')
    head = {'fps': fps, 'first': first, 'frames': last - first, 'bones': bones}
    pathlib.Path(str(prefix) + '.json').write_text(json.dumps(head), encoding='utf-8')

    # 跳びの点検: 1 コマの回転の最大(度)
    q = out[:, 3:].reshape(len(out), len(bones), 4)
    dots = np.abs(np.sum(q[1:] * q[:-1], axis=-1)).clip(0, 1)
    jump = np.degrees(2 * np.arccos(dots))
    worst = np.unravel_index(np.argmax(jump), jump.shape)
    print(f'{len(out)} コマ。足が届かなかった最大 {worst_reach * 100:.1f} cm。顔の向きを戻した最大 {np.degrees(face_fix):.0f}°。手を顔から押し出した最大 {push_most * 100:.1f} cm({push_frames} コマ)。1 コマの回転の最大 {jump.max():.1f}° ({bones[worst[1]]}、{(first + worst[0]) / fps:.2f} 秒)')


if __name__ == '__main__':
    main()
