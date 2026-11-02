"""透明 PNG の連番 → 背景に重ねて mp4 + 測定 + 確認シート。
使い方: python -I compose.py <frames_dir> <out.mp4> <sheet.jpg>
背景: work/ue_show/media/c_background.png(5680x1240)を 2840x620 に縮めて使う。
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

frames_dir, out_mp4, sheet = map(Path, sys.argv[1:4])
BG = Path("work/ue_show/media/c_background.png")
W, H = 2840, 620
SX = W / 5680
EDGES = (1279 * SX, 3039 * SX)

pngs = sorted(frames_dir.glob("f_*.png"))
bg = Image.open(BG).convert("RGB").resize((W, H), Image.LANCZOS)
bg_path = frames_dir / "_bg.png"
bg.save(bg_path)

# 測定: アルファの外接矩形(全コマ)、境目をまたぐか、コマ間の差
boxes, diffs, prev = [], [], None
for p in pngs:
    a = np.array(Image.open(p))[..., 3]
    ys, xs = np.where(a > 8)
    boxes.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    if prev is not None:
        diffs.append(float(np.abs(a.astype(int) - prev.astype(int)).mean()))
    prev = a
x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
w0 = [b[2] - b[0] + 1 for b in boxes]
h0 = [b[3] - b[1] + 1 for b in boxes]
res = {
    "frames": len(pngs),
    "union_box_half_res": [x0, y0, x1, y1],
    "union_box_full_scale": [round(x0 / SX), round(y0 / SX), round(x1 / SX), round(y1 / SX)],
    "width_px_half": [min(w0), max(w0)], "height_px_half": [min(h0), max(h0)],
    "width_full_scale": [round(min(w0) / SX), round(max(w0) / SX)],
    "height_full_scale": [round(min(h0) / SX), round(max(h0) / SX)],
    "touches_edges": any(x0 <= e <= x1 for e in EDGES),
    "edges_half_res": [round(e, 1) for e in EDGES],
    "alpha_diff_mean_min_max": [round(min(diffs), 4), round(max(diffs), 4)],
    "frames_with_motion": sum(d > 0.0005 for d in diffs),
}

# mp4: 背景(静止)に重ねる。メタデータを消す
cmd = [
    "ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(bg_path), "-framerate", "30",
    "-i", str(frames_dir / "f_%04d.png"),
    "-filter_complex", "[0][1]overlay=0:0:shortest=1,format=yuv420p",
    "-c:v", "libx264", "-crf", "16", "-r", "30", "-map_metadata", "-1", "-movflags", "+faststart", str(out_mp4),
]
subprocess.run(cmd, check=True)

# 確認シート: 4 コマ(2x2)+ 日本語の題
idx = [0, 20, 40, 70]
cw = 1420
ch = 310
title_h = 150
sheet_img = Image.new("RGB", (cw * 2, title_h + ch * 2 + 10), (20, 14, 30))
font = ImageFont.truetype("C:/Windows/Fonts/meiryo.ttc", 100)
small = ImageFont.truetype("C:/Windows/Fonts/meiryo.ttc", 64)
d = ImageDraw.Draw(sheet_img)
d.text((30, 10), "ブラウザの絵をLEDへ(3秒の試し)", fill=(255, 255, 255), font=font)
for k, i in enumerate(idx):
    fr = bg.copy()
    fr.paste(Image.open(pngs[i]), (0, 0), Image.open(pngs[i]))
    dr = ImageDraw.Draw(fr)
    for e in EDGES:
        dr.line([(e, 0), (e, H)], fill=(0, 255, 255), width=3)
    dr.text((20, 20), f"{i}コマ目", fill=(255, 255, 0), font=ImageFont.truetype("C:/Windows/Fonts/meiryo.ttc", 90))
    sheet_img.paste(fr.resize((cw, ch)), ((k % 2) * cw, title_h + (k // 2) * (ch + 5)))
sheet.parent.mkdir(parents=True, exist_ok=True)
sheet_img.save(sheet, quality=92)
print(json.dumps(res, ensure_ascii=False, indent=1))
