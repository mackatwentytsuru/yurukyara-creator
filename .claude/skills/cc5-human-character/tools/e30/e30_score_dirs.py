"""E30 の自動の最適化の測り(mediapipe の venv で動く): 撮った絵のフォルダ(各フォルダに rz+000・rz-035・rz-060 の 3 枚)を、手本(画像生成 の G1・G2、角度ごとの複数枚)と
顔の点の部位別の差(%IOD)で測り、JSON にする。入力は dirs の一覧(JSON)、出力は out の JSON。
手本の顔の点は eval_runs\\E30_base\\lmk\\gen_*.lmk.json(f0 = 正面、q35 = 約 30°、q60 = 約 50°)。
使い方: <venv python> e30_score_dirs.py --dirs dirs.json --out scores.json"""
import argparse
import glob
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import et_face as F  # noqa: E402

LM = r"work\cc5_human_1102\eval_runs\E30_base\lmk"
REG = ["eyes", "brows", "nose", "mouth", "outline", "all"]
ap = argparse.ArgumentParser()
ap.add_argument("--dirs", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args()


def refs(prefix):
    out = []
    for f in sorted(glob.glob(os.path.join(LM, f"gen_{prefix}*.lmk.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if d.get("detected"):
            out.append(np.asarray(d["pts3d"], float))
    return out


R = {"0": refs("f0"), "30": refs("q35"), "50": refs("q60")}
PAT = {"0": "*rz+000*", "30": "*rz-035*", "50": "*rz-060*"}
res = {}
for d in json.load(open(a.dirs, encoding="utf-8")):
    res[d] = {}
    for ang, pat in PAT.items():
        g = [x for x in glob.glob(os.path.join(d, pat + ".png")) if "warmup" not in x]
        if not g:
            res[d][ang] = None
            continue
        det = F.detect_file(g[0])
        if not det.get("detected"):
            res[d][ang] = None
            continue
        p = np.asarray(det["pts3d"], float)
        rows = [F.region_distance(p, r, 2)[0] for r in R[ang]]
        # 手本の一部を確かめ用に残す(過剰な合わせを見張る): 偶数番目 = 合わせに使う(fit)、奇数番目 = 確かめ(hold)。1 枚だけの角度は fit のみ
        fit = [r for i, r in enumerate(rows) if i % 2 == 0] if len(rows) > 1 else rows
        hold = [r for i, r in enumerate(rows) if i % 2 == 1]
        res[d][ang] = {k: float(np.mean([r[k] for r in fit])) for k in REG}
        res[d][ang]["_hold"] = {k: float(np.mean([r[k] for r in hold])) for k in REG} if hold else None
        res[d][ang]["_all_refs"] = {k: float(np.mean([r[k] for r in rows])) for k in REG}
json.dump(res, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
print("scored", len(res))
