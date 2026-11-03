"""E30: 効きの行列を SVD して、画像から区別できない方向と、他の部位へ漏れる方向を見つける(部位のブロック回しの準備、CC5 不要)。
入力: eval_runs\\E30_base\\scan_moves.csv(E29r で撮った ±0.2 の絵を手本と比べた表。モーフごとの、部位 5 つ × 正面・斜め(約 50°)の変化)。
行 = 測り(正面の 目・眉・鼻・口・輪郭 と 斜めの 全体)、列 = モーフ。1 モーフの効き = (+側の変化 − −側の変化)/2(符号は向き)。
出力: eval_runs\\E30_base\\svd_morphs.md(特異値、モーフごとの主な部位・効きの大きさ・漏れ率、ブロックごとの候補)。"""
import csv
import json

import numpy as np

E = r"work\cc5_human_1102\eval_runs\E30_base"
rows = list(csv.DictReader(open(E + r"\scan_moves.csv", encoding="utf-8")))[1:]
REG = ["eyes", "brows", "nose", "mouth", "outline"]
meas = [f"f_{k}" for k in REG] + ["s_all"]
per = {}
for r in rows:
    per.setdefault(r["morph"], {})[r["sign"]] = np.array([float(r[m]) for m in meas])
names, cols = [], []
for m, d in per.items():
    if "+" in d and "-" in d:
        names.append(m)
        cols.append((d["+"] - d["-"]) / 2.0)
A = np.array(cols).T  # 測り × モーフ
U, S, Vt = np.linalg.svd(A, full_matrices=False)
md = ["# E30 効きの行列の SVD(正面の目・眉・鼻・口・輪郭 と 斜めの全体 × モーフ、効き = (+ − −)/2、%IOD ÷ 0.2)", "",
      "特異値: " + ", ".join(f"{s:.2f}" for s in S), "",
      f"モーフ数 {A.shape[1]}、測り {A.shape[0]}。特異値が最大の約 5% 未満の方向は「画像から区別できない」。この表では最小の特異値 / 最大 = {S[-1] / S[0]:.3f}。", ""]
# 部位ごとの主な動き
info = []
for j, n in enumerate(names):
    v = A[:, j]
    a = np.abs(v[:5])
    k = int(np.argmax(a))
    tot = float(np.abs(v[:5]).sum()) + 1e-9
    leak = 1.0 - a[k] / tot
    info.append({"morph": n, "main": REG[k], "size": float(a[k]), "leak": float(leak), "effects": [round(float(x), 3) for x in v]})
md += ["## ブロックごとの候補(主な部位がそのブロック、効きが0.04 以上、漏れ率 70% 未満)", ""]
cand = {}
for k in REG:
    lst = sorted([i for i in info if i["main"] == k and i["size"] >= 0.04 and i["leak"] < 0.7], key=lambda i: -i["size"])
    cand[k] = [i["morph"] for i in lst]
    md += [f"### {k}({len(lst)} 個)", "", "| モーフ | 効き(その部位) | 漏れ率 | 効きの行(目・眉・鼻・口・輪郭・斜め全体) |", "|---|---|---|---|"]
    for i in lst[:10]:
        md.append(f"| {i['morph']} | {i['size']:.2f} | {i['leak']:.0%} | {i['effects']} |")
    md.append("")
mix = [i for i in info if i["size"] >= 0.04 and i["leak"] >= 0.7]
md += [f"## 漏れが大きいモーフ(漏れ率 70% 以上、{len(mix)} 個): ブロックでは動かさない", "", ", ".join(i["morph"] for i in mix[:20])]
open(E + r"\svd_morphs.md", "w", encoding="utf-8").write("\n".join(md) + "\n")
json.dump(cand, open(E + r"\block_candidates.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n".join(md[:16]))
print({k: len(v) for k, v in cand.items()}, "mix", len(mix))
