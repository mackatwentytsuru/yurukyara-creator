"""段 9b: 8 方向の絵を 1 枚の一覧にする。日本語の大きな見出し。幅 400 画素の画面でも読める大きさ。

使い方: python s01_sheet.py <view フォルダ> <出力.png> "<見出し>"
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

LABELS = {0: "前", 45: "右前", 90: "右", 135: "右後", 180: "後ろ", 225: "左後", 270: "左", 315: "左前"}
from fontpath import find_font  # noqa: E402
FONT = find_font()


def main():
    d, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
    imgs = {a: Image.open(os.path.join(d, f"view_{a:03d}.png")).convert("RGB") for a in LABELS}
    w, h = next(iter(imgs.values())).size
    cols, rows = 4, 2
    head, lab = int(w * 0.30), int(w * 0.20)
    sheet = Image.new("RGB", (cols * w, head + rows * (h + lab)), (255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    dr.rectangle([0, 0, sheet.width, head], fill=(22, 34, 58))
    dr.text((int(w * 0.1), int(head * 0.15)), title, font=ImageFont.truetype(FONT, int(head * 0.62)), fill=(255, 255, 255))
    fl = ImageFont.truetype(FONT, int(lab * 0.75))
    for i, a in enumerate(LABELS):
        x, y = (i % cols) * w, head + (i // cols) * (h + lab)
        sheet.paste(imgs[a], (x, y + lab))
        dr.text((x + int(w * 0.06), y + int(lab * 0.08)), f"{LABELS[a]}({a}°)", font=fl, fill=(22, 34, 58))
    sheet.save(out)
    print(out, sheet.size)


main()
