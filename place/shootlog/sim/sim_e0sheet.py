"""E0 の絵: 校正から 0・10・60 分たったときの合成(左)と、正解(右)を縦に並べた 1 枚。窓の同じコマ。

  python place/shootlog/sim/sim_e0sheet.py --work work --truth work/win_truth --out <jpg> [--frame 40]
合成は <work>/win_e0_m<分>/comp。10 分までのずれは実測の形、60 分は 10 分の傾きで伸ばした仮定(絵に書く)。
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

import sim_sidebyside as sbs

ROWS = [(0, "校正の直後(0 分)"), (10, "10 分後(実測のずれ 4.3°)"), (60, "60 分後(仮定の外挿 28°)")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", type=Path, default=Path("work"))
    ap.add_argument("--truth", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--frame", type=int, default=40)
    a = ap.parse_args()
    rows = []
    for m, text in ROWS:
        rows.append(sbs.pair(a.work / f"win_e0_m{m}" / "comp" / f"f.{a.frame:04d}.png", a.truth / f"f.{a.frame:04d}.png", "合成", "正解", text))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_bytes(cv2.imencode(".jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes())
    print("書いた:", a.out)


if __name__ == "__main__":
    main()
