"""レンズの校正の出力(lens.json と st_map.npz)を、この UE の描き方に直す。

UE の Cine Camera は主点が絵の真ん中に固定で、画素は正方形。校正の絵は主点が真ん中からずれ、fx と fy も少し違う。
そこで、主点のずれの分だけ広く描き、ST マップの値を「真ん中が主点」の絵に合わせて書き直す。

使い方: python lens_render.py <校正の出力フォルダ> --out-dir <出力> [--width 1920]
出力: stmap.npy(float32、H×W×2)、stmap.json(render_w・render_h・sensor_w_mm・sensor_h_mm・focal_mm)。
どちらも render_comp.py の --stmap と composite.py の --stmap に渡す。--width は実写を縮めて合成するときの幅。
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

FULL_FRAME_W_MM = 36.0


def centered_render(lens, width_scale, map_x, map_y):
    """主点が真ん中に来る描く大きさと、それに合わせた ST マップを返す。"""
    fx, fy = lens["fx"] * width_scale, lens["fy"] * width_scale
    cg_w, cg_h = (v * width_scale for v in lens["st_map"]["cg_render_size"])
    px, py = (v * width_scale for v in lens["st_map"]["cg_principal_point"])
    half_w = max(px, cg_w - 1 - px) + 1
    half_h = max(py, cg_h - 1 - py) * fx / fy + 1
    render_w, render_h = int(np.ceil(half_w) * 2), int(np.ceil(half_h) * 2)
    table = np.empty((*map_x.shape, 2), dtype=np.float32)
    table[..., 0] = (map_x - px) + (render_w - 1) / 2.0
    table[..., 1] = (map_y - py) * fx / fy + (render_h - 1) / 2.0
    image_w = lens["image_size"][0] * width_scale
    sensor_w = FULL_FRAME_W_MM * render_w / image_w
    camera = {"render_w": render_w, "render_h": render_h, "sensor_w_mm": sensor_w,
              "sensor_h_mm": sensor_w * render_h / render_w, "focal_mm": fx * FULL_FRAME_W_MM / image_w,
              "principal_shift_px": [px - (cg_w - 1) / 2.0, py - (cg_h - 1) / 2.0], "aspect_fy_over_fx": fy / fx}
    return table, camera


def load_scaled(lens_dir, width):
    lens = json.loads((Path(lens_dir) / "lens.json").read_text(encoding="utf-8"))
    maps = np.load(Path(lens_dir) / "st_map.npz")
    map_x, map_y = maps["map_x"], maps["map_y"]
    scale = (width / lens["image_size"][0]) if width else 1.0
    if width:
        size = (int(width), int(round(lens["image_size"][1] * scale)))
        map_x = cv2.resize(map_x, size, interpolation=cv2.INTER_LINEAR) * scale
        map_y = cv2.resize(map_y, size, interpolation=cv2.INTER_LINEAR) * scale
    return lens, scale, map_x, map_y


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lens_dir", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--width", type=int)
    args = parser.parse_args()
    lens, scale, map_x, map_y = load_scaled(args.lens_dir, args.width)
    table, camera = centered_render(lens, scale, map_x, map_y)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    np.save(args.out_dir / "stmap.npy", table)
    (args.out_dir / "stmap.json").write_text(json.dumps(camera, indent=1), encoding="utf-8")
    print(json.dumps(camera))


if __name__ == "__main__":
    main()
