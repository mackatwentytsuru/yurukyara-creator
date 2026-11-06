"""領域の地図(regions.py の出力)から、部品ごとの塗りと線のマスクを作る(主役ノリーの正面)。
部品の分け方・隠れた所(腕の下・頭の下・手袋の下)の埋め方は、この絵のために決めた。

使い方: python creator/d2/from_drawing/norrie_masks.py <作業フォルダ>
出力: <作業フォルダ>/masks.npz と parts_vis.png・body_only_vis.png(確かめの絵)
"""
import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

from vec import dil, ero

WORK = sys.argv[1]
Z = np.load(os.path.join(WORK, 'regions.npz'))
cell, order, line, alpha = Z['cell'], list(Z['order']), Z['line'], Z['alpha']
H, W = cell.shape
BG = len(order) + 1


def g(n):
    return cell == (order.index(n) + 1)


bg = cell == BG
yy, xx = np.mgrid[0:H, 0:W]
X = xx + 0.5
Y = yy + 0.5   # 画素の中心
AXIS = 296.5
LW = 8   # 線の幅の半分の上限 + 少し

torso = g('torso')


def arm_side(xm):
    """腕の切れ目の外側か。xm は左側(キャラの右腕)の座標に鏡で直した x"""
    xl = 211 + (Y - 425) * (17 / 115)
    return (xm < xl) & (Y > 400)


arm_r_area = torso & arm_side(X)
arm_l_area = torso & arm_side(2 * AXIS - X)
glove_r, glove_l = g('glove_r'), g('glove_l')
head_cells = g('head_fur') | g('face') | g('ear_r') | g('ear_l')
bow_cells = g('bow_r') | g('bow_l') | g('bow_knot')
flaps = g('flap_r') | g('flap_l')
lower = g('lower')
tail = g('tail')


def ink_near(m, r=LW):
    return line & dil(m, r)


M = {}
# --- 頭 ---
M['ear_r_fill'] = g('ear_r')
M['ear_l_fill'] = g('ear_l')
M['ear_r_ink'] = ink_near(g('ear_r'))
M['ear_l_ink'] = ink_near(g('ear_l'))
M['head_fur_fill'] = g('head_fur') | g('eye_r') | g('eye_l')
M['face_cream_fill'] = g('face') | g('nose_pad') | g('nosemouth') | g('teeth')
M['head_ink'] = ink_near(g('head_fur') | g('face'))
# --- 蝶ネクタイ ---
M['bow_fill'] = bow_cells
M['bow_ink'] = ink_near(bow_cells)
# --- 腕(袖と手袋)---
for s, area, glove in (('r', arm_r_area, glove_r), ('l', arm_l_area, glove_l)):
    ink = ink_near(area | glove)
    ink &= ~ink_near(head_cells)
    ink &= ~ink_near(bow_cells, 7)
    M[f'sleeve_{s}_fill'] = area
    M[f'glove_{s}_fill'] = glove
    M[f'glove_{s}_ink'] = ink_near(glove)
    M[f'arm_{s}_ink'] = ink
# --- 体: 茶色(胴・脇)とクリーム色(お腹・下・足)---
# 手袋と蝶ネクタイの下は、近い方(胴・脇か、お腹)の色で埋める
seed = np.zeros((H, W), np.int32)
seed[torso | flaps] = 1
seed[lower] = 2
idx = ndi.distance_transform_edt(seed == 0, return_distances=False, return_indices=True)
near = seed[idx[0], idx[1]]
# 蝶ネクタイの下は近い方(いつも蝶ネクタイが前にあるので見えない)
brown_share = bow_cells & (near == 1)
cream_share = bow_cells & (near == 2)


def side_curve(side):
    """手袋の下のお腹のふち: 手袋の上で切れたお腹の線の端と、手袋の下から始まる脇の線の端を、なめらかな曲線でつなぐ。
    side = 'r'(絵の左)か 'l'(絵の右)。戻り値は曲線の点の列(画素の座標)"""
    half = (X < AXIS) if side == 'r' else (X >= AXIS)
    glove = glove_r if side == 'r' else glove_l
    gz = dil(glove, 10)
    upper_edge = line & dil(torso, LW) & dil(lower, LW) & half & ~dil(glove, LW + 1)
    low_edge = line & dil(flaps, LW) & dil(lower, LW) & half & ~dil(glove, LW + 1)
    # 手袋に近い端の点(線の中心に近い所)
    def end_near(m, prefer):
        ys, xs = np.where(m & dil(glove, LW + 8))
        if not len(ys):
            raise SystemExit(f'端が見つからない {side} {prefer}')
        pts = np.column_stack([xs + 0.5, ys + 0.5])
        tip = pts[np.argmax(pts[:, 1])] if prefer == 'bottom' else pts[np.argmin(pts[:, 1])]
        # 線の端の真ん中(端の画素から 7 画素までの線の重心)。端の 1 画素だと線のふちに寄り、つなぎ目に段ができる
        return pts[np.linalg.norm(pts - tip, axis=1) <= 7].mean(axis=0)
    p0 = end_near(upper_edge, 'bottom')
    p1 = end_near(low_edge, 'top')
    # 向き: 端から 25 画素ほど離れた所の点との差
    def direction(m, p, away):
        ys, xs = np.where(m)
        pts = np.column_stack([xs + 0.5, ys + 0.5])
        dd = np.linalg.norm(pts - p, axis=1)
        sel = pts[(dd > 18) & (dd < 32)]
        sel = sel[(sel[:, 1] < p[1])] if away == 'up' else sel[(sel[:, 1] > p[1])]
        q = sel.mean(axis=0)
        v = p - q
        return v / np.linalg.norm(v)
    t0 = direction(upper_edge, p0, 'up')     # 上から下りてくる向き
    t1 = -direction(low_edge, p1, 'down')    # 下の線へ入っていく向き
    L = np.linalg.norm(p1 - p0)
    c0 = p0 + t0 * L * 0.4
    c1 = p1 - t1 * L * 0.4
    ts = np.linspace(0, 1, 40)[:, None]
    curve = (1 - ts) ** 3 * p0 + 3 * (1 - ts) ** 2 * ts * c0 + 3 * (1 - ts) * ts ** 2 * c1 + ts ** 3 * p1
    return curve, t0, t1


