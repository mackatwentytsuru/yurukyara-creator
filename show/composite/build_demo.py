"""実写と UE の切り替えの見本を 1 本作る。

  0 秒〜        実写の代わり(キャラは LED の中)
  ue 秒〜       同じカメラの UE(LED のキャラが消え、舞台へ出てくる)
  comp 秒〜     実写の代わり + キャラの合成

使い方: python build_demo.py <パスの親フォルダ> <実写あり> <合成の連番> <全編の音> <出力 mp4> --audio-start 秒 --ue 6 --comp 13
"""
import argparse
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 30
FONT = "C:/Windows/Fonts/meiryob.ttc"
NOTICE = "見本: 実写の代わりの CG"
LABEL_SIZE = 66  # 幅 1920 の 3.4%。幅 400 で 14px
SECTION_LABELS = ("実写の代わり", "UE", "実写の代わり + 合成")


def label_image(width, text):
    """1 枚の文字の帯。下地は半透明の黒。戻りは (色, 透明度)。"""
    font = ImageFont.truetype(FONT, LABEL_SIZE)
    band = Image.new("RGBA", (width, LABEL_SIZE * 3), (0, 0, 0, 0))
    draw = ImageDraw.Draw(band)
    for row, (line, fill) in enumerate(((NOTICE, (255, 225, 150, 255)), (text, (255, 255, 255, 255)))):
        y = 8 + row * int(LABEL_SIZE * 1.35)
        box = draw.textbbox((24, y), line, font=font)
        draw.rectangle((box[0] - 12, box[1] - 8, box[2] + 12, box[3] + 8), fill=(0, 0, 0, 170))
        draw.text((24, y), line, font=font, fill=fill)
    data = np.asarray(band, dtype=np.float32) / 255.0
    return data[..., [2, 1, 0]], data[..., 3:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("plate", type=Path)
    parser.add_argument("composite", type=Path)
    parser.add_argument("wav", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--audio-start", type=float, default=30.0)
    parser.add_argument("--ue", type=float, default=6.0)
    parser.add_argument("--comp", type=float, default=13.0)
    parser.add_argument("--end", type=float, default=20.0)
    args = parser.parse_args()
    width, height = 1920, 1080
    labels = [label_image(width, text) for text in SECTION_LABELS]
    count = int(args.end * FPS)
    reader = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(args.plate), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                              stdout=subprocess.PIPE, stdin=subprocess.DEVNULL)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    writer = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
                               "-r", str(FPS), "-i", "-", "-ss", f"{args.audio_start:.3f}", "-t", f"{args.end:.3f}",
                               "-i", str(args.wav), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-crf", "16",
                               "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "320k", "-map_metadata", "-1", str(args.out)],
                              stdin=subprocess.PIPE)
    for index in range(count):
        seconds = index / FPS
        raw = reader.stdout.read(width * height * 3)
        if seconds < args.ue:
            image, section = np.frombuffer(raw, np.uint8).reshape(height, width, 3), 0
        elif seconds < args.comp:
            image, section = cv2.imread(str(args.root / "Comp_UeEmerge" / f"f.{index:04d}.png")), 1
        else:
            image, section = cv2.imread(str(args.composite / f"f.{index:04d}.png")), 2
        color, alpha = labels[section]
        out = image.astype(np.float32) / 255.0
        out[:color.shape[0]] = out[:color.shape[0]] * (1 - alpha) + color * alpha
        writer.stdin.write((out * 255.0).astype(np.uint8).tobytes())
    reader.kill()
    writer.stdin.close()
    if writer.wait() != 0:
        raise RuntimeError("動画を書けない")
    print("wrote", args.out)


if __name__ == "__main__":
    main()
