"""実写にキャラを重ねる。素材は同じカメラで撮った 5 本の連番。

  with / without … キャラあり・なしのステージ(色)
  matte          … 真っ黒の中の真っ白のキャラ(透明)
  shadow_with / shadow_without … 灰色の床(有り無しの比が床の影)

式: 出力 = (with − (1−α)·without) + (1−α)·(実写·影 + 映り込み·(with − without))
    前の項は、ステージの色を抜いたキャラの色。後の項は、キャラの後ろの実写に影を掛け、床の映り込みの差を足した物。

実写にレンズの歪みがあるときは --stmap を渡す。色・透明・影の全部を、実写と同じ歪みにしてから重ねる。

使い方: python composite.py <連番の親フォルダ> <実写の動画> <出力の連番フォルダ> [--first コマ] [--last コマ] [--stmap stmap.npy]
"""
import argparse
import subprocess
from pathlib import Path

import cv2
import numpy as np

GAMMA = 2.2
MIN_FLOOR = 0.02  # 灰色の床の明るさ(直線)がこれより暗い所は影を計算しない
SHADOW_BLUR_SIGMA = 1.2
SHADOW_STRENGTH = 0.85
REFLECTION_STRENGTH = 1.0  # 本物の床が光らないなら下げる
PASSES = {"with": "Comp_BeautyWith", "without": "Comp_BeautyWithout", "matte": "Comp_MatteChar",
          "shadow_with": "Comp_ShadowWith", "shadow_without": "Comp_ShadowWithout"}


def read(root, name, index, table=None, crop=None):
    path = root / PASSES[name] / f"f.{index:04d}.png"
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(path)
    if table is not None:
        image = cv2.remap(image, table[..., 0], table[..., 1], cv2.INTER_LINEAR)
    elif crop is not None:
        width, height = crop
        x0, y0 = (image.shape[1] - width) // 2, (image.shape[0] - height) // 2
        image = image[y0:y0 + height, x0:x0 + width]
    return image.astype(np.float32) / 255.0


def shadow_ratio(with_shadow, without_shadow):
    """床の暗くなった割合(直線の明るさの比。1 で影なし)。"""
    a = with_shadow.mean(axis=2) ** GAMMA
    b = without_shadow.mean(axis=2) ** GAMMA
    ratio = np.where(b > MIN_FLOOR, np.clip(a / np.maximum(b, 1e-4), 0.0, 1.0), 1.0)
    ratio = cv2.GaussianBlur(ratio, (0, 0), SHADOW_BLUR_SIGMA)
    return 1.0 - SHADOW_STRENGTH * (1.0 - ratio)


def compose(plate, frames):
    alpha = frames["matte"].mean(axis=2, keepdims=True)
    shadow = shadow_ratio(frames["shadow_with"], frames["shadow_without"])[..., None]
    character = np.clip(frames["with"] - (1.0 - alpha) * frames["without"], 0.0, 1.0)
    shaded_plate = (plate ** GAMMA * shadow) ** (1.0 / GAMMA)
    reflection = REFLECTION_STRENGTH * (frames["with"] - frames["without"])
    return np.clip(character + (1.0 - alpha) * (shaded_plate + reflection), 0.0, 1.0)


def plate_reader(path, width, height, first):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{first / 30.0:.4f}", "-i", str(path), "-f", "rawvideo",
                             "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE, stdin=subprocess.DEVNULL,
                            bufsize=width * height * 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("plate", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--first", type=int, default=0)
    parser.add_argument("--last", type=int, default=600)
    parser.add_argument("--stmap", type=Path, help="make_stmap.py の stmap.npy")
    parser.add_argument("--crop-only", nargs=2, type=int, metavar=("W", "H"),
                        help="歪みをかけず、広く描いた絵の真ん中を切るだけ(歪みなしとの比べ用)")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    table = np.load(args.stmap) if args.stmap else None
    sample = read(args.root, "with", args.first, table, args.crop_only)
    height, width = sample.shape[:2]
    reader = plate_reader(args.plate, width, height, args.first)
    for index in range(args.first, args.last):
        raw = reader.stdout.read(width * height * 3)
        if len(raw) < width * height * 3:
            raise RuntimeError(f"実写が {index} コマで終わった")
        plate = np.frombuffer(raw, np.uint8).reshape(height, width, 3).astype(np.float32) / 255.0
        frames = {name: read(args.root, name, index, table, args.crop_only) for name in PASSES}
        cv2.imwrite(str(args.out / f"f.{index:04d}.png"), (compose(plate, frames) * 255.0 + 0.5).astype(np.uint8))
    reader.kill()
    print("wrote", args.out)


if __name__ == "__main__":
    main()
