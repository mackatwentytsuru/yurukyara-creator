"""手描きの正面の絵(背景を抜いた PNG)を、色のまとまり(領域)に分ける。黒い線は、いちばん近い領域に半分ずつ配る。
主役ノリーの正面の絵のための台本(領域の名前は、絵の中の位置と大きさで決めている)。

使い方: python creator/d2/from_drawing/regions.py <正面の絵.png> <作業フォルダ>
出力: <作業フォルダ>/regions.npz(領域の番号の地図)と regions_vis.png(確かめの絵)
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, WORK = sys.argv[1], sys.argv[2]
os.makedirs(WORK, exist_ok=True)
im = np.array(Image.open(SRC).convert('RGBA')).astype(np.int32)
H, W = im.shape[:2]
# 元の絵の 6 色(焦げ茶・クリーム・黒・白・ピンク・緑)。描いた人の色をそのまま使う
PAL = {'K': (0, 0, 0), 'B': (80, 64, 60), 'C': (240, 233, 222), 'W': (255, 255, 255), 'P': (228, 178, 188), 'G': (36, 152, 103)}
names = list(PAL)
rgb = im[..., :3]
alpha = im[..., 3]
d = np.stack([((rgb - np.array(PAL[n])) ** 2).sum(-1) for n in names], -1)
cls = np.argmin(d, -1)
cls[alpha < 128] = -1
CI = {n: i for i, n in enumerate(names)}
MID = W * 296.5 / 711   # 左右の真ん中(元の絵は左右対称)


def comps(n, conn=4, min_area=30):
    m = (cls == CI[n]).astype(np.uint8)
    num, lab, st, ce = cv2.connectedComponentsWithStats(m, connectivity=conn)
    out = []
    for j in range(1, num):
        if st[j, cv2.CC_STAT_AREA] >= min_area:
            out.append(dict(mask=(lab == j), area=int(st[j, 4]), cx=float(ce[j, 0]), cy=float(ce[j, 1])))
    return sorted(out, key=lambda c: -c['area'])


K = comps('K', 8)
R = {'line': K[0]['mask']}
# 黒の小さな固まり: 目 2 つ・鼻と口の線
for c in K[1:]:
    if c['area'] > 1500:
        R['nosemouth'] = c['mask']
    else:
        R['eye_r' if c['cx'] < MID else 'eye_l'] = c['mask']   # 絵の左 = キャラの右
for c in comps('B'):
    if c['area'] > 60000:
        R['head_fur'] = c['mask']
    elif c['area'] > 30000:
        R['torso'] = c['mask']
    elif c['cy'] > 600:
        R['flap_r' if c['cx'] < MID else 'flap_l'] = c['mask']
    elif c['cy'] < 150:
        R['ear_r' if c['cx'] < MID else 'ear_l'] = c['mask']
for c in comps('C'):
    if c['area'] > 100000:
        R['lower'] = c['mask']
    elif c['cx'] > 500:
        R['tail'] = c['mask']
    else:
        R['face'] = c['mask']
for c in comps('W'):
    if c['area'] < 1000:
        R['teeth'] = c['mask']
    else:
        R['glove_r' if c['cx'] < MID else 'glove_l'] = c['mask']
R['nose_pad'] = comps('P')[0]['mask']
for c in comps('G'):
    if c['area'] < 600:
        R['bow_knot'] = c['mask']
    else:
        R['bow_r' if c['cx'] < MID else 'bow_l'] = c['mask']
need = {'line', 'nosemouth', 'eye_r', 'eye_l', 'head_fur', 'torso', 'flap_r', 'flap_l', 'ear_r', 'ear_l', 'lower', 'tail', 'face', 'teeth', 'glove_r', 'glove_l', 'nose_pad', 'bow_knot', 'bow_r', 'bow_l'}
if need - set(R):
    sys.exit(f'見つからない領域: {sorted(need - set(R))}')

# 線の太さ: 線の中の距離の最大(骨の上)を見る
dist = cv2.distanceTransform(R['line'].astype(np.uint8), cv2.DIST_L2, 5)
sk = (dist >= ndi.maximum_filter(dist, size=3)) & R['line'] & (dist > 1.5)
print('線の太さの半分(10/50/90/99 %)', [round(float(np.percentile(dist[sk], p)), 2) for p in (10, 50, 90, 99)])
# 領域の番号の地図(線と小さなまとまりは、いちばん近い領域へ)
order = [k for k in sorted(R) if k != 'line']
seed = np.zeros((H, W), np.int32)
for i, k in enumerate(order, start=1):
    seed[R[k]] = i
seed[alpha < 128] = len(order) + 1   # 背景
idx = ndi.distance_transform_edt(seed == 0, return_distances=False, return_indices=True)
cell = seed[idx[0], idx[1]]
np.savez_compressed(os.path.join(WORK, 'regions.npz'), cell=cell, order=np.array(order), line=R['line'], alpha=alpha, cls=cls)
# 確かめの絵(領域ごとに色を変える)
cols = np.random.default_rng(3).integers(40, 230, size=(len(order) + 2, 3))
cols[len(order) + 1] = (255, 255, 255)
vis = cols[cell].astype(np.uint8)
vis[R['line']] = (vis[R['line']] * 0.55).astype(np.uint8)
Image.fromarray(vis).save(os.path.join(WORK, 'regions_vis.png'))
print('領域', len(order), '個:', ' '.join(order))
