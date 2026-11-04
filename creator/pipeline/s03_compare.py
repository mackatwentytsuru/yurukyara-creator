"""段 9c: 元の絵と作った物を並べた一覧を作り、輪郭の重なり(IoU)を測る。

使い方: python s03_compare.py <元の絵> <作った物の正面の絵> <出力.png> "<見出し>" [<もう 1 枚の絵> ...]
- 元の絵・作った物・(あれば)ほかの版を、同じ高さにそろえて横に並べ、大きな見出しをつける。
- 輪郭の重なり: 背景(縁の色)でない部分を体とみなし、外接箱の高さをそろえて重ねた IoU を、元の絵と各版のあいだで出す。
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s03_compare_core import norm_mask, silhouette  # noqa: E402

from fontpath import find_font  # noqa: E402
FONT = find_font()


def shape_numbers(base, m):
    """輪郭の重なり以外の合否の数字(正規化した 500px の絵で): 中心のずれ(px)、外接箱の幅・高さの差(%)。"""
    def box(a):
        ys, xs = np.where(a)
        return xs.min(), ys.min(), xs.max(), ys.max()
    b0, b1 = box(base), box(m)
    c0 = ((b0[0] + b0[2]) / 2, (b0[1] + b0[3]) / 2)
    c1 = ((b1[0] + b1[2]) / 2, (b1[1] + b1[3]) / 2)
    shift = ((c1[0] - c0[0]) ** 2 + (c1[1] - c0[1]) ** 2) ** 0.5
    dw = ((b1[2] - b1[0]) - (b0[2] - b0[0])) / max(b0[2] - b0[0], 1) * 100
    dh = ((b1[3] - b1[1]) - (b0[3] - b0[1])) / max(b0[3] - b0[1], 1) * 100
    return shift, dw, dh


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
            sh, dw, dh = shape_numbers(base, m)
            print(nm, "IoU", round(float(iou), 3), "中心のずれ", round(sh, 1), "px(500px 中)/ 幅の差", round(dw, 1), "% / 高さの差", round(dh, 1), "%")
        d.text((x + 20, head + 12), txt, font=fl, fill=(22, 34, 58))
        x += im.width
    sheet.save(out)
    print(out, sheet.size)


main()
