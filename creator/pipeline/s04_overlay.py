"""元の絵と撮った絵を、同じ範囲・同じ大きさで 3 枚(元・作った物・重ね)に並べる。ずれを見つける道具。

使い方: python s04_overlay.py <元の絵> <撮った絵> <出力.png> "<見出し>" [--crop x0,y0,x1,y1]
- 撮った絵は、元の絵と同じ画素の範囲を撮ったもの(m02_shot.py の --center と --scale で合わせる)。
- --crop は元の絵の画素の範囲。撮った絵にも同じ範囲を切り出して並べる。
- 重ね: 元の絵の輪郭(暗い線と色の境)を、撮った絵の上に薄く重ねる。
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = r"C:\Windows\Fonts\meiryob.ttc"


def main():
    args = sys.argv[1:]
    crop = None
    if "--crop" in args:
        i = args.index("--crop")
        crop = [int(v) for v in args[i + 1].split(",")]
        del args[i:i + 2]
    ref, shot, out, title = args[:4]
    A = Image.open(ref).convert("RGBA")
    bg = Image.new("RGBA", A.size, (255, 255, 255, 255))
    bg.alpha_composite(A)
    A = bg.convert("RGB")
    B = Image.open(shot).convert("RGB").resize(A.size)
    if crop:
        A, B = A.crop(crop), B.crop(crop)
    # 元の絵の輪郭(隣との色の差が大きい所)
    a = np.array(A).astype(int)
    edge = (np.abs(np.diff(a, axis=0, prepend=a[:1])).sum(axis=2) + np.abs(np.diff(a, axis=1, prepend=a[:, :1])).sum(axis=2)) > 120
    C = np.array(B).copy()
    C[edge] = (0.35 * C[edge] + 0.65 * np.array([230, 0, 80])).astype(np.uint8)
    C = Image.fromarray(C)
    H = 640
    ims = [im.resize((int(im.width * H / im.height), H)) for im in (A, B, C)]
    head, lab = 120, 70
    W = sum(i.width for i in ims)
    sheet = Image.new("RGB", (W, head + lab + H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    d.rectangle([0, 0, W, head], fill=(22, 34, 58))
    d.text((24, 12), title, font=ImageFont.truetype(FONT, 84), fill=(255, 255, 255))
    x = 0
    for nm, im in zip(("元の絵", "作った物", "重ね(赤 = 元の輪郭)"), ims):
        sheet.paste(im, (x, head + lab))
        d.text((x + 16, head + 8), nm, font=ImageFont.truetype(FONT, 46), fill=(22, 34, 58))
        x += im.width
    sheet.save(out)
    print(out, sheet.size)


main()
