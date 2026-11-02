"""ステージ LED に流す絵を Pillow と numpy で描き、mp4 にする。

絵は 5680x1240 の 1 本(本物の LED に出す形そのまま)。
中央の面(B)は x 957-3345, y 85-1218 だけを全面に映すので、
横 0.295 cm/px・縦 0.438 cm/px に変形される。B の中に置く物は横に 1.48 倍して打ち消す。

使い方: python make_pictures.py <キャラの絵の png> [出力フォルダ]
(キャラの絵は環境変数 SHOW_CHARACTER_ART でも指定できる)
"""
import os
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

CANVAS = (5680, 1240)
B_CENTER_X = 2151  # (957 + 3345) / 2
SEAMS = (1279, 3039)
B_EDGES = (957, 3345)
B_SAFE = (1330, 135, 2990, 1170)
B_STRETCH = 1.48
FONT = "C:/Windows/Fonts/meiryob.ttc"
DEFAULT_OUT = "work/ue_show/media"
MP4_SIZE = "2840:620"
MP4_SECONDS = 4


def draw_rays(width, height, center):
    """中心から放射状に広がる光の筋(0-1 の明るさ)を返す。"""
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    dx = (xs - center[0]) / B_STRETCH
    dy = ys - center[1]
    angle = np.arctan2(dy, dx)
    radius = np.sqrt(dx * dx + dy * dy)
    rays = 0.5 + 0.5 * np.cos(angle * 24.0)
    rays = rays**3
    falloff = np.exp(-radius / 1500.0)
    return rays * falloff, np.exp(-radius / 700.0)


def make_background():
    width, height = CANVAS
    center = (B_CENTER_X, height * 0.5)
    rays, core = draw_rays(width, height, center)
    t = (np.arange(width, dtype=np.float32) / width)[None, :]
    magenta = np.array([86, 10, 74], dtype=np.float32)
    purple = np.array([34, 8, 92], dtype=np.float32)
    side = np.abs(t - B_CENTER_X / width) / 0.62
    side = np.clip(side, 0.0, 1.0)[..., None]
    base = magenta * (1.0 - side) + purple * side
    image = np.broadcast_to(base, (height, width, 3)).copy()
    image += rays[..., None] * np.array([150, 40, 130], dtype=np.float32)
    image += core[..., None] * np.array([90, 20, 80], dtype=np.float32)
    return Image.fromarray(np.clip(image, 0, 255).astype(np.uint8), "RGB")


def star_points(cx, cy, size, stretch):
    points = []
    for i in range(10):
        r = size if i % 2 == 0 else size * 0.42
        a = np.pi * i / 5.0 - np.pi / 2.0
        points.append((cx + r * np.cos(a) * stretch, cy + r * np.sin(a)))
    return points


def heart_points(cx, cy, size, stretch):
    points = []
    for a in np.linspace(0.0, 2.0 * np.pi, 48):
        x = 16.0 * np.sin(a) ** 3
        y = 13.0 * np.cos(a) - 5.0 * np.cos(2 * a) - 2.0 * np.cos(3 * a) - np.cos(4 * a)
        points.append((cx + x * size / 17.0 * stretch, cy - y * size / 17.0))
    return points


def particle_stretch(x):
    return B_STRETCH if B_EDGES[0] < x < B_EDGES[1] else 1.0


def add_particles(image, seed=11, count=170):
    """星とハートの粒を、面の境目をまたがないように足す。"""
    rng = random.Random(seed)
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    colors = [(255, 190, 235), (255, 120, 205), (200, 170, 255), (255, 225, 150)]
    placed = 0
    while placed < count:
        x = rng.uniform(30, CANVAS[0] - 30)
        y = rng.uniform(30, CANVAS[1] - 30)
        size = rng.uniform(10, 34)
        reach = size * particle_stretch(x) * 1.2
        if any(abs(x - seam) < reach for seam in SEAMS + B_EDGES):
            continue
        shape = star_points if rng.random() < 0.55 else heart_points
        alpha = rng.randint(120, 220)
        fill = rng.choice(colors) + (alpha,)
        draw.polygon(shape(x, y, size, particle_stretch(x)), fill=fill)
        placed += 1
    glow = layer.filter(ImageFilter.GaussianBlur(6))
    merged = Image.alpha_composite(image.convert("RGBA"), glow)
    return Image.alpha_composite(merged, layer).convert("RGB")


