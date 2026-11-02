"""LED に出す ChArUco の盤の画像(面ごと)と、その寸法の記述(board.json)を作る。

  python place/shootlog/make_led_board.py --face-px 1280 1240 --out-dir <出力> [--square-px 160] [--pitch-m 0.004] [--name A]

LED の 1 画素は 4 mm(パネル 32×16 cm = 80×40 画素)。既定の四角 160 画素 = 64 cm。盤は面の画像の中央に置く。
a7 の 4K 動画で遠くから撮るなら四角を大きく(--square-px 240 など)、近くから撮るなら小さく。
board.json を lens_calib.py と rig_offset.py に渡す。画像は LED の面の左上が (0,0) で、ショーの映像の A 面(または C 面)の位置にそのまま置く。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from lenslib import Board, imwrite


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--face-px", nargs=2, type=int, required=True, metavar=("W", "H"))
    ap.add_argument("--square-px", type=int, default=160)
    ap.add_argument("--pitch-m", type=float, default=0.004)
    ap.add_argument("--dictionary", default="DICT_4X4_250")
    ap.add_argument("--name", default="A")
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args()
    W, H = a.face_px
    sq = a.square_px
    cols, rows = W // sq, H // sq
    ox, oy = (W - cols * sq) // 2, (H - rows * sq) // 2
    board = Board(cols, rows, sq, int(sq * 0.75), (ox, oy), (W, H), a.pitch_m, a.dictionary)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    imwrite(out / f"led_board_{a.name}.png", board.render())
    (out / f"board_{a.name}.json").write_text(json.dumps(board.to_json(), indent=2), encoding="utf-8")
    print(f"書いた: {out}/led_board_{a.name}.png({W}×{H} 画素、四角 {cols}×{rows}、一辺 {sq * a.pitch_m * 100:.0f} cm)と board_{a.name}.json")


if __name__ == "__main__":
    main()
