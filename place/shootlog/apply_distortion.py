"""CG の描画に、a7 のレンズの歪みをかける(歪みは直さない方針: キャラも歪んで入る)。

  python place/shootlog/apply_distortion.py <lens_calib の出力フォルダ> <CG の画像または動画> <出力>
CG は lens.json の st_map.cg_render_size の大きさ・主点で描いた、歪みなしのピンホール(a7 と同じ fx, fy)の絵。
出力は a7 の画像と同じ大きさで、a7 の映像と同じ歪みをもつ。--undistort を付けると逆(a7 の映像の歪みを直す。確かめ用)。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from lenslib import distort_image


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("lens_dir")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--undistort", action="store_true")
    a = ap.parse_args()
    d = Path(a.lens_dir)
    lens = json.loads((d / "lens.json").read_text(encoding="utf-8"))
    m = np.load(d / "st_map.npz")
    mx, my = m["map_x"], m["map_y"]
    if a.undistort:
        K = np.array([[lens["fx"], 0, lens["cx"]], [0, lens["fy"], lens["cy"]], [0, 0, 1.0]])
        o = lens["distortion_opencv"]
        dist = np.array([o["k1"], o["k2"], o["p1"], o["p2"], o["k3"]])
        w, h = lens["image_size"]
        mx, my = cv2.initUndistortRectifyMap(K, dist, None, K, (w, h), cv2.CV_32FC1)
    src = Path(a.src)
    if src.suffix.lower() in (".png", ".jpg", ".jpeg", ".tif", ".tiff"):
        cv2.imwrite(a.dst, distort_image(cv2.imread(str(src), cv2.IMREAD_UNCHANGED), mx, my))
        return
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w, h = mx.shape[1], mx.shape[0]
    wr = cv2.VideoWriter(a.dst, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    while True:
        ok, img = cap.read()
        if not ok:
            break
        wr.write(distort_image(img, mx, my))
    wr.release()


if __name__ == "__main__":
    main()
