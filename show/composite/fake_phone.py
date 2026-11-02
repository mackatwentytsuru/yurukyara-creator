"""UE で撮った連番を「スマホで撮った実写の代わり」にする。ノイズと少しのブレを足す。

使い方: python fake_phone.py <連番のフォルダ> <出力の動画> [stmap.npy]
stmap.npy を渡すと、そのレンズの歪みをかける(歪んだ実写の代わり)。
"""
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

FPS = 30
NOISE_SIGMA = 2.2  # 8 ビットの値で。暗い所でも見える程度
SOFTEN_SIGMA = 0.7
BLEND_PREVIOUS = 0.2  # 前のコマを混ぜてブレに見せる
GAIN = 0.97
SEED = 11


def main():
    frames_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    table = np.load(sys.argv[3]) if len(sys.argv) > 3 else None
    paths = sorted(frames_dir.glob("f.*.png"))
    if not paths:
        raise SystemExit(f"連番が無い: {frames_dir}")
    height, width = (table.shape[:2] if table is not None else cv2.imread(str(paths[0])).shape[:2])
    writer = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
                               "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
                               "-map_metadata", "-1", str(out)], stdin=subprocess.PIPE)
    rng = np.random.default_rng(SEED)
    previous = None
    for path in paths:
        source = cv2.imread(str(path))
        source = source if table is None else cv2.remap(source, table[..., 0], table[..., 1], cv2.INTER_LINEAR)
        image = cv2.GaussianBlur(source, (0, 0), SOFTEN_SIGMA).astype(np.float32) * GAIN
        mixed = image if previous is None else image * (1 - BLEND_PREVIOUS) + previous * BLEND_PREVIOUS
        previous = image
        noisy = mixed + rng.normal(0, NOISE_SIGMA, (height, width, 1)).astype(np.float32)
        writer.stdin.write(noisy.clip(0, 255).astype(np.uint8).tobytes())
    writer.stdin.close()
    if writer.wait() != 0:
        raise RuntimeError("動画を書けない")
    print("wrote", out, len(paths), "コマ")


if __name__ == "__main__":
    main()