edge_under = np.zeros((H, W), bool)
for s, glove in (('r', glove_r), ('l', glove_l)):
    curve, t0, t1 = side_curve(s)
    m = np.zeros((H, W), np.uint8)
    # 線の太さは元の絵の線と同じ 12。両端は今の線の中へ 7 画素のばして重ね、手袋のまわり 15 画素まで残す
    # (前は太さ 9・手袋のまわり 8 画素までで、手を振ると つなぎ目の段と、すき間の透けが見えた)
    ext = np.vstack([[curve[0] - t0 * 7], curve, [curve[-1] + t1 * 7]])
    cv2.polylines(m, [np.round(ext * 4).astype(np.int32)], False, 1, thickness=12, lineType=cv2.LINE_8, shift=2)
    # 止まっている時に前腕(ひじから下の袖・手袋・その線)が隠す所だけに描く(止まっている時の絵を変えない)
    hidden = ((g('torso') & arm_side(X if s == 'r' else 2 * AXIS - X) & (Y >= 622)) | glove | M[f'arm_{s}_ink']) & (Y >= 622)
    edge_under |= m.astype(bool) & dil(glove, LW + 7) & hidden
    # 曲線より内側(体の真ん中の側)はクリーム色、外側は茶色。曲線の両端は、線の向きのまま 120 画素のばす
    inner = np.zeros((H, W), np.uint8)
    top = curve[0] - t0 * 120
    bot = curve[-1] + t1 * 120
    poly = np.vstack([[top], curve, [bot], [[AXIS, bot[1]], [AXIS, top[1]]]])
    cv2.fillPoly(inner, [np.round(poly * 4).astype(np.int32)], 1, shift=2)
    cream_share |= glove & inner.astype(bool)
    brown_share |= glove & ~inner.astype(bool)
# 首: 頭の下(あごの少し上まで)を胴の茶色で埋める。胴の凸包の中だけ
hull = np.zeros((H, W), np.uint8)
pts = np.column_stack(np.where(torso))[:, ::-1].astype(np.int32)
cv2.fillConvexPoly(hull, cv2.convexHull(pts), 1)
neck = head_cells & (Y >= 392) & hull.astype(bool)
M['torso_fill'] = torso | flaps | brown_share | neck
M['belly_fill'] = lower | cream_share
body_cells = torso | flaps | lower
bink = ink_near(body_cells)
bink &= ~ink_near(head_cells)
bink &= ~ink_near(glove_r | glove_l)
forearm = ink_near(arm_r_area | arm_l_area) & ink_near(flaps)
bink &= ~(forearm & ~dil(bg, 3))
bink &= ~ink_near(bow_cells, LW)   # 蝶ネクタイの輪郭は蝶ネクタイの物
# 手袋の下のお腹のふち(手袋をどけた時に、お腹の線が続くように)
bink |= edge_under
# 外の輪郭は残す(頭の近くで消えた分を戻す)
bink |= line & dil(body_cells, LW) & dil(bg, 7) & ~ink_near(head_cells, 5)
M['body_ink'] = bink
# --- しっぽ ---
M['tail_fill'] = tail
M['tail_ink'] = ink_near(tail)
# --- 顔の上(鼻・口・目)---
nm = g('nosemouth')
mouth_mark = nm & ((Y >= 327) | ((Y >= 312) & (np.abs(X - AXIS) > 12)))
M['nose_mark'] = nm & ~mouth_mark
M['mouth_mark'] = mouth_mark | (nm & (Y >= 322) & (np.abs(X - AXIS) <= 12))   # 鼻の線と 5 画素重ねて、つなぎ目を見せない
M['teeth'] = g('teeth')
M['nose_pad'] = g('nose_pad') | nm | g('teeth')
M['eye_r'] = g('eye_r')
M['eye_l'] = g('eye_l')

