"""E30: 計算の測り(e30_metrics.py)を、答えの分かる組で確かめる。採用の条件: 答えの分かる組で当たる(向きが合う)・差が手本のゆらぎより大きい。
正面の組(手本 = 画像生成 の G1・G2 の 4 枚、f0_G1・f0_G1_2・f0_G1_3・f0_G2):
  P3(基準)/ 同じ手本(0 のはず)/ 目を大きくした CG(目の部位が P3 より悪いはず)/ あごを変えた CG(あご・輪郭が P3 より悪いはず)。
さらに E30 反復 1 の候補(S_all・S_em)を同じ測りで並べる(部位の数字との一致を見る)。
出力: eval_runs\\E30_base\\metrics_validate.md"""
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e30_metrics as M  # noqa: E402

E = r"work\cc5_human_1102\eval_runs"
EF = E + r"\EREF"
FG, FC = EF + r"\flat_g", EF + r"\flat_cg"
REFS = [FG + r"\gen_f0_G1.png", FC + r"\gen_f0_G1_2.png", FC + r"\gen_f0_G1_3.png", FG + r"\gen_f0_G2.png"]
CANDS = {"P3": FG + r"\cg_f0_G1.png", "eye6": FC + r"\cg_circ_eye6_G1a.png", "jaw1": FC + r"\cg_circ_jaw1_G1a.png"}
I1 = r"work\cc5_eval\E30i1"
KEYS = ["eyes", "brows", "nose", "mouth", "outline", "all"]
res = {}
for cn, cp in CANDS.items():
    per = [M.compare(r, cp) for r in REFS]
    res[cn] = {m: {k: (float(np.mean([p[m][k] for p in per])), float(np.std([p[m][k] for p in per]))) for k in per[0][m]} for m in per[0]}
# 手本どうし(同じ人でも別の生成): 手本 1 と手本 2〜4 の差 = 手本のゆらぎの大きさ
per = [M.compare(REFS[0], r) for r in REFS[1:]]
spread = {m: {k: float(np.mean([p[m][k] for p in per])) for k in per[0][m]} for m in per[0]}
md = ["# E30 の計算の測りの確かめ(答えの分かる組、正面、手本 4 枚の平均 ± 散らばり、小さいほど似ている)", "",
      "「手本どうし」= 手本 1 と手本 2〜4 の差(別の生成どうしの差 = 測りの下限の目安)。", ""]
verdict = []
for m, label in (("lm", "顔の点(%IOD)"), ("hog", "HOG(形の線)"), ("ssim", "1 − SSIM(濃淡の構造)"), ("sil", "輪郭の面 1 − IoU")):
    md += [f"## {label}", "", "| 部位 | P3 | 目を大きくした CG | あごを変えた CG | 手本どうし |", "|---|---|---|---|---|"]
    for k in KEYS:
        if k not in res["P3"][m]:
            continue
        f = lambda c: f"{res[c][m][k][0]:.3f} ± {res[c][m][k][1]:.3f}"  # noqa: E731
        md.append(f"| {k} | {f('P3')} | {f('eye6')} | {f('jaw1')} | {spread[m][k]:.3f} |")
    md.append("")
    eye_ok = res["eye6"][m]["eyes"][0] > res["P3"][m]["eyes"][0] if "eyes" in res["P3"][m] else None
    jaw_ok = res["jaw1"][m]["outline"][0] > res["P3"][m]["outline"][0]
    eye_gap = (res["eye6"][m]["eyes"][0] - res["P3"][m]["eyes"][0]) / max(1e-9, spread[m]["eyes"]) if "eyes" in res["P3"][m] else None
    jaw_gap = (res["jaw1"][m]["outline"][0] - res["P3"][m]["outline"][0]) / max(1e-9, spread[m]["outline"])
    verdict.append((label, eye_ok, eye_gap, jaw_ok, jaw_gap))
md += ["## 答えの分かる組での当たり", "", "| 測り | 目を大きくした CG で目が悪化(当たり?) | その差 / 手本どうしの差 | あごを変えた CG で輪郭が悪化(当たり?) | その差 / 手本どうしの差 |", "|---|---|---|---|---|"]
for label, eo, eg, jo, jg in verdict:
    md.append(f"| {label} | {'当たり' if eo else ('外れ' if eo is not None else '—')} | {('%.2f' % eg) if eg is not None else '—'} | {'当たり' if jo else '外れ'} | {jg:.2f} |")
# 反復 1 の候補
md += ["", "## 反復 1 の候補を同じ測りで(正面、手本 4 枚の平均、基準との差、負 = 良くなった)", "", "| 候補 | 測り | 全体 | 目 | 眉 | 鼻 | 口 | 輪郭 |", "|---|---|---|---|---|---|---|---|"]
base = None
for cn in ("base", "S_all", "S_em"):
    p = [x for x in glob.glob(os.path.join(I1, cn, "*front_fine*.png")) if "warmup" not in x][0]
    per = [M.compare(r, p) for r in REFS]
    cur = {m: {k: float(np.mean([q[m][k] for q in per])) for k in per[0][m]} for m in per[0]}
    if cn == "base":
        base = cur
    for m in ("lm", "hog", "ssim"):
        d = lambda k: f"{cur[m][k]:.3f}" + ("" if cn == "base" else f" ({cur[m][k] - base[m][k]:+.3f})")  # noqa: E731
        md.append(f"| {cn} | {m} | " + " | ".join(d(k) for k in ("all", "eyes", "brows", "nose", "mouth", "outline")) + " |")
open(E + r"\E30_base\metrics_validate.md", "w", encoding="utf-8").write("\n".join(md) + "\n")
print("\n".join(md))
