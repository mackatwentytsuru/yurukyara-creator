"""段 9c: 元の絵と作った物を並べた一覧を作り、輪郭の重なり(IoU)を測る。

使い方: python s03_compare.py <元の絵> <作った物の正面の絵> <出力.png> "<見出し>" [<もう 1 枚の絵> ...]
- 元の絵・作った物・(あれば)ほかの版を、同じ高さにそろえて横に並べ、大きな見出しをつける。
- 輪郭の重なり: 背景(縁の色)でない部分を体とみなし、外接箱の高さをそろえて重ねた IoU を、元の絵と各版のあいだで出す。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = r"C:\Windows\Fonts\meiryob.ttc"


def silhouette(im):
    a = np.array(im.convert("RGB")).astype(int)
    bg = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]), axis=0)
    return (np.abs(a - bg).sum(axis=2) > 40)


def norm_mask(m, size=500):
    ys, xs = np.where(m)
    crop = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape
    s = (size * 0.9) / h
    im = Image.fromarray((crop * 255).astype("uint8")).resize((max(1, int(w * s)), int(h * s)), Image.NEAREST)
    out = np.zeros((size, size), bool)
    ox = (size - im.width) // 2
    arr = np.array(im) > 127
    out[int(size * 0.05):int(size * 0.05) + arr.shape[0], max(ox, 0):max(ox, 0) + arr.shape[1]] = arr[:, :size - max(ox, 0)]
    return out


def main():
    args = sys.argv[1:]
    names_arg = None
    if "--names" in args:
        i = args.index("--names")
        names_arg = args[i + 1].split(",")
        del args[i:i + 2]
    orig, built, out, title = args[:4]
    others = args[4:]
    paths = [orig, built] + others
    names = names_arg or (["元の絵", "手組み版"] + [f"ほかの版{i + 1}" for i in range(len(others))])
    ims = [Image.open(p).convert("RGB") for p in paths]
    H = 700
    ims = [im.resize((int(im.width * H / im.height), H)) for im in ims]
    head, lab = 140, 90
    W = sum(i.width for i in ims)
    sheet = Image.new("RGB", (W, head + lab + H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    d.rectangle([0, 0, W, head], fill=(22, 34, 58))
    d.text((30, 18), title, font=ImageFont.truetype(FONT, 96), fill=(255, 255, 255))
    base = norm_mask(silhouette(Image.open(orig)))
    x = 0
    fl = ImageFont.truetype(FONT, 46)
    for nm, im, p in zip(names, ims, paths):
        sheet.paste(im, (x, head + lab))
        txt = nm
        if p != orig:
            m = norm_mask(silhouette(Image.open(p)))
            iou = (base & m).sum() / max((base | m).sum(), 1)
            txt = f"{nm} 重なり{iou * 100:.0f}%"
            print(nm, "IoU", round(float(iou), 3))
        d.text((x + 20, head + 12), txt, font=fl, fill=(22, 34, 58))
        x += im.width
    sheet.save(out)
    print(out, sheet.size)


main()
