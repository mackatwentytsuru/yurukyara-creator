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
