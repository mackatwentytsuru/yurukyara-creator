"""主役ノリーの 2D(部品を <g id> で分けた SVG と parts.json)を、部品のマスク(norrie_masks.py の出力)から組み立てる。
ふつうの顔(目・口・前歯)は元の絵のまま。ほかの表情の目・眉・口は、同じ線の太さと色で描き足す。

使い方: python creator/d2/from_drawing/norrie_svg.py <作業フォルダ> characters/norrie/2d
"""
import json
import os
import sys

import cv2
import numpy as np

from vec import _closed_bezier, ero, mask_to_d

WORK, OUT = sys.argv[1], sys.argv[2]
M = dict(np.load(os.path.join(WORK, 'masks.npz')))
H, W = M['body_ink'].shape
AXIS = 296.5
COL = {'brown': '#50403C', 'cream': '#F0E9DE', 'black': '#000000', 'white': '#FFFFFF', 'pink': '#E4B2BC', 'green': '#249867'}


def fill(mask, color, eps=1.5, blur=0.8, holes=True, shrink=2):
    """塗り。塗りの領域は線の真ん中まであるので、2 画素だけ内へ縮めて、線の外へはみ出さないようにする"""
    if shrink:
        mask = ero(mask, shrink)
    d = mask_to_d(mask, eps=eps, blur=blur, holes=holes)
    return f'<path fill="{COL[color]}" fill-rule="evenodd" d="{d}"/>' if d else ''


def ink(mask, eps=0.6, blur=0.55):
    d = mask_to_d(mask, eps=eps, blur=blur, min_area=6)
    return f'<path fill="{COL["black"]}" fill-rule="evenodd" d="{d}"/>' if d else ''


def bbox(*masks, pad=3):
    m = np.zeros((H, W), bool)
    for x in masks:
        m |= x
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min() - pad, xs.max() + 1 + pad, ys.min() - pad, ys.max() + 1 + pad
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def centroid(m):
    ys, xs = np.where(m)
    return float(xs.mean() + 0.5), float(ys.mean() + 0.5)


# ---------- 体の部品 ----------
groups = {}
groups['tail'] = fill(M['tail_fill'], 'cream') + ink(M['tail_ink'])
groups['body'] = (
    f'<g id="torso">{fill(M["torso_fill"], "brown")}</g>'
    f'<g id="belly">{fill(M["belly_fill"], "cream")}</g>'
    f'<g id="body_line">{ink(M["body_ink"])}</g>'
)
for s in ('r', 'l'):
    groups[f'arm_{s}'] = (
        f'<g id="sleeve_{s}">{fill(M[f"sleeve_{s}_fill"], "brown")}</g>'
        f'<g id="glove_{s}">{fill(M[f"glove_{s}_fill"], "white")}</g>'
        f'<g id="arm_{s}_line">{ink(M[f"arm_{s}_ink"])}</g>'
    )
groups['bowtie'] = fill(M['bow_fill'], 'green', eps=0.8) + ink(M['bow_ink'])
groups['head'] = (
    f'<g id="ear_r">{fill(M["ear_r_fill"], "brown")}{ink(M["ear_r_ink"])}</g>'
    f'<g id="ear_l">{fill(M["ear_l_fill"], "brown")}{ink(M["ear_l_ink"])}</g>'
    f'<g id="head_fur">{fill(M["head_fur_fill"], "brown")}</g>'
    f'<g id="face_cream">{fill(M["face_cream_fill"], "cream")}</g>'
    f'<g id="head_line">{ink(M["head_ink"])}</g>'
)

