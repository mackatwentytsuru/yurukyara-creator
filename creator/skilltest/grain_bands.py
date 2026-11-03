"""布の粒の強さを、細かさごとに元の絵と比べる。AI の判定はぶれるので、「砂っぽい」「つるつる」を数字で確かめるための道具。

使い方: python grain_bands.py <絵> <x,y,大きさ,頭の幅> [<絵> <x,y,大きさ,頭の幅> …]
  x,y,大きさ: 毛の面だけが写る正方形(目や口を含めない)。中心と 1 辺を、絵の幅に対する割合で書く。
  頭の幅: 頭の幅を、絵の幅に対する割合で書く。粒の細かさをキャラの大きさにそろえるために使う。
出力: 細かさごとの強さ(明るさの揺れ ÷ 平均、%)。細かさは頭の幅に対する %。1 行目の絵を基準に、比も出す。
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

# 頭の幅に対する、ぼかしの半径(%)。隣り合う 2 つの差が 1 つの細かさの帯になる
SCALES_OF_HEAD = (0.1, 0.2, 0.4, 0.8, 1.6, 3.2)
WORK_HEAD_PIXELS = 900  # 頭の幅がこの画素数になるようにそろえて測る
MIN_RADIUS_PIXELS = 0.5


def luminance_patch(path, x, y, size, head):
    im = Image.open(path).convert("L")
    w, h = im.size
    half = size * w / 2
    box = (int(x * w - half), int(y * h - half), int(x * w + half), int(y * h + half))
    scale = WORK_HEAD_PIXELS / (head * w)
    crop = im.crop(box)
    return crop.resize((max(8, int(crop.width * scale)), max(8, int(crop.height * scale))), Image.BICUBIC)


def bands(patch):
    """細かさの帯ごとの揺れの強さ(%)。"""
    blurred = [patch]
    for s in SCALES_OF_HEAD:
        radius = max(MIN_RADIUS_PIXELS, s / 100 * WORK_HEAD_PIXELS)
        blurred.append(patch.filter(ImageFilter.GaussianBlur(radius)))
    arrays = [np.asarray(b, float) for b in blurred]
    mean = arrays[0].mean()
    return [float((arrays[i] - arrays[i + 1]).std() / mean * 100) for i in range(len(SCALES_OF_HEAD))]


def main():
    args = sys.argv[1:]
    if len(args) < 2 or len(args) % 2:
        print(__doc__)
        sys.exit(2)
    print("細かさ(頭の幅の %): " + "  ".join(f"{s:>5}" for s in SCALES_OF_HEAD))
    base = None
    for path, spec in zip(args[0::2], args[1::2]):
        x, y, size, head = (float(v) for v in spec.split(","))
        row = bands(luminance_patch(path, x, y, size, head))
        base = base or row
        name = path.replace("\\", "/").split("/")[-2] + "/" + path.replace("\\", "/").split("/")[-1]
        print("  ".join(f"{v:5.2f}" for v in row) + "  比 " + " ".join(f"{v / b:4.1f}" for v, b in zip(row, base)) + "  " + name)


if __name__ == "__main__":
    main()
