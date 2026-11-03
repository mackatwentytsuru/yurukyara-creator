"""複数の面(画面)に出す校正の盤を作る。面ごとに ChArUco の盤(マーカー ID は面ごとに重ならない)と、multi_calib.py に渡す faces.json。

  python place/shootlog/make_multi_pattern.py --out <出力フォルダ> \
      --face center 5120 1440 0.000234375 180 --face right 1440 2560 0.000278 160 [--dictionary DICT_5X5_1000]
  --face 名前 横px 縦px 1画素の大きさ(m) 四角の一辺(px)。先頭の面が基準(= 解いた結果の座標の原点・向き。x 右・y 上・z 手前、面の左下が原点)。
出力: pattern_<名前>.png(面の画像、横px×縦px)、faces.json、layout.md(何をどの画面にどう出すか)。
画面の大きさ(1 画素の大きさ)は、モニターが自己申告する寸法(EDID)や定規で測った値。数 % ずれていても、基準でない面の大きさは解いて直す(multi_calib の --face-scale)。
サンプル会場の LED なら、面 A・B・C(1 画素 4 mm)の画像をこの形で作り、映像の頭に入れる(ショーの柱と揃える)。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from lenslib import Board, imwrite


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--face", nargs=5, action="append", required=True, metavar=("NAME", "W", "H", "PITCH_M", "SQUARE_PX"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--dictionary", default="DICT_5X5_1000")
    ap.add_argument("--margin-px", type=int, default=0)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    faces, offset, lines = [], 0, []
    for name, w, h, pitch, sq in a.face:
        W, H, pitch, sq = int(w), int(h), float(pitch), int(sq)
        cols, rows = W // sq, H // sq
        ox, oy = (W - cols * sq) // 2, (H - rows * sq) // 2
        board = Board(cols, rows, sq, int(sq * 0.75), (ox, oy), (W, H), pitch, a.dictionary, offset)
        n_markers = len(board.cv_board().getIds())
        img = board.render()
        imwrite(out / f"pattern_{name}.png", img)
        faces.append({"name": name, "board": board.to_json()})
        lines.append(f"- 面 {name}: {W}×{H} 画素、1 画素 {pitch * 1000:.3f} mm → {W * pitch * 100:.1f}×{H * pitch * 100:.1f} cm。盤 {cols}×{rows} 四角(一辺 {sq * pitch * 100:.1f} cm)、角 {(cols - 1) * (rows - 1)} 点、マーカー ID {offset}〜{offset + n_markers - 1}")
        offset += n_markers
    (out / "faces.json").write_text(json.dumps({"faces": faces}, indent=2, ensure_ascii=False), encoding="utf-8")
    (out / "layout.md").write_text("# 校正の盤(面ごと)\n\n" + "\n".join(lines) + "\n\n先頭の面が基準。各画面に、画面いっぱい(1 画素 = 1 画素、拡大・縮小なし)で出す。\n", encoding="utf-8")
    print("\n".join(lines))
    print("書いた:", out)


if __name__ == "__main__":
    main()
