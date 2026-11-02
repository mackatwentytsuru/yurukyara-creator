"""歪みあり・なしのキャラを、同じコマで並べた 1 枚を作る。足と影の寄りと、ずれの数字を入れる。

使い方: python make_distort_sheet.py <撮影フォルダ> <連番の親> <歪みありの合成の連番> <歪みなしの合成の連番> <stmap.npy> <正解のレンズ json> <出力 jpg> --frame 450
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from lens import scale_lens
from measure_comp import CHARACTER_FLOOR, THRESHOLD, project

FONT = "C:/Windows/Fonts/meiryob.ttc"
SHEET_W = 1600
FULL_H = 900
BAND_H = 120
ZOOM_FACTOR = 6
ZOOM_HALF = (66, 50)  # 寄りの範囲の半分(画素)
STAGE_EDGE_POINTS = [(-700.0, 300.0, 90.0), (0.0, 180.0, 90.0), (1000.0, 300.0, 90.0)]
CROSS_SIZE = 40


def foot_center(gray):
    ys, xs = np.nonzero(gray > THRESHOLD)
    bottom = ys.max()
    return np.array([xs[ys >= bottom - 2].mean(), float(bottom)])


def zoom(image, center):
    cx, cy = int(center[0]), int(center[1])
    half_w, half_h = ZOOM_HALF
    part = image[max(cy - half_h, 0):cy + half_h, max(cx - half_w, 0):cx + half_w]
    return cv2.resize(part, None, fx=ZOOM_FACTOR, fy=ZOOM_FACTOR, interpolation=cv2.INTER_NEAREST), (cx - half_w, cy - half_h)


def to_pil(bgr, size=None):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(cv2.resize(rgb, size, interpolation=cv2.INTER_AREA) if size else rgb)


def draw_cross(draw, x, y):
    draw.line((x - CROSS_SIZE, y, x + CROSS_SIZE, y), fill=(0, 255, 255), width=5)
    draw.line((x, y - CROSS_SIZE, x, y + CROSS_SIZE), fill=(0, 255, 255), width=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shoot", type=Path)
    parser.add_argument("root", type=Path)
    parser.add_argument("with_distortion", type=Path)
    parser.add_argument("without_distortion", type=Path)
    parser.add_argument("stmap", type=Path)
    parser.add_argument("truth_lens", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--frame", type=int, default=450)
    args = parser.parse_args()
    truth = json.loads((args.shoot / "truth.json").read_text(encoding="utf-8"))
    row, fx, width, height = truth["rows"][args.frame], truth["fx"], truth["width"], truth["height"]
    lens = scale_lens(json.loads(args.truth_lens.read_text(encoding="utf-8")), width)
    name = f"f.{args.frame:04d}.png"
    table = np.load(args.stmap)
    matte = cv2.imread(str(args.root / "Comp_MatteChar" / name), cv2.IMREAD_GRAYSCALE)
    x0, y0 = (matte.shape[1] - width) // 2, (matte.shape[0] - height) // 2
    foot_with = foot_center(cv2.remap(matte, table[..., 0], table[..., 1], cv2.INTER_LINEAR))
    foot_without = foot_center(matte[y0:y0 + height, x0:x0 + width])
    expected = project(row, np.array([CHARACTER_FLOOR]), fx, width, height, lens=lens)[0]
    shift = float(np.linalg.norm(foot_with - foot_without))
    points = np.array(STAGE_EDGE_POINTS)
    bends = np.linalg.norm(project(row, points, fx, width, height, lens=lens)
                           - project(row, points, fx, width, height), axis=1)
    report = {"foot_with_vs_true_px": [round(float(v), 2) for v in foot_with - expected],
              "foot_without_vs_true_px": [round(float(v), 2) for v in foot_without - expected],
              "foot_shift_px": round(shift, 2),
              "lens_bend_px_at_left_center_right_of_stage": [round(float(v), 1) for v in bends]}
    print(json.dumps(report, ensure_ascii=False))
    image_with = cv2.imread(str(args.with_distortion / name))
    image_without = cv2.imread(str(args.without_distortion / name))
    font_big = ImageFont.truetype(FONT, 80)
    font_mid = ImageFont.truetype(FONT, 64)
    full_size = (SHEET_W, FULL_H)
    zoom_with, origin_with = zoom(image_with, expected)
    zoom_without, origin_without = zoom(image_without, expected)
    zoom_h = zoom_with.shape[0] * (SHEET_W // 2) // zoom_with.shape[1]
    total = 170 + (BAND_H + FULL_H) * 2 + BAND_H + zoom_h + 180
    sheet = Image.new("RGB", (SHEET_W, total), (16, 16, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 6), "歪みあり・なしの差", fill=(255, 255, 255), font=font_big)
    draw.text((16, 86), "実写の代わりの CG(k1=-0.12)", fill=(255, 225, 150), font=font_mid)
    y = 170
    for label, image in (("歪みなしのキャラ", image_without), ("歪みありのキャラ(本線)", image_with)):
        draw.text((16, y + 14), label, fill=(255, 255, 255), font=font_big)
        sheet.paste(to_pil(image, full_size), (0, y + BAND_H))
        y += BAND_H + FULL_H
    draw.text((16, y + 14), "足元の寄り 左なし 右あり", fill=(255, 255, 255), font=font_mid)
    y += BAND_H
    half = SHEET_W // 2
    for index, (image, origin) in enumerate(((zoom_without, origin_without), (zoom_with, origin_with))):
        sheet.paste(to_pil(image, (half - 4, zoom_h)), (index * half, y))
        scale = (half - 4) / image.shape[1] * ZOOM_FACTOR
        draw_cross(draw, index * half + (expected[0] - origin[0]) * scale, y + (expected[1] - origin[1]) * scale)
    y += zoom_h + 8
    draw.text((16, y), f"足のずれ {shift:.1f} 画素(1920 幅)・水色は正解", fill=(255, 225, 150), font=font_mid)
    draw.text((16, y + 80), f"舞台の端なら {max(bends):.0f} 画素", fill=(255, 225, 150), font=font_mid)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out, quality=90)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
