#!/usr/bin/env python
"""既存の動き(UE マネキンの骨の数字)を VRM の正規化の骨へ移す。手付けはしない。
入力: dump_motion_ue.py が書く <name>.bin と _index.json。出力: clips/<name>.npz(局所の回転・腰の動き・足首の狙い)。
動きのデータは買った素材から作られるので、リポジトリの外へ書く。

使い方: retarget_clips.py --raw <フォルダ> --vrm <.vrm> --out <フォルダ> [--only 名前の一部,...]
"""
import argparse
import json
import pathlib

import numpy as np

from quat import q_conj, q_mul, q_rotate, q_from_to, q_normalize
from vrm_rest import read_rest

# VRM の骨 → 元の骨
SIDES = {'left': 'l', 'right': 'r'}
FINGERS = [('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Little', 'pinky')]
BONE_MAP = {'hips': 'pelvis', 'spine': 'spine_02', 'chest': 'spine_04', 'neck': 'neck_01', 'head': 'head'}
for vs, us in SIDES.items():
    BONE_MAP.update({
        f'{vs}Shoulder': f'clavicle_{us}', f'{vs}UpperArm': f'upperarm_{us}', f'{vs}LowerArm': f'lowerarm_{us}', f'{vs}Hand': f'hand_{us}',
        f'{vs}UpperLeg': f'thigh_{us}', f'{vs}LowerLeg': f'calf_{us}', f'{vs}Foot': f'foot_{us}', f'{vs}Toes': f'ball_{us}',
        f'{vs}ThumbMetacarpal': f'thumb_01_{us}', f'{vs}ThumbProximal': f'thumb_02_{us}', f'{vs}ThumbDistal': f'thumb_03_{us}',
    })
    for vf, uf in FINGERS:
        BONE_MAP.update({f'{vs}{vf}Proximal': f'{uf}_01_{us}', f'{vs}{vf}Intermediate': f'{uf}_02_{us}', f'{vs}{vf}Distal': f'{uf}_03_{us}'})


def limb_chain(vs):
    """向きをそろえる骨を親から順に: (骨, 向きを測る先の骨, そろえの土台にする骨)。胴・頭・足は休みの立ち方を残すのでそろえない"""
    chain = [
        (f'{vs}Shoulder', f'{vs}UpperArm', None),
        (f'{vs}UpperArm', f'{vs}LowerArm', None),
        (f'{vs}LowerArm', f'{vs}Hand', f'{vs}UpperArm'),
        (f'{vs}UpperLeg', f'{vs}LowerLeg', None),
        (f'{vs}LowerLeg', f'{vs}Foot', f'{vs}UpperLeg'),
        (f'{vs}ThumbMetacarpal', f'{vs}ThumbProximal', f'{vs}Hand'),
        (f'{vs}ThumbProximal', f'{vs}ThumbDistal', f'{vs}ThumbMetacarpal'),
    ]
    for f, _ in FINGERS:
        chain += [(f'{vs}{f}Proximal', f'{vs}{f}Intermediate', f'{vs}Hand'),
                  (f'{vs}{f}Intermediate', f'{vs}{f}Distal', f'{vs}{f}Proximal')]
    return chain


def to_vrm_quat(q):
    """UE(左手系・z 上・キャラは +y 向き)→ VRM(右手系・y 上・キャラは +z 向き)。座標は y と z の入れかえ"""
    return np.stack([-q[..., 0], -q[..., 2], -q[..., 1], q[..., 3]], axis=-1)


def to_vrm_pos(p):
    return np.stack([p[..., 0], p[..., 2], p[..., 1]], axis=-1) * 0.01


def hand_frame(hand, middle, index, little):
    x = middle - hand
    x = x / np.linalg.norm(x)
    side = index - little
    z = side - x * np.dot(side, x)
    z = z / np.linalg.norm(z)
    return np.stack([x, np.cross(z, x), z], axis=1)  # 列が軸