# ---------- 顔の上: 鼻(ピンクの楕円と Y の線)----------
cnts, _ = cv2.findContours(M['nose_pad'].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
(ecx, ecy), (ew, eh), eang = cv2.fitEllipse(max(cnts, key=cv2.contourArea))
ecx += 0.5; ecy += 0.5
ecx = AXIS  # 絵は左右対称
nose_y = M['nose_mark']
muzzle = fill(M['nose_pad'], 'pink', eps=0.6, blur=2.2, holes=False, shrink=0) + fill(nose_y, 'black', eps=0.4, blur=0.5, shrink=0)

# ---------- 目 ----------
er = centroid(M['eye_r'])
el = centroid(M['eye_l'])
r_eye = float(np.sqrt(M['eye_r'].sum() / np.pi))
cy_eye = (er[1] + el[1]) / 2
dx_eye = (el[0] - er[0]) / 2
cx_eye = AXIS
EYES = [(cx_eye - dx_eye, cy_eye), (cx_eye + dx_eye, cy_eye)]


def f1(v):
    s = f'{v:.1f}'
    return s[:-2] if s.endswith('.0') else s


def dots(r=r_eye, dx=0.0, dy=0.0):
    return ''.join(f'<circle cx="{f1(x + dx)}" cy="{f1(y + dy)}" r="{f1(r)}" fill="#000"/>' for x, y in EYES)


def strokes(paths, w=7.0):
    return f'<g fill="none" stroke="#000" stroke-width="{f1(w)}" stroke-linecap="round" stroke-linejoin="round">' + ''.join(f'<path d="{p}"/>' for p in paths) + '</g>'


def mirror_pair(fn):
    """左の目のための形 fn(cx, cy, side) を、両目に。side は -1(絵の左)か +1(絵の右)。鏡に映した形にする"""
    return [fn(x, y, s) for (x, y), s in zip(EYES, (-1, 1))]


def P(*pts):
    return ' '.join(f1(v) for v in pts)


face = {}
face['face.neutral.eyes'] = dots()
face['face.happy.eyes'] = strokes(mirror_pair(lambda x, y, s: f'M{P(x - 15, y + 6)} Q{P(x, y - 18, x + 15, y + 6)}'), 7.5)
face['face.relaxed.eyes'] = strokes(mirror_pair(lambda x, y, s: f'M{P(x - 14, y - 2)} Q{P(x, y + 12, x + 14, y - 2)}'), 7)
face['face.surprised.eyes'] = dots(r_eye * 1.22)
face['face.sad.eyes'] = dots(r_eye * 0.94, dy=2)
face['face.angry.eyes'] = dots(r_eye * 0.94, dy=1)
face['face.think.eyes'] = dots(r_eye * 0.94, dx=5, dy=-5)
# 眉(元の絵には無い。驚き・悲しみ・怒り・考え中のときだけ、細い線で足す)
face['face.surprised.brows'] = strokes(mirror_pair(lambda x, y, s: f'M{P(x - 13, y - 31)} Q{P(x, y - 40, x + 13, y - 31)}'), 6)
# s = -1 は絵の左の目。外側の端 = x + 13s、内側(真ん中より)の端 = x - 12s
face['face.sad.brows'] = strokes(mirror_pair(lambda x, y, s: f'M{P(x + 13 * s, y - 25)} L{P(x - 12 * s, y - 34)}'), 6)   # 内側が上がる
face['face.angry.brows'] = strokes(mirror_pair(lambda x, y, s: f'M{P(x + 13 * s, y - 34)} L{P(x - 12 * s, y - 25)}'), 6.5)  # 内側が下がる
face['face.think.brows'] = strokes([f'M{P(EYES[0][0] - 12, EYES[0][1] - 28)} L{P(EYES[0][0] + 12, EYES[0][1] - 28)}',
                                    f'M{P(EYES[1][0] - 11, EYES[1][1] - 33)} Q{P(EYES[1][0] + 1, EYES[1][1] - 42, EYES[1][0] + 13, EYES[1][1] - 34)}'], 6)

# ---------- 口(元の絵の三日月と前歯 2 本から)----------
teeth = M['teeth']
gy, gx = np.mgrid[0:H, 0:W]
STEM = (np.abs(gx + 0.5 - AXIS) <= 7) & (gy + 0.5 < 335)     # 鼻から下りる縦の線(口の形の上のふちから外す)
mm = (M['mouth_mark'] & ~STEM) | teeth
xs = np.where(mm.any(0))[0]
top = np.array([np.where(mm[:, x])[0].min() for x in xs], float)
bot = np.array([np.where(mm[:, x])[0].max() + 1 for x in xs], float)
xc = xs + 0.5


def smooth(v, k=7):
    pad = np.pad(v, k // 2, mode='edge')
    return np.convolve(pad, np.ones(k) / k, mode='valid')


top_s, bot_s = smooth(top), smooth(bot)
HW = float(np.abs(xc - AXIS).max() + 0.5)
TOP_C = float(np.interp(AXIS, xc, top_s))
teeth_d = mask_to_d(teeth, eps=0.35, blur=0.45, min_area=4)
mouth_closed = fill(M['mouth_mark'], 'black', eps=0.4, blur=0.5, holes=False, shrink=0) + f'<path fill="#FFFFFF" d="{teeth_d}"/>'


def band(D=0.0, sx=1.0, lift=0.0):
    """元の三日月(口の黒い所)の上のふちはそのまま、真ん中ほど下のふちを D 画素深くした形の d。
    両端の細い所は元のまま(口が開くのは真ん中)。sx で横に広げ、lift で両端を上げる(笑う)"""
    u = (xc - AXIS) / HW
    w = np.clip(1 - u ** 2, 0, 1) ** 1.3
    t = top_s - lift * u ** 2
    b = bot_s + D * w - lift * u ** 2
    x = AXIS + (xc - AXIS) * sx
    pts = np.vstack([np.column_stack([x, t]), np.column_stack([x[::-1], b[::-1]])])
    ap = cv2.approxPolyDP(pts.astype(np.float32), 0.4, True)[:, 0, :]
    stem = f'M{P(AXIS - 4.5, 318)} L{P(AXIS + 4.5, 318, AXIS + 4.5, TOP_C + 3, AXIS - 4.5, TOP_C + 3)}Z'   # 鼻の線(幅 9)とつなぐ
    return _closed_bezier(ap, corner_deg=70) + stem


def teeth_at(dx=0.0, dy=0.0, s=1.0):
    return f'<path fill="#FFFFFF" transform="translate({f1(AXIS + dx)} {f1(dy)}) scale({s} 1) translate({f1(-AXIS)} 0)" d="{teeth_d}"/>' if s != 1 or dx or dy else f'<path fill="#FFFFFF" d="{teeth_d}"/>'


def blk(d):
    return f'<path fill="#000" d="{d}"/>'


face['face.neutral.mouth_closed'] = mouth_closed
face['face.neutral.mouth_half'] = blk(band(6)) + teeth_at()
face['face.neutral.mouth_open'] = blk(band(13, sx=1.03)) + teeth_at()
face['face.happy.mouth_closed'] = blk(band(1.5, sx=1.14, lift=4)) + teeth_at(s=1.05)
face['face.happy.mouth_half'] = blk(band(7, sx=1.16, lift=5)) + teeth_at(s=1.05)
face['face.happy.mouth_open'] = blk(band(14, sx=1.18, lift=6)) + teeth_at(s=1.05)
face['face.relaxed.mouth_closed'] = blk(band(0, sx=0.88)) + teeth_at(s=0.95)
mcy = 341.0  # 口の中心の高さ(前歯の上のふちの少し下)
face['face.surprised.mouth_closed'] = f'<ellipse cx="{AXIS}" cy="{mcy + 4}" rx="10" ry="12" fill="#000"/>' + f'<rect x="{AXIS - 6}" y="{mcy - 6}" width="12" height="6" rx="1.5" fill="#FFF"/>'
face['face.surprised.mouth_half'] = f'<ellipse cx="{AXIS}" cy="{mcy + 6}" rx="13" ry="16" fill="#000"/>' + f'<rect x="{AXIS - 7}" y="{mcy - 8}" width="14" height="7" rx="1.5" fill="#FFF"/>'
face['face.surprised.mouth_open'] = f'<ellipse cx="{AXIS}" cy="{mcy + 9}" rx="16" ry="21" fill="#000"/>' + f'<rect x="{AXIS - 8}" y="{mcy - 10}" width="16" height="8" rx="2" fill="#FFF"/>'
face['face.sad.mouth_closed'] = strokes([f'M{P(AXIS - 22, 354)} Q{P(AXIS, 333, AXIS + 22, 354)}'], 7)
# 悲しい口(開き): 上のふちが山になったレンズの形。前歯は山のすぐ下
face['face.sad.mouth_half'] = blk(f'M{P(AXIS - 20, 353)} Q{P(AXIS, 331, AXIS + 20, 353)} Q{P(AXIS, 366, AXIS - 20, 353)}Z') + f'<rect x="{AXIS - 6}" y="341.5" width="12" height="5" rx="1.5" fill="#FFF"/>'
face['face.sad.mouth_open'] = blk(f'M{P(AXIS - 23, 357)} Q{P(AXIS, 326, AXIS + 23, 357)} Q{P(AXIS, 377, AXIS - 23, 357)}Z') + f'<rect x="{AXIS - 7}" y="341" width="14" height="6" rx="1.5" fill="#FFF"/>'
face['face.angry.mouth_closed'] = strokes([f'M{P(AXIS - 18, 349)} Q{P(AXIS, 342, AXIS + 18, 349)}'], 7)
face['face.angry.mouth_half'] = blk(f'M{P(AXIS - 20, 343)} L{P(AXIS + 20, 343)} Q{P(AXIS + 16, 362, AXIS, 362)} Q{P(AXIS - 16, 362, AXIS - 20, 343)}Z') + f'<rect x="{AXIS - 7}" y="343" width="14" height="6" rx="1.5" fill="#FFF"/>'
face['face.angry.mouth_open'] = blk(f'M{P(AXIS - 22, 341)} L{P(AXIS + 22, 341)} Q{P(AXIS + 19, 370, AXIS, 370)} Q{P(AXIS - 19, 370, AXIS - 22, 341)}Z') + f'<rect x="{AXIS - 8}" y="341" width="16" height="7" rx="1.5" fill="#FFF"/>'
face['face.think.mouth_closed'] = strokes([f'M{P(AXIS - 16, 348)} Q{P(AXIS - 6, 340, AXIS + 3, 347)} Q{P(AXIS + 11, 354, AXIS + 19, 344)}'], 7)

# ---------- 箱 ----------
def box_of(*names):
    return bbox(*[M[n] for n in names])


parts = {
    'tail': {'box': box_of('tail_fill', 'tail_ink'), 'z': 0},
    'body': {'box': box_of('torso_fill', 'belly_fill', 'body_ink'), 'z': 1},
    'arm_r': {'box': box_of('sleeve_r_fill', 'glove_r_fill', 'arm_r_ink'), 'z': 2},
    'arm_l': {'box': box_of('sleeve_l_fill', 'glove_l_fill', 'arm_l_ink'), 'z': 2},
    'bowtie': {'box': box_of('bow_fill', 'bow_ink'), 'z': 3},
    'head': {'box': box_of('ear_r_fill', 'ear_l_fill', 'ear_r_ink', 'ear_l_ink', 'head_fur_fill', 'face_cream_fill', 'head_ink'), 'z': 5},
}
ys, xs = np.where(M['belly_fill'] | M['body_ink'])
foot_y = float(ys.max() + 1) - 2.0          # 足の線の下のふち(少し上)を床にする
top_y = float(np.where(M['ear_r_ink'] | M['ear_l_ink'])[0].min()) - 4
vh = round(foot_y - top_y)
vy = round(foot_y - vh)
half_w = max(AXIS - min(p['box'][0] for p in parts.values()), max(p['box'][0] + p['box'][2] for p in parts.values()) - AXIS) + 4
vw = round(half_w * 2)
vx = AXIS - vw / 2
# 回る中心(元の絵の座標)
parts['body']['pivot'] = [AXIS, foot_y]
parts['head']['pivot'] = [AXIS, 452]
cxs, cys = centroid(M['sleeve_r_fill'] & (np.mgrid[0:H, 0:W][0] < 490))
parts['arm_r']['pivot'] = [round(cxs + 6, 1), 474]
parts['arm_l']['pivot'] = [round(2 * AXIS - (cxs + 6), 1), 474]
cxt, _ = centroid(M['tail_fill'] & (np.mgrid[0:H, 0:W][0] > 820))
parts['tail']['pivot'] = [round(cxt, 1), 860]
for p in parts.values():
    p['box'] = [int(v) for v in p['box']]

face_boxes = {
    'eyes': [round(AXIS - 74), round(cy_eye - 31), 148, 62],
    'brows': [round(AXIS - 74), round(cy_eye - 52), 148, 32],
    'mouth': [round(AXIS - 49), 318, 98, 60],
}
mz = [round(ecx - ew / 2 - 4), round(ecy - eh / 2 - 4), round(ew + 8), round(eh + 8)]

spec = {
    'version': 1,
    'id': 'norrie',
    'svg': 'body.svg',
    'viewBox': [round(vx, 1), vy, vw, vh],
    'heightM': 1.0,
    'pxPerUnit': 1.5,
    'waist': [AXIS, foot_y],
    'parts': parts,
    'face': {k: {'box': v} for k, v in face_boxes.items()},
    'faceLayers': [{'id': 'muzzle', 'box': mz}],
    'blink': {'noBlink': ['happy', 'relaxed']},
    'arms': {'front': False},
    'gains': {'arm': 0.7, 'faceParallax': 0.3},
    'expressionFallback': {},
    'source': {'drawing': 'front', 'drawn_by': '協力者', 'palette': COL},
}

# ---------- SVG ----------
head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f1(vx)} {vy} {vw} {vh}" width="{vw}" height="{vh}">\n'
        '<!-- ノリー(セスジキノボリカンガルーの執事見習い)の 2D。協力者が手で描いた正面の絵から、色と形をそのままに部品へ分けて描き直した。\n'
        '     部品は <g id>。顔は face.<表情>.<枠>(枠 = eyes・brows・mouth_closed・mouth_half・mouth_open)、鼻は muzzle。色は元の絵の 6 色だけ。 -->\n')
order = ['tail', 'body', 'arm_r', 'arm_l', 'bowtie', 'head']
body = ''.join(f'<g id="{k}">{groups[k]}</g>\n' for k in order)
body += f'<g id="muzzle">{muzzle}</g>\n'
body += ''.join(f'<g id="{k}">{v}</g>\n' for k, v in face.items())
svg = head + body + '</svg>\n'
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'body.svg'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(svg)
with open(os.path.join(OUT, 'parts.json'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
print('svg bytes', len(svg.encode()), 'viewBox', spec['viewBox'], 'parts', {k: v['box'] for k, v in parts.items()})
print('pivots', {k: v.get('pivot') for k, v in parts.items()})
