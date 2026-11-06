"""輪郭の取り出しと、高さをそろえた形(s03_compare と s05_gaps が使う)。"""
import numpy as np
from PIL import Image


def silhouette(im):
    if im.mode == "RGBA":
        al = np.array(im)[..., 3]
        if al.min() < 250:      # 透明な背景がある絵は、透明さで輪郭を取る(白や明るい部品も体と数える)
            return al > 128
    a = np.array(im.convert("RGB")).astype(int)
    bg = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]), axis=0)
    m = (np.abs(a - bg).sum(axis=2) > 40)
    if bg.min() > 235:
        # 白い背景の絵の、足元の薄い影(色味のない明るい灰色)は体ではない。これを体と数えると、外接箱の高さが伸びて IoU が下がり、抜けの検査(s05)が影の所を抜けと出す
        a_max, a_min = a.max(axis=2), a.min(axis=2)
        m &= ~(((a_max - a_min) < 18) & (a_max > 120))
    from scipy import ndimage as ndi
    return ndi.binary_fill_holes(m)     # 白い文字・目のハイライトなど、体の中の穴は体に数える


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