def draw_title(image):
    """B の主役の範囲に文字を置く。横を伸ばして B の変形を打ち消す。"""
    left, top, right, bottom = B_SAFE
    box_w, box_h = right - left, bottom - top
    src_w = int(box_w / B_STRETCH)
    src = Image.new("L", (src_w, box_h), 0)
    draw = ImageDraw.Draw(src)
    lines = ["見本のキャラ", "ちゃん"]
    font = ImageFont.truetype(FONT, int(src_w / 3.2), index=0)
    boxes = [draw.textbbox((0, 0), t, font=font) for t in lines]
    heights = [b[3] - b[1] for b in boxes]
    gap = 50
    y = (box_h - sum(heights) - gap) / 2
    for text, b, h in zip(lines, boxes, heights):
        x = (src_w - (b[2] - b[0])) / 2 - b[0]
        draw.text((x, y - b[1]), text, fill=255, font=font)
        y += h + gap
    mask = src.resize((box_w, box_h), Image.LANCZOS)
    glow = mask.filter(ImageFilter.GaussianBlur(24)).point(lambda v: min(255, int(v * 1.5)))
    result = image.copy()
    result.paste((255, 70, 180), (left, top), glow)
    result.paste((255, 226, 244), (left, top), mask)
    return result


def largest_blob(alpha):
    """いちばん大きいかたまりだけを残す(絵の周りの小さな欠片を消す)。"""
    from scipy import ndimage

    labels, count = ndimage.label(alpha > 40)
    if count == 0:
        return alpha
    sizes = ndimage.sum_labels(np.ones_like(labels), labels, range(1, count + 1))
    keep = labels == (int(np.argmax(sizes)) + 1)
    keep = ndimage.binary_dilation(keep, iterations=2)
    return (alpha * keep).astype(np.uint8)


def place_character(image, art_path):
    art = Image.open(art_path).convert("RGBA")
    pixels = np.array(art)
    alpha = pixels[..., 3].astype(np.float32)
    if pixels[..., 3].min() == 255:
        # 透明が無い絵は、黒い背景を明るさで抜く
        alpha = np.clip(pixels[..., :3].max(axis=2).astype(np.float32) * 6.0, 0, 255)
    pixels[..., 3] = largest_blob(alpha)
    art = Image.fromarray(pixels, "RGBA")
    art = art.crop(art.getbbox())
    left, top, right, bottom = B_SAFE
    box_h = bottom - top
    new_w = int(art.width * box_h / art.height * B_STRETCH)
    if new_w > right - left:
        raise ValueError(f"キャラの絵が B の範囲より広い: {new_w}")
    art = art.resize((new_w, box_h), Image.LANCZOS)
    x = 2159 - new_w // 2
    if x <= SEAMS[0] or x + new_w >= SEAMS[1]:
        raise ValueError("キャラの絵が面の境目をまたぐ")
    result = image.convert("RGBA")
    result.alpha_composite(art, (x, top))
    return result.convert("RGB"), (x, top, x + new_w, bottom)


def make_grid():
    """160 px ごとの線と、面の境目の赤線。面の割り当ての確認用。"""
    image = Image.new("RGB", CANVAS, (28, 28, 34))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, 44, index=0)
    for x in range(0, CANVAS[0], 160):
        color = (235, 235, 235) if x % 800 == 0 else (130, 130, 140)
        draw.line([(x, 0), (x, CANVAS[1])], fill=color, width=6)
        if x % 800 == 0:
            draw.text((x + 10, 8), str(x), fill=(255, 240, 120), font=font)
    for y in range(0, CANVAS[1], 160):
        draw.line([(0, y), (CANVAS[0], y)], fill=(130, 130, 140), width=6)
    for x in SEAMS:
        draw.line([(x, 0), (x, CANVAS[1])], fill=(255, 0, 0), width=14)
    for x in B_EDGES:
        draw.line([(x, 0), (x, CANVAS[1])], fill=(255, 220, 0), width=10)
    for y in (85, 1218):
        draw.line([(0, y), (CANVAS[0], y)], fill=(0, 220, 255), width=8)
    return image


def encode_mp4(png_path, mp4_path):
    command = [
        "ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30",
        "-i", str(png_path), "-t", str(MP4_SECONDS),
        "-vf", f"scale={MP4_SIZE}:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-crf", "12", "-preset", "medium",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        str(mp4_path),
    ]
    subprocess.run(command, check=True)


def main():
    art_path = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SHOW_CHARACTER_ART")
    if not art_path:
        raise SystemExit("キャラの絵の png を、引数か SHOW_CHARACTER_ART で指定してください")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT)
    out.mkdir(parents=True, exist_ok=True)
    background = add_particles(make_background())
    picture_a = draw_title(background)
    picture_b, art_box = place_character(background, art_path)
    pictures = {"a_title": picture_a, "b_character": picture_b, "c_background": background,
                "grid": make_grid()}
    for name, image in pictures.items():
        png = out / f"{name}.png"
        image.save(png)
        encode_mp4(png, out / f"{name}.mp4")
        print(name, image.size, png)
    print("character box in picture", art_box)


if __name__ == "__main__":
    main()