def mat_to_quat(m):
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1) * 2
        return np.array([(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s])
    i = int(np.argmax(np.diag(m)))
    j, k = (i + 1) % 3, (i + 2) % 3
    s = np.sqrt(1 + m[i, i] - m[j, j] - m[k, k]) * 2
    q = np.zeros(4)
    q[i] = 0.25 * s
    q[j] = (m[j, i] + m[i, j]) / s
    q[k] = (m[k, i] + m[i, k]) / s
    q[3] = (m[k, j] - m[j, k]) / s
    return q


def alignment(rest, src_pos):
    """T の姿勢の骨を、元の骨の休みの向きへ回す回転を骨ごとに作る"""
    identity = np.array([0.0, 0, 0, 1])
    align = {name: identity for name in BONE_MAP}
    for vs in SIDES:
        hand = f'{vs}Hand'
        ft = hand_frame(rest[hand], rest[f'{vs}MiddleProximal'], rest[f'{vs}IndexProximal'], rest[f'{vs}LittleProximal'])
        fs = hand_frame(*[src_pos[BONE_MAP[b]] for b in (hand, f'{vs}MiddleProximal', f'{vs}IndexProximal', f'{vs}LittleProximal')])
        align[hand] = mat_to_quat(fs @ ft.T)
        for bone, child, base_bone in limb_chain(vs):
            base = align[base_bone] if base_bone else identity
            d_t = q_rotate(base, rest[child] - rest[bone])
            d_s = src_pos[BONE_MAP[child]] - src_pos[BONE_MAP[bone]]
            align[bone] = q_normalize(q_mul(q_from_to(d_t, d_s), base))
        # 指先は、ひとつ手前の骨と同じ向きにそろえる
        for f, _ in FINGERS:
            align[f'{vs}{f}Distal'] = align[f'{vs}{f}Intermediate']
        align[f'{vs}ThumbDistal'] = align[f'{vs}ThumbProximal']
    return align


def retarget(info, data, rest, parents):
    names = info['bones']
    col = {b: i for i, b in enumerate(names)}
    arr = data.reshape(info['frames'], len(names), 7)
    ref_q = {b: to_vrm_quat(np.array(info['ref'][b][:4])) for b in names}
    ref_p = {b: to_vrm_pos(np.array(info['ref'][b][4:])) for b in names}
    align = alignment(rest, ref_p)

    world = {}
    for bone, src in BONE_MAP.items():
        s = to_vrm_quat(arr[:, col[src], :4])
        world[bone] = q_normalize(q_mul(q_mul(s, q_conj(ref_q[src])), align[bone]))

    local = {}
    for bone, w in world.items():
        p = parents.get(bone)
        local[bone] = w if p is None else q_normalize(q_mul(q_conj(world[p]), w))
        # 時間で符号が飛ばないようにそろえる(間を補うときに遠回りしない)
        q = local[bone]
        for i in range(1, len(q)):
            if np.dot(q[i - 1], q[i]) < 0:
                q[i] = -q[i]

    leg_t = np.linalg.norm(rest['leftUpperLeg'] - rest['leftLowerLeg']) + np.linalg.norm(rest['leftLowerLeg'] - rest['leftFoot'])
    leg_s = np.linalg.norm(ref_p['thigh_l'] - ref_p['calf_l']) + np.linalg.norm(ref_p['calf_l'] - ref_p['foot_l'])
    ratio = leg_t / leg_s
    hips = (to_vrm_pos(arr[:, col['pelvis'], 4:]) - ref_p['pelvis']) * ratio
    ankles = {}
    for vs, us in SIDES.items():
        ankles[vs] = rest[f'{vs}Foot'] + (to_vrm_pos(arr[:, col[f'foot_{us}'], 4:]) - ref_p[f'foot_{us}']) * ratio
    return local, hips, ankles, ratio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True)
    ap.add_argument('--vrm', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    raw = pathlib.Path(a.raw)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    index = json.loads((raw / '_index.json').read_text(encoding='utf-8'))
    rest, parents = read_rest(a.vrm)
    only = [s for s in a.only.split(',') if s]
    count = 0
    ratio = 0.0
    for name, info in index.items():
        if only and not any(s in name for s in only):
            continue
        data = np.fromfile(raw / f'{name}.bin', dtype='<f4').astype(np.float64)
        local, hips, ankles, ratio = retarget(info, data, rest, parents)
        np.savez_compressed(out / f'{name}.npz', hips=hips, ankleL=ankles['left'], ankleR=ankles['right'], ratio=ratio,
                            fps=info['fps'], **{f'q_{b}': q for b, q in local.items()})
        count += 1
    print(f'{count} 本を移しました。脚の比 {ratio:.3f}')


if __name__ == '__main__':
    main()
