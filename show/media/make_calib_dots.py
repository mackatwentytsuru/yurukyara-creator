#!/usr/bin/env python3
"""レンズの歪みを測るための「点の格子」映像(5680x1240、60p、20 秒、動きなし、無音)。

黒地に白い丸を、A 面(x 0-1279)と C 面の平らな部分に、80 px の倍数の位置で置く。
縦横とも 80 px 間隔(パネル 80x40 px = 32x16 cm なので、実寸でほぼ 32 cm 角の格子)。
B 面と面の境目には置かない。各面の左上の点だけ大きい(向きの印)。

作るもの: --out-dir に <name>.mov / <name>.mp4 / <name>_preview.mp4(run/encode_led.sh)、
          --json-out に点の一覧(px と、面の左下を原点にした m)。
パネルの実寸は未確認(32x16 cm は仕様上の値)。

使い方: python make_calib_dots.py --work-dir <作業> --out-dir <出力> --json-out <json> [--name 名前] [--check-png <png>]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

W, H, FPS, SECONDS = 5680, 1240, 60, 20
PITCH = 80                 # 点の間隔 px(縦横とも)
DOT_D = 36                 # 点の直径 px
MARK_D = 64                # 各面の左上の点(向きの印)の直径 px
CM_PER_PX = 32.0 / 80.0    # パネル 80 px = 32 cm(未確認の仕様値)
# 面ごとの点を置く範囲(x の最小・最大、面の左端 px)。C の平らな部分は 3039 から約 1250 px
FACES = {
    "A": {"x0": 0, "x_min": 80, "x_max": 1200},
    "C": {"x0": 3039, "x_min": 3120, "x_max": 4240},
}
Y_MIN, Y_MAX = 80, 1160


def dot_list():
    out = {}
    for face, c in FACES.items():
        dots, i = [], 0
        for y in range(Y_MIN, Y_MAX + 1, PITCH):          # 上の行から、左から右へ
            for x in range(c["x_min"], c["x_max"] + 1, PITCH):
                dots.append({
                    "id": f"{face}{i:03d}",
                    "px": [x, y],
                    "m": [round((x - c["x0"]) * CM_PER_PX / 100, 4), round((H - y) * CM_PER_PX / 100, 4)],
                    "mark": i == 0,
                })
                i += 1
        out[face] = dots
    return out


def draw(dots):
    img = np.zeros((H, W, 3), np.uint8)
    for face in dots.values():
        for d in face:
            r = (MARK_D if d["mark"] else DOT_D) // 2
            cv2.circle(img, tuple(d["px"]), r, (235, 235, 235), -1, cv2.LINE_AA)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--json-out", required=True)
    ap.add_argument("--name", default="calib_dots")
    ap.add_argument("--check-png")
    ap.add_argument("--png-only", action="store_true")
    a = ap.parse_args()

    dots = dot_list()
    img = draw(dots)
    work = Path(a.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    note = ("m は各面の左下を原点にした、パネル 32x16 cm からの計算値。本物の寸法は未確認。"
            "px は 5680x1240 の絵の中の位置(左上が原点)。mark は向きの印の大きい点(各面の左上)。")
    Path(a.json_out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.json_out).write_text(json.dumps({"note": note, **dots}, ensure_ascii=False, indent=1), encoding="utf-8")
    if a.check_png:
        cv2.imwrite(a.check_png, img)
    png = work / "calib.png"
    cv2.imwrite(str(png), img)
    white = float((img.max(axis=2) > 128).mean())
    print(f"点: " + ", ".join(f"{k} {len(v)}" for k, v in dots.items()) + f"  白の面積 {white * 100:.1f}%")
    if a.png_only:
        return
    master = work / "master.mkv"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", str(FPS),
                    "-i", str(png), "-t", str(SECONDS),
                    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv444p10le",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-colorspace", "bt709",
                    "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", str(master)],
                   check=True)
    encode = Path(__file__).resolve().parent.parent / "run" / "encode_led.sh"
    subprocess.run([shutil.which("bash") or "bash", str(encode), str(master), "none", a.out_dir, a.name], check=True)


if __name__ == "__main__":
    sys.exit(main())
