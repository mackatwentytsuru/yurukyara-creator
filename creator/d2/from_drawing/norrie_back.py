"""手描きの三面図の後ろ姿(背景を抜いた PNG)から、2D の「後ろ姿の板」のマスクを作る(主役ノリー)。
ノリーが向こうを向いた時に、背中の筋(セスジキノボリカンガルーのしるし)が見えるようにする。

使い方: python creator/d2/from_drawing/norrie_back.py <後ろ姿の絵.png> <作業フォルダ>
出力: <作業フォルダ>/back_masks.npz(茶色・クリーム色・黒 のマスクと、正面の座標へ合わせる横のずれ shift)と back_vis.png
     マスクは後ろ姿の絵の座標のまま。SVG では <g id="back" transform="translate(shift 0)"> で正面の座標に合わせる。

決まり: 色は元の絵の色だけ。後ろ姿の筋の真ん中は、とても暗い灰色(41,40,38)で描かれている。
正面の 6 色(焦げ茶・クリーム・黒・白・ピンク・緑)に無い色なので、いちばん近い暗い色の黒にする(色を足さない)。
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, WORK = sys.argv[1], sys.argv[2]
os.makedirs(WORK, exist_ok=True)
AXIS = 296.5          # 正面の絵の左右の真ん中(regions.py・norrie_masks.py と同じ)
AXIS_BACK = 420.5     # 後ろ姿の絵の左右の真ん中(耳の先と背中の筋の真ん中。三面図の切り抜きの座標)
SHIFT = int(round(AXIS - AXIS_BACK))   # 横にずらす画素(上下は三面図で同じ高さに描いてあるので、ずらさない)

im = np.array(Image.open(SRC).convert('RGBA')).astype(np.int32)
H, W = im.shape[:2]
rgb, alpha = im[..., :3], im[..., 3]
PAL = {'K': (0, 0, 0), 'D': (41, 40, 38), 'B': (80, 64, 60), 'C': (240, 233, 222)}
names = list(PAL)
d = np.stack([((rgb - np.array(PAL[n])) ** 2).sum(-1) for n in names], -1)
cls = np.argmin(d, -1)
sil = alpha >= 128
cls[~sil] = -1
CI = {n: i for i, n in enumerate(names)}


def big(m, min_area=40):
    """小さな固まり(ふちの混ざった色)を外す"""
    num, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=4)
    keep = np.zeros_like(m)
    for j in range(1, num):
        if st[j, cv2.CC_STAT_AREA] >= min_area:
            keep |= lab == j
    return keep


brown = big(cls == CI['B'])
cream = big(cls == CI['C'])
stripe = big(cls == CI['D'], 200)
ink = sil & ~brown & ~cream & ~stripe     # 黒い線(と、ふちの混ざった色)
# 塗りは線の真ん中まで: 線の画素を、いちばん近い塗り(茶色かクリーム色)へ配る
seed = np.zeros((H, W), np.int32)
seed[brown] = 1
seed[cream | stripe] = 2
idx = ndi.distance_transform_edt(seed == 0, return_distances=False, return_indices=True)
near = seed[idx[0], idx[1]]
brown_fill = sil & (near == 1)
cream_fill = sil & (near == 2)


out = {'back_brown': brown_fill, 'back_cream': cream_fill, 'back_ink': ink, 'back_stripe': stripe}
np.savez_compressed(os.path.join(WORK, 'back_masks.npz'), shift=np.array(SHIFT), **out)
vis = np.full((H, W, 3), 205, np.uint8)
for k, c in (('back_brown', (80, 64, 60)), ('back_cream', (240, 233, 222)), ('back_ink', (0, 0, 0)), ('back_stripe', (0, 0, 0))):
    vis[out[k]] = c
cv2.imwrite(os.path.join(WORK, 'back_vis.png'), vis[..., ::-1])
print('後ろ姿のマスク: 正面の座標へは横に', SHIFT, '画素。茶色', int(brown_fill.sum()), 'クリーム色', int(cream_fill.sum()), '線', int(ink.sum()), '筋の真ん中', int(stripe.sum()))