# --- 腕を 2 枚に分ける(上腕と前腕。手を振る時にひじで曲げる。2026-11-07)---
# 上腕は胴の後ろに置く: 手を上げた時、肩の継ぎ目は胴(体の色)の塗りと線が隠す。止まっている時は胴にすっかり隠れる。
# 前腕(ひじから下の袖と手袋)は胴の前。ひじは丸く: 上腕の先に丸(線つき)、前腕の元に少し小さい丸(線なし)。
ELBOW_Y = 622                 # 袖を横に切る高さ(袖がいちばん外へふくらむ所)
SHOULDER = (181.0, 496.0)     # キャラの右肩(絵の左)の回る中心。左肩は左右の鏡
SHOULDER_R = 55               # 上腕は、肩の丸(この半径)とひじへ向かう管だけを持つ(胴の上へはみ出さない)
RING_W = 12                   # ひじの丸の線の太さ(元の絵の線の太さ)
above = Y < ELBOW_Y
JOINTS = {}
for s, area, glove in (('r', arm_r_area, glove_r), ('l', arm_l_area, glove_l)):
    xs = np.where(area[ELBOW_Y])[0]
    ex = float(xs.min() + xs.max() + 1) / 2
    er = float(xs.max() + 1 - xs.min()) / 2    # 袖の幅の半分(線の真ん中まで)
    sx = SHOULDER[0] if s == 'r' else 2 * AXIS - SHOULDER[0]
    S = np.array([sx, SHOULDER[1]])
    E = np.array([ex, float(ELBOW_Y)])
    d = (E - S) / np.linalg.norm(E - S)
    tube = ((X - S[0]) * d[0] + (Y - S[1]) * d[1]) >= 0
    near_s = (X - S[0]) ** 2 + (Y - S[1]) ** 2 <= SHOULDER_R ** 2
    de = np.sqrt((X - E[0]) ** 2 + (Y - E[1]) ** 2)
    keep = above & (tube | near_s)
    arm_ink = M[f'arm_{s}_ink']
    M[f'upper_{s}_fill'] = (area & keep) | ((de <= er) & ~above)
    M[f'upper_{s}_ink'] = (arm_ink & keep) | ((np.abs(de - er) <= RING_W / 2) & ~above)
    # 大きく曲げた時は、前腕を上腕の後ろへ回す(parts.json の arms.foreBehind)。前腕の線の元は上腕のひじの丸に隠れる
    M[f'fore_{s}_fill'] = (area & ~above) | ((de <= er - 5) & above & ero(area, 7))
    M[f'fore_{s}_ink'] = arm_ink & ~above
    JOINTS[s] = {'shoulder': [round(float(S[0]), 1), round(float(S[1]), 1)], 'elbow': [round(ex, 1), float(ELBOW_Y)], 'elbow_r': round(er, 1)}
M['joints'] = np.array(json.dumps(JOINTS))
np.savez_compressed(os.path.join(WORK, 'masks.npz'), **M)

# 確かめの絵: 部品ごとに色を変えて重ねる
vis = np.full((H, W, 3), 255, np.uint8)
layers = [('tail_fill', (230, 210, 160)), ('torso_fill', (120, 90, 80)), ('belly_fill', (235, 225, 200)), ('body_ink', (0, 0, 0)), ('tail_ink', (90, 60, 0)),
          ('upper_r_fill', (60, 90, 200)), ('upper_l_fill', (60, 160, 200)), ('fore_r_fill', (150, 110, 220)), ('fore_l_fill', (110, 190, 230)),
          ('glove_r_fill', (250, 250, 250)), ('glove_l_fill', (250, 250, 250)),
          ('arm_r_ink', (0, 0, 160)), ('arm_l_ink', (0, 120, 160)), ('bow_fill', (40, 160, 100)), ('bow_ink', (0, 80, 0)),
          ('ear_r_fill', (150, 60, 60)), ('ear_l_fill', (150, 60, 60)), ('head_fur_fill', (110, 70, 60)), ('face_cream_fill', (240, 230, 210)),
          ('ear_r_ink', (60, 0, 0)), ('ear_l_ink', (60, 0, 0)), ('head_ink', (40, 0, 0)), ('nose_pad', (230, 170, 190)), ('nose_mark', (0, 0, 0)),
          ('mouth_mark', (0, 0, 0)), ('teeth', (255, 255, 255)), ('eye_r', (0, 0, 0)), ('eye_l', (0, 0, 0))]
for k, c in layers:
    vis[M[k]] = c
cv2.imwrite(os.path.join(WORK, 'parts_vis.png'), vis[..., ::-1])
# 体だけ(腕・頭・蝶ネクタイを外した下地)
vis2 = np.full((H, W, 3), 255, np.uint8)
for k, c in [('tail_fill', (240, 233, 222)), ('tail_ink', (0, 0, 0)), ('torso_fill', (80, 64, 60)), ('belly_fill', (240, 233, 222)), ('body_ink', (0, 0, 0))]:
    vis2[M[k]] = c
cv2.imwrite(os.path.join(WORK, 'body_only_vis.png'), vis2[..., ::-1])
print('部品のマスク', len(M), '個')
