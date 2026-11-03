"""E30 の最初の測り(反復 0): 頭まっすぐ(rx 0)の CC5 の絵 = P3 を、画像生成の手本(EREF の視線指定つきの G1・G2)と同じ角度で並べ、
部位ごとの 2D の数字(目・眉・鼻・口・輪郭。手本の顔の点を基準、%IOD)を出し、確認シートを作る。
使い方: <mediapipe の venv の python> e30_base.py     出力: eval_runs\\E30_base\\ (base_scores.csv・base_scores.md・sheet_base.png)
数字は「手本との差」なので小さいほど似ている。手本は生成物(画像生成)で、写真ではない点に注意(EREF の循環の確認は eref_circ_g.py)。"""
import csv
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

T = os.path.dirname(os.path.abspath(__file__))
E = r"work\cc5_human_1102\eval_runs\EREF"
O = r"work\cc5_human_1102\eval_runs\E30_base"
LM = os.path.join(O, "lmk")
os.makedirs(LM, exist_ok=True)
FG, FC = os.path.join(E, "flat_g"), os.path.join(E, "flat_cg")


def pick(*c):
    for p in c:
        if os.path.isfile(p):
            return p
    raise FileNotFoundError(c[0])


JOBS = [  # (角度, 名前, CG の絵, 手本の絵)
    ("f0", "f0_G1", pick(FG + r"\cg_f0_G1.png"), pick(FG + r"\gen_f0_G1.png")),
    ("f0", "f0_G1_2", pick(FG + r"\cg_f0_G1.png"), pick(FC + r"\gen_f0_G1_2.png")),
    ("f0", "f0_G1_3", pick(FG + r"\cg_f0_G1.png"), pick(FC + r"\gen_f0_G1_3.png")),
    ("f0", "f0_G2", pick(FG + r"\cg_f0_G2.png"), pick(FG + r"\gen_f0_G2.png")),
    ("q35", "q35_G1", pick(FG + r"\cg_q35_G1.png"), pick(FG + r"\gen_q35_G1.png")),
    ("q35", "q35_G2", pick(FG + r"\cg_q35_G2.png"), pick(FG + r"\gen_q35_G2.png")),
    ("q60", "q60_G1", pick(FG + r"\cg_q60_G1.png"), pick(FG + r"\gen_q60_G1.png")),
    ("q60", "q60_G2", pick(FG + r"\cg_q60_G2.png"), pick(FG + r"\gen_q60_G2.png")),
]
REG = ["eyes", "brows", "nose", "mouth", "outline", "all"]

# 1 顔の点
imgs = []
for _, n, cg, gen in JOBS:
    for tag, p in (("cg_", cg), ("gen_", gen)):
        dst = os.path.join(O, tag + n + ".png")
        Image.open(p).convert("RGB").save(dst)
        imgs.append(dst)
r = subprocess.run([sys.executable, os.path.join(T, "et_face.py"), "detect", "--images"] + imgs + ["--out", LM], capture_output=True, text=True)
rows = []
for a, n, cg, gen in JOBS:
    ref, cand = os.path.join(LM, "gen_" + n + ".lmk.json"), os.path.join(LM, "cg_" + n + ".lmk.json")
    row = {"angle": a, "job": n}
    if os.path.isfile(ref) and os.path.isfile(cand):
        out = os.path.join(O, f"pair_{n}.csv")
        subprocess.run([sys.executable, os.path.join(T, "et_face.py"), "pair", "--ref", ref, "--cand", cand, "--out", out], capture_output=True, text=True)
        if os.path.isfile(out):
            for mode in csv.DictReader(open(out, encoding="utf-8")):
                if mode.get("mode") in ("2d", "3d"):
                    for k in REG:
                        row[f"{mode['mode']}_{k}"] = round(float(mode[k]), 3)
    rows.append(row)
keys = ["angle", "job"] + [f"{m}_{k}" for m in ("2d", "3d") for k in REG]
with open(os.path.join(O, "base_scores.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)

# 角度ごとの平均(複数枚)
md = ["# E30 反復 0: P3(頭まっすぐ rx 0)と 画像生成の手本の部位別の差(%IOD、手本の顔の点を基準。小さいほど似ている)", "",
      "| 角度 | 枚数 | 目 | 眉 | 鼻 | 口 | 輪郭 | 全体 | (3D モード 全体) |", "|---|---|---|---|---|---|---|---|---|"]
for a in ("f0", "q35", "q60"):
    rs = [r for r in rows if r["angle"] == a and "2d_all" in r]
    if not rs:
        md.append(f"| {a} | 0 | 測れない |||||||")
        continue
    m = lambda k: f"{np.mean([r[k] for r in rs]):.2f} ± {np.std([r[k] for r in rs]):.2f}" if len(rs) > 1 else f"{rs[0][k]:.2f}"  # noqa: E731
    md.append(f"| {a} | {len(rs)} | " + " | ".join(m(f"2d_{k}") for k in REG) + f" | {m('3d_all')} |")
md += ["", "真横(s90)は顔の点が取れないので数字なし(絵と判定だけ)。", "", "個別:", "", "| 名前 | " + " | ".join(REG) + " |", "|---|" + "---|" * len(REG)]
for r in rows:
    md.append(f"| {r['job']} | " + " | ".join(str(r.get(f"2d_{k}", "")) for k in REG) + " |")
open(os.path.join(O, "base_scores.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")

# 2 確認シート: 行 = 角度、列 = CG | 手本 G1 | 手本 G2
FONT = None
for fp in (r"C:\Windows\Fonts\meiryo.ttc", r"C:\Windows\Fonts\YuGothM.ttc", r"C:\Windows\Fonts\msgothic.ttc"):
    if os.path.isfile(fp):
        FONT = fp
        break
cell = 400
rowsdef = [("正面 0°", "f0_G1", "f0_G2"), ("斜め 35°", "q35_G1", "q35_G2"), ("斜め 60°", "q60_G1", "q60_G2")]
s90cg = os.path.join(E, "cc5", "004_side_yaw_rx+00_rz-090.png")
s90g = os.path.join(E, "sheet2", "gaze_s90.png")
W, H = cell * 3 + 40, (cell + 70) * (len(rowsdef) + 1) + 70
sheet = Image.new("RGB", (W, H), (245, 245, 245))
d = ImageDraw.Draw(sheet)
fb = ImageFont.truetype(FONT, 34) if FONT else ImageFont.load_default()
fs = ImageFont.truetype(FONT, 30) if FONT else ImageFont.load_default()
d.text((20, 15), "E30 反復 0: 今の CC5(P3)と 画像生成の手本(視線は前を向く指定)", font=fb, fill=(0, 0, 0))
heads = ["今の CC5(P3、rx 0)", "画像生成の手本 1", "画像生成の手本 2"]
y = 70
for i, h in enumerate(heads):
    d.text((20 + i * (cell + 0), y), h, font=fs, fill=(0, 0, 120))
y += 45
for title, n1, n2 in rowsdef:
    d.text((20, y), title, font=fs, fill=(120, 0, 0))
    y += 38
    for i, p in enumerate([os.path.join(O, "cg_" + n1 + ".png"), os.path.join(O, "gen_" + n1 + ".png"), os.path.join(O, "gen_" + n2 + ".png")]):
        im = Image.open(p).convert("RGB")
        im.thumbnail((cell - 10, cell - 10))
        sheet.paste(im, (20 + i * cell, y))
    y += cell + 25
sheet = sheet.crop((0, 0, W, y))
sheet.save(os.path.join(O, "sheet_base.png"))
print("done", len(rows), "rows;", sheet.size)
