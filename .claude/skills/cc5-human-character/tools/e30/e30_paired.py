"""E30: 候補と基準の「同じ手本どうしの差」(対の差)を手本 1 枚ごとに出し、平均と散らばりを見る。
同じ手本・同じ撮り方でそろえた比べ(司令塔の指示 11-03)。効いたと言う下限 = max(撮影のゆらぎ、手本ごとの対の差の散らばり)。"""
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import et_face as F  # noqa: E402

LM = r"work\cc5_human_1102\eval_runs\E30_base\lmk"
I1 = r"work\cc5_eval\E30i1"
REG = ["eyes", "mouth", "nose", "brows", "outline", "all"]


def refs(prefix):
    out = []
    for f in sorted(glob.glob(os.path.join(LM, f"gen_{prefix}*.lmk.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if d.get("detected"):
            out.append((os.path.basename(f)[4:-9], np.asarray(d["pts3d"], float)))
    return out


R = {"0": refs("f0"), "30": refs("q35"), "50": refs("q60")}
PAT = {"0": "*front_fine*", "30": "*rz-035*", "50": "*rz-060*"}


def pts(cn, ang):
    p = [x for x in glob.glob(os.path.join(I1, cn, PAT[ang] + ".png")) if "warmup" not in x][0]
    return np.asarray(F.detect_file(p)["pts3d"], float)


out = ["# E30 反復 1: 手本 1 枚ごとの対の差(候補 − 基準、%IOD、負 = 良くなった)。手本は同じ・撮り方も同じ", "",
       "| 候補 | 角度 | 手本の数 | 全体 平均 ± 散らば り | 目 | 口 | 鼻 | 眉 | 輪郭 |", "|---|---|---|---|---|---|---|---|---|"]
for cn in ("S_all", "S_em"):
    for ang in ("0", "30", "50"):
        b, c = pts("base", ang), pts(cn, ang)
        deltas = {k: [] for k in REG}
        for _, r in R[ang]:
            tb = F.region_distance(b, r, 2)[0]
            tc = F.region_distance(c, r, 2)[0]
            for k in REG:
                deltas[k].append(tc[k] - tb[k])
        cell = lambda k: f"{np.mean(deltas[k]):+.2f} ± {np.std(deltas[k]):.2f}"  # noqa: E731
        out.append(f"| {cn} | {ang}° | {len(R[ang])} | {cell('all')} | " + " | ".join(cell(k) for k in ("eyes", "mouth", "nose", "brows", "outline")) + " |")
open(r"work\cc5_human_1102\eval_runs\E30_base\iter1_paired.md", "w", encoding="utf-8").write("\n".join(out) + "\n")
print("\n".join(out))
