"""E30 反復 1(CC5 を使わない先読み): E29r で撮った「モーフを ±0.2 動かした正面と斜め(side_match、約 50°)の絵」を、画像生成の手本と部位ごとに比べる。
モーフを 1 つ動かしたとき、手本との差(%IOD、手本の顔の点を基準)が基準(P3)より減るか増えるかを、全モーフ・両方向で出す。
= 写真判定の形の最適化のための「1 つずつの効き目の表」。正面は手本 f0 の 4 枚の平均、斜めは手本 q60 の 2 枚の平均(MediaPipe の限界に近いので参考)。
使い方: <mediapipe の venv の python> e30_scan.py     出力: eval_runs\\E30_base\\scan_moves.csv・scan_summary.md"""
import csv
import glob
import json
import os
import sys

import numpy as np

T = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, T)
import et_face as F  # noqa: E402

O = r"work\cc5_human_1102\eval_runs\E30_base"
LM = os.path.join(O, "lmk")
RUN = r"work\cc5_eval\E29r"
REG = ["eyes", "brows", "nose", "mouth", "outline", "all"]


def pts(path):
    d = F.detect_file(path)
    return np.asarray(d["pts3d"], float) if d.get("detected") else None


def refs(prefix):
    out = []
    for f in sorted(glob.glob(os.path.join(LM, f"gen_{prefix}*.lmk.json"))):
        d = json.load(open(f, encoding="utf-8"))
        if d.get("detected"):
            out.append(np.asarray(d["pts3d"], float))
    return out


RF, RS = refs("f0"), refs("q60")


def score(p, rl):
    rows = [F.region_distance(p, r, 2)[0] for r in rl]
    return {k: float(np.mean([r[k] for r in rows])) for k in REG}


def find(d, key):
    g = glob.glob(os.path.join(d, f"*{key}*.png"))
    g = [x for x in g if "warmup" not in x]
    return g[0] if g else None


base_dir = os.path.join(RUN, "base")
bf, bs = pts(find(base_dir, "front_match")), pts(find(base_dir, "side_match"))
b_front, b_side = score(bf, RF), score(bs, RS)
rows = [{"morph": "(基準 P3)", "sign": "", **{f"f_{k}": round(b_front[k], 3) for k in REG}, **{f"s_{k}": round(b_side[k], 3) for k in REG}}]
dirs = sorted(glob.glob(os.path.join(RUN, "j*", "*_plus")) + glob.glob(os.path.join(RUN, "j*", "*_minus")))
for d in dirs:
    name = os.path.basename(d)
    sign = "+" if name.endswith("_plus") else "-"
    morph = name.rsplit("_", 1)[0]
    ff, fs = find(d, "front_match"), find(d, "side_match")
    if not ff or not fs:
        continue
    pf, ps = pts(ff), pts(fs)
    if pf is None or ps is None:
        continue
    sf, ss = score(pf, RF), score(ps, RS)
    rows.append({"morph": morph, "sign": sign, **{f"f_{k}": round(sf[k] - b_front[k], 3) for k in REG}, **{f"s_{k}": round(ss[k] - b_side[k], 3) for k in REG}})
keys = ["morph", "sign"] + [f"f_{k}" for k in REG] + [f"s_{k}" for k in REG]
with open(os.path.join(O, "scan_moves.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=keys)
    w.writeheader()
    w.writerows(rows)

moves = rows[1:]
for r in moves:  # 主指標: 目 + 口(正面)、斜めは参考。負 = 手本に近づく
    r["J"] = round(r["f_eyes"] + r["f_mouth"], 3)
    r["J_all"] = round(r["f_all"], 3)
moves.sort(key=lambda r: r["J"])
md = [f"# E30 反復 1 の先読み(CC5 なし): モーフ ±0.2 の効き目(正面 = 手本 f0 の {len(RF)} 枚の平均、斜め = 手本 q60 の {len(RS)} 枚の平均、差は基準 P3 との %IOD の変化。負 = 手本に近づく)", "",
      f"基準 P3 の手本との差(%IOD): 正面 全体 {b_front['all']:.2f}(目 {b_front['eyes']:.2f}・口 {b_front['mouth']:.2f}・鼻 {b_front['nose']:.2f}・眉 {b_front['brows']:.2f}・輪郭 {b_front['outline']:.2f})、斜め 全体 {b_side['all']:.2f}",
      f"動かした物: {len(moves)} 通り(モーフ × 向き)。測りのゆらぎの目安: 手本の枚数の散らばり ±0.1〜0.2 %IOD(正面)。", "",
      "## 目 + 口が最も減る 12 通り(主指標 J = 正面の目の変化 + 口の変化)", "",
      "| モーフ | 向き | J | 全体 | 目 | 口 | 鼻 | 眉 | 輪郭 | 斜め 全体 |", "|---|---|---|---|---|---|---|---|---|---|"]
for r in moves[:12]:
    md.append(f"| {r['morph']} | {r['sign']} | {r['J']} | {r['f_all']} | {r['f_eyes']} | {r['f_mouth']} | {r['f_nose']} | {r['f_brows']} | {r['f_outline']} | {r['s_all']} |")
md += ["", "## 全体(正面)が最も減る 12 通り", "", "| モーフ | 向き | 全体 | 目 | 口 | 鼻 | 眉 | 輪郭 | 斜め 全体 |", "|---|---|---|---|---|---|---|---|---|"]
for r in sorted(moves, key=lambda r: r["J_all"])[:12]:
    md.append(f"| {r['morph']} | {r['sign']} | {r['f_all']} | {r['f_eyes']} | {r['f_mouth']} | {r['f_nose']} | {r['f_brows']} | {r['f_outline']} | {r['s_all']} |")
open(os.path.join(O, "scan_summary.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
print("\n".join(md[:8]))
print(len(moves), "moves")
