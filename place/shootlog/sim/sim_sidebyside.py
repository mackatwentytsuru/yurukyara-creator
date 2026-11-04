"""見比べ: 合成(本番の道具が作ったカメラ + composite.py)と、正解(UE で正解のカメラから直接撮った絵)を左右に並べた動画と絵。

  python place/shootlog/sim/sim_sidebyside.py --comp <合成の連番> --truth <正解の連番> --out <mp4> --jpg <jpg> [--title "..."] [--frames 100 140 200]
左が合成、右が正解。動画は -map_metadata -1。字の高さは絵の幅(1920)の 3% 以上(60 px)。
"""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = "C:/Windows/Fonts/meiryob.ttc"
HALF_W, HALF_H = 960, 540
TEXT_PX = 60


def imread(path):
    return cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)


def label(img, text, y=8):
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)
    font = ImageFont.truetype(FONT, TEXT_PX)
    box = draw.textbbox((14, y), text, font=font)
    draw.rectangle((box[0] - 8, box[1] - 4, box[2] + 8, box[3] + 4), fill=(0, 0, 0))
    draw.text((14, y), text, font=font, fill=(255, 255, 255))
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def pair(comp_path, truth_path, left, right, extra=None):
    a = cv2.resize(imread(comp_path), (HALF_W, HALF_H), interpolation=cv2.INTER_AREA)
    b = cv2.resize(imread(truth_path), (HALF_W, HALF_H), interpolation=cv2.INTER_AREA)
    out = np.hstack([label(a, left), label(b, right)])
    if extra:
        out = label(out, extra, y=HALF_H - TEXT_PX - 24)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--comp", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--jpg", required=True, type=Path)
    ap.add_argument("--left", default="合成(本番の道具)")
    ap.add_argument("--right", default="正解(UE の直接の絵)")
    ap.add_argument("--frames", nargs="+", type=int, default=[100, 150, 200])
    ap.add_argument("--first", type=int, default=0)
    ap.add_argument("--last", type=int, default=240)
    a = ap.parse_args()
    a.out.parent.mkdir(parents=True, exist_ok=True)
    writer = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{HALF_W * 2}x{HALF_H}", "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", "18",
                               "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-threads", "6", str(a.out)], stdin=subprocess.PIPE)
    for i in range(a.first, a.last):
        p = pair(a.comp / f"f.{i:04d}.png", a.truth / f"f.{i:04d}.png", a.left, a.right)
        writer.stdin.write(p.tobytes())
    writer.stdin.close()
    writer.wait()
    rows = [pair(a.comp / f"f.{i:04d}.png", a.truth / f"f.{i:04d}.png", a.left, a.right, f"{i / 30:.1f} 秒") for i in a.frames]
    sheet = np.vstack(rows)
    a.jpg.parent.mkdir(parents=True, exist_ok=True)
    a.jpg.write_bytes(cv2.imencode(".jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes())
    print("書いた:", a.out, a.jpg)


if __name__ == "__main__":
    main()
