"""段 1: 元の絵から、(1) 背景を抜いた RGBA、(2) 顔(目・口・ほお)の輪郭と位置 を測る。

使い方: python p01_prep.py <id> <元の絵.png> <出力フォルダ> --face "x0,y0,x1,y1" [--dark 70]

- 背景は白: 縁から塗りつぶして「ほぼ白」の領域だけを背景にする(体の中の白い反射は残る)。
- 顔は --face の箱の中の「暗い塊」を目と口、「ピンク色の塊」をほおとして拾う。
- 出力: <id>_rgba.png(体の外接箱を正方形に切り、余白つき)、<id>_face.json(元の絵の画素座標)
"""
import argparse
import json
import os

import cv2
import numpy as np
from PIL import Image


def background_mask(rgb: np.ndarray, thr: int = 238) -> np.ndarray:
    """縁とつながった『ほぼ白』を背景(True)にする。"""
    h, w, _ = rgb.shape
    near_white = (rgb.min(axis=2) >= thr).astype(np.uint8)
    n, lab = cv2.connectedComponents(near_white, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
    border.discard(0)
    return np.isin(lab, list(border))


def soft_alpha(rgb: np.ndarray) -> np.ndarray:
    bg = background_mask(rgb)
    fg = (~bg).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return cv2.GaussianBlur(fg, (0, 0), 1.0)


def components(mask: np.ndarray, min_area: int):
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cnts:
        a = cv2.contourArea(c)
        if a < min_area:
            continue
        x, y, w, h = cv2.boundingRect(c)
        m = cv2.moments(c)
        eps = 0.004 * cv2.arcLength(c, True)
        poly = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        out.append({"area": float(a), "bbox": [int(x), int(y), int(w), int(h)],
                    "centroid": [m["m10"] / m["m00"], m["m01"] / m["m00"]],
                    "polygon": poly.astype(int).tolist()})
    out.sort(key=lambda d: (d["centroid"][1], d["centroid"][0]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("src")
    ap.add_argument("outdir")
    ap.add_argument("--face", required=True, help="x0,y0,x1,y1 顔のある範囲(元の絵の画素)")
    ap.add_argument("--dark", type=int, default=70)
    ap.add_argument("--pad", type=float, default=0.06)
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    rgb = np.array(Image.open(a.src).convert("RGB"))
    alpha = soft_alpha(rgb)
    ys, xs = np.where(alpha > 128)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * a.pad))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    left, top = cx - side // 2, cy - side // 2
    rgba = np.dstack([rgb, alpha])
    canvas = np.zeros((side, side, 4), np.uint8)
    canvas[..., :3] = 255
    sx0, sy0 = max(left, 0), max(top, 0)
    sx1, sy1 = min(left + side, rgb.shape[1]), min(top + side, rgb.shape[0])
    canvas[sy0 - top:sy1 - top, sx0 - left:sx1 - left] = rgba[sy0:sy1, sx0:sx1]
    Image.fromarray(canvas).save(os.path.join(a.outdir, f"{a.id}_rgba.png"))

    fx0, fy0, fx1, fy1 = [int(v) for v in a.face.split(",")]
    box = np.zeros(rgb.shape[:2], bool)
    box[fy0:fy1, fx0:fx1] = True
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    lum = rgb.astype(int).sum(axis=2) / 3
    dark = (lum < a.dark) & box
    dark = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)).astype(bool)
    # 目のハイライト(白い点)は、暗い塊の中の明るい穴として拾う
    pink = (hsv[..., 1] > 60) & (hsv[..., 0] < 20) & (rgb[..., 0] > 200) & box
    dark_c = components(dark, 150)
    pink_c = components(pink, 300)
    hl = components(((lum > 200) & box & cv2.dilate(dark.astype(np.uint8), np.ones((15, 15))).astype(bool)), 20)
    res = {"id": a.id, "source_size": [rgb.shape[1], rgb.shape[0]],
           "body_bbox": [int(x0), int(y0), int(x1), int(y1)],
           "crop": {"left": int(left), "top": int(top), "side": int(side)},
           "dark": dark_c, "pink": pink_c, "highlight": hl}
    with open(os.path.join(a.outdir, f"{a.id}_face.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(a.id, "body", res["body_bbox"], "dark", [(c["bbox"], int(c["area"])) for c in dark_c],
          "pink", [(c["bbox"], int(c["area"])) for c in pink_c], "hl", len(hl))


if __name__ == "__main__":
    main()
