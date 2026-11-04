#!/usr/bin/env python
"""並べた動き(assemble_track.py の出力)から、足の床からの高さ(cm)をコマごとに出す。合成の --foot-height に渡す。

使い方: foot_heights.py --track <頭> --vrm <.vrm> --start 秒 --count コマ数 [--fps 30] --out <json>
出力: {"0": cm, "1": cm, ...}(合成のコマ番号。0 が --start の秒)。高さは左右の足首とつま先の付け根のうち一番低い所。
"""
import argparse
import json
import pathlib

import numpy as np

from quat import q_mul, q_rotate
from vrm_rest import read_rest


class TrackFeet:
    def __init__(self, prefix, vrm):
        head = json.loads(pathlib.Path(str(prefix) + '.json').read_text(encoding='utf-8'))
        self.data = np.fromfile(str(prefix) + '.bin', dtype='<f4').reshape(head['frames'], -1).astype(np.float64)
        self.fps, self.first = head['fps'], head['first']
        self.col = {b: i for i, b in enumerate(head['bones'])}
        self.rest, self.parents = read_rest(vrm)

    def world(self, row, bone):
        chain = []
        b = bone
        while b is not None:
            chain.append(b)
            b = self.parents.get(b)
        chain.reverse()
        pos = self.rest['hips'] + row[:3]
        w = np.array([0.0, 0, 0, 1])
        for i, name in enumerate(chain):
            if i > 0:
                pos = pos + q_rotate(w, self.rest[name] - self.rest[chain[i - 1]])
            c = self.col[name]
            w = q_mul(w, row[3 + 4 * c: 7 + 4 * c])
        return pos

    def low_cm(self, t):
        """t 秒の足の一番低い所の床からの高さ(cm)。60 コマの間は直線で補う。"""
        x = t * self.fps - self.first
        i = int(np.clip(np.floor(x), 0, len(self.data) - 2))
        k = float(np.clip(x - i, 0.0, 1.0))
        vals = []
        for j in (i, i + 1):
            row = self.data[j]
            vals.append(min(self.world(row, f'{s}{p}')[1] - self.rest[f'{s}{p}'][1]
                            for s in ('left', 'right') for p in ('Foot', 'Toes')) * 100.0)
        return vals[0] * (1 - k) + vals[1] * k


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--track', required=True)
    ap.add_argument('--vrm', required=True)
    ap.add_argument('--start', type=float, required=True)
    ap.add_argument('--count', type=int, required=True)
    ap.add_argument('--fps', type=float, default=30.0)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    feet = TrackFeet(a.track, a.vrm)
    out = {str(i): round(feet.low_cm(a.start + i / a.fps), 2) for i in range(a.count)}
    pathlib.Path(a.out).write_text(json.dumps(out), encoding='utf-8')
    values = list(out.values())
    print(f'{len(values)} コマ。足の高さの最大 {max(values):.1f} cm')


if __name__ == '__main__':
    main()
