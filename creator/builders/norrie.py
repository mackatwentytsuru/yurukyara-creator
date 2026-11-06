"""ノリー(セスジキノボリカンガルーの子の執事見習い)の手組み builder。三面図(正面・横・後ろ)から組む。
元の絵: 透明の地の 1137×1137 の 3 枚(縮尺 S = 1040 px/m、地面 FY = 1076、全高 約 1.0 m)。
  正面(-Y から見た絵)X = (px - 568.5) / S、画面の右 = +X = キャラの左。
  横(キャラの左の側面)Y = (px - 568.5) / S、顔は画面の左 = -Y。
  後ろ(+Y から見た絵)X = (568.5 - px) / S。
体と頭は P.loft(正面の絵から半幅、横の絵から前後の端)、しっぽは P.tube(正面と横と後ろの 3 枚で 3D の中心線)。
輪郭は P.outline の殻(黒・背面を描かない)。毛の殻は使わない(平らな塗り)。
使い方: blender -b -P norrie.py -- <出力.blend> work=<作業フォルダ>"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m01_wrap as W  # noqa: E402

S = 1040.0
CX, FY = 568.5, 1076.0
WORK = "."
OL = 0.007          # 輪郭の殻の厚み(元の絵の黒い線は 7〜8px)
OL_SMALL = 0.004


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


# ---- 色(元の絵の画素を測った値。平らな塗り) ----
# 元の絵の色は (80,63,62)・(242,231,224)・(38,152,104)。ブラウザの光で明るく出るので、描く色は少し暗く置く
BROWN = (71, 56, 55)
CREAM = (216, 205, 198)
PINK = (230, 177, 188)
GREEN = (34, 142, 97)
WHITE = (232, 232, 232)
STRIPE = (38, 38, 38)
BLACK = (8, 8, 8)

# ---- 頭の断面: (py, 半幅 px, 前の端 px(横の絵), 後ろの端 px(横の絵))。輪郭の線(7px)を含む外形 ----
HEAD = [(80, 6, 395, 425), (86, 60, 340, 458), (100, 108, 292, 478), (130, 150, 246, 528), (160, 162, 226, 547),
        (190, 180, 215, 562), (220, 194, 205, 570), (250, 206, 172, 575), (280, 215, 150, 576), (310, 218, 152, 570),
        (340, 208, 158, 559), (370, 180, 168, 540), (400, 152, 194, 515), (425, 126, 230, 500), (445, 98, 275, 478),
        (461, 45, 340, 440)]
# ---- 胴の断面(同じ書き方) ----
BODY = [(424, 108, 352, 515), (450, 128, 348, 565), (480, 148, 342, 598), (520, 152, 338, 642), (560, 146, 338, 676),
        (600, 144, 342, 706), (640, 150, 352, 730), (680, 165, 372, 750), (720, 186, 394, 764), (760, 192, 410, 774),
        (800, 200, 416, 778), (840, 214, 412, 778), (880, 224, 408, 773), (910, 231, 402, 772), (940, 231, 398, 765),
        (970, 219, 398, 745), (1000, 213, 402, 712), (1030, 195, 392, 665), (1055, 160, 388, 620), (1068, 110, 395, 590)]

# しっぽの中心線(X: 正面と後ろの絵、Y: 横の絵、Z: 同じ高さ)。付け根は体の中、先は少し手前へ曲がる
TAIL = [(0.0, 0.13, 0.085), (0.07, 0.19, 0.102), (0.14, 0.25, 0.13), (0.19, 0.30, 0.18), (0.237, 0.333, 0.246),
        (0.272, 0.355, 0.304), (0.300, 0.369, 0.362), (0.319, 0.376, 0.419), (0.326, 0.374, 0.477), (0.324, 0.366, 0.535),
        (0.309, 0.346, 0.592), (0.291, 0.320, 0.640), (0.272, 0.296, 0.682), (0.257, 0.278, 0.705)]
TAIL_R = [0.027, 0.027, 0.026, 0.025, 0.0235, 0.0225, 0.022, 0.0215, 0.021, 0.0205, 0.020, 0.0195, 0.0185, 0.0155]

# 腕(キャラの左 +X。右は X を反転)。肩 → ひじ → 手首。半径は輪郭を除いた値
ARM = [(0.11, -0.065, 0.56), (0.148, -0.09, 0.51), (0.17, -0.115, 0.47), (0.158, -0.17, 0.39), (0.117, -0.226, 0.337)]
ARM_R = [0.036, 0.04, 0.038, 0.037, 0.032]
# 手袋: 平たい楕円体(長い軸が手首→指先)。中心と向きは元の絵の白い所(正面 重心 (474,737)・長軸 27° 下、横 重心 (315,742)・長軸 39° 下)から
HAND_C = (0.0885, -0.2447, 0.3226)            # キャラの左(+X)。右は X を反転
HAND_DIR = (-0.772, -0.497, -0.395)         # 手首→指先(おなか側・前・少し下)
HAND_R = (0.031, 0.027, 0.057)              # (幅, 厚み, 長さ)。長さが指先の向き
CUFF_R, CUFF_W = 0.0355, 0.008             # 袖口の帯: 外側の半径・軸方向の半幅(手首に密着)

# 耳の断面(元の絵の輪郭から 7px 縮めた、左の耳(画面の左)。(py, 正面の左端, 正面の右端, 横の前端, 横の後ろ端))
EAR_ROWS = [(175, 428, 495, 445, 530), (160, 411, 514, 441, 536), (130, 407, 505, 445, 527), (100, 407, 495, 449, 523),
            (88, 408, 486, 458, 522), (80, 408, 480, 466, 520), (72, 409, 472, 474, 519), (64, 413, 462, 483, 517),
            (58, 421, 446, 491, 513)]

# ---- 顔(正面の絵の画素) ----
MASK_ROWS = [(224, 566, 571), (230, 557, 580), (236, 551, 586), (242, 544, 593), (248, 537, 600), (254, 529, 608), (260, 522, 615),
             (266, 515, 622), (272, 510, 627), (278, 504, 633), (284, 499, 638), (290, 495, 642), (296, 490, 647), (302, 486, 649),
             (308, 482, 655), (314, 479, 658), (320, 475, 662), (326, 472, 665), (332, 470, 667), (338, 467, 670), (344, 466, 671),
             (350, 464, 673), (356, 463, 674), (362, 462, 675), (368, 462, 675), (374, 461, 676), (380, 461, 676), (386, 461, 676),
             (392, 462, 675), (398, 463, 674), (404, 464, 673), (410, 466, 671), (416, 468, 669), (422, 471, 666), (428, 479, 658),
             (434, 489, 648), (440, 504, 637)]
BELLY_ROWS = [(528, 548, 590), (540, 490, 647), (570, 469, 668), (600, 454, 683), (630, 446, 691), (660, 441, 696), (690, 438, 699),
              (750, 437, 700), (790, 438, 699), (810, 443, 694), (825, 430, 707), (840, 411, 726), (855, 393, 744), (870, 376, 761),
              (885, 358, 779), (900, 340, 797), (930, 300, 837), (960, 300, 837), (990, 300, 837), (1020, 300, 837),
              (1052, 300, 837)]
NOSE_C, NOSE_R = (567.0, 310.5), (48.0, 58.0)
# 目: 元の絵の黒い丸(正面で直径 約 32px)を測った中心。黒い玉(頭に半分埋めた楕円体)で作る
EYE_C = (521.4, 211.7), (615.6, 211.7)
EYE_R = (15.9, 17.4)       # 縦は少し高く(頭の面の斜めで下が埋まる分。正面で丸く見える)
EYE_BULGE = float(os.environ.get("EYE_BULGE", 0.0045))      # 玉の赤道の面から前へのふくらみ(m)。出すぎると横から飛び出して見える
EYE_TILT = float(os.environ.get("EYE_TILT", 20.0))         # 玉の軸の向き(度)。頭の面の法線(上へ約 23°)でなく、ほぼ正面(-Y)に寄せる。上向きが正
EYE_CLEAR = float(os.environ.get("EYE_CLEAR", -0.003))      # 赤道の輪が頭の面から前へ出る最小の量(m)。頭の面が斜めでも輪が埋まらず、輪郭が円で出る
# 口: 黒い所の列ごとの (x, 上の縁 py, 下の縁 py)(正面の絵を測った値)。中央の人中は別の線
MOUTH_COLS = [(530, 326, 326), (534, 323, 332), (538, 325, 338), (542, 328, 341), (546, 330, 346), (550, 331, 351), (554, 332, 355),
              (558, 331, 359), (562, 330, 361), (566, 330, 362), (570, 330, 362), (574, 330, 361), (578, 331, 359), (582, 332, 356),
              (586, 331, 352), (590, 330, 347), (594, 328, 341), (598, 326, 338), (602, 323, 335), (606, 324, 326)]
TEETH = [((556, 567), 339, 351), ((570, 581), 339, 351)]
MOUTH_KEYS = {"mouth_open": (1.8, 1.0), "mouth_wide": (1.0, 1.3), "mouth_o": (1.3, 0.5)}
MOUTH_NU = 20


def smooth_path(pts, radii, k=4):
    """折れ線の中心線と半径を、Catmull-Rom で k 分割して滑らかにする(肩やひじの角を消す)。"""
    out, rr = [], []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        r0, r1, r2, r3 = radii[max(i - 1, 0)], radii[i], radii[i + 1], radii[min(i + 2, n - 1)]
        for j in range(k):
            t = j / k
            f = lambda a, b, c, d: 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3)
            out.append(tuple(f(p0[m], p1[m], p2[m], p3[m]) for m in range(3)))
            rr.append(f(r0, r1, r2, r3))
    out.append(tuple(pts[-1]))
    rr.append(radii[-1])
    return out, rr


def group(ob, bone):
    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


def interp(rows, py, k):
    """rows = [(py, ...)] を py で補間して、k 番目の値を返す。"""
    ys = [r[0] for r in rows]
    vs = [r[k] for r in rows]
    if py <= ys[0]:
        return vs[0]
    for i in range(len(ys) - 1):
        if ys[i] <= py <= ys[i + 1]:
            t = (py - ys[i]) / (ys[i + 1] - ys[i])
            return vs[i] + (vs[i + 1] - vs[i]) * t
    return vs[-1]


def secs_from(rows, top_shift=True):
    """(py, 半幅, 前の端, 後ろの端)の外形から、輪郭の殻を引いた断面にする。両端の z は殻の分だけ内へ寄せる。"""
    out = []
    for i, (py, hw, f, b) in enumerate(rows):
        z = Z(py)
        if i == 0:
            z -= OL
        if i == len(rows) - 1:
            z += OL
        out.append(dict(z=z, cx=0.0, cy=((f + b) / 2 - CX) / S, rx=max((hw - 7) / S, 0.004), ry=max(((b - f) / 2 - 7) / S, 0.004)))
    return out


def ray_surface(ob):
    me = ob.data
    me.calc_loop_triangles()
    bvh = BVHTree.FromPolygons([ob.matrix_world @ v.co for v in me.vertices], [tuple(t.vertices) for t in me.loop_triangles],
                               all_triangles=True)

    def surf(x, z):
        hit = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0.0, 1.0, 0.0)), 4.0)[0]
        if hit is None:
            raise RuntimeError("面に当たらない (%.3f, %.3f)" % (x, z))
        return hit.y

    def surfn(x, z):
        hit, nor = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0.0, 1.0, 0.0)), 4.0)[:2]
        if hit is None:
            raise RuntimeError("面に当たらない (%.3f, %.3f)" % (x, z))
        if nor.y > 0:
            nor = -nor
        return hit, nor
    surf.n = surfn
    return surf


def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()


def grid_mesh(name, grids, mat, mats=None):
    """grids: [(点の 3D の 2 次元配列 [行][列], 前向きか)] を 1 つの網にする。行は下へ(z が小さくなる向き)、列は +x の向き。"""
    verts, faces = [], []
    for g, front in grids:
        base = len(verts)
        nv, nu = len(g), len(g[0])
        for row in g:
            verts.extend(tuple(p) for p in row)
        for i in range(nv - 1):
            for j in range(nu - 1):
                a = base + i * nu + j
                q = (a, a + nu, a + nu + 1, a + 1)      # 画面の正面(-Y)から見て表
                faces.append(q if front else tuple(reversed(q)))
    return P._make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))


def px_grid(pts2, surf, off):
    """画素の点の 2 次元配列を、頭(体)の面から off(m、手前が正)だけ手前の 3D の点にする。"""
    out = []
    for row in pts2:
        r = []
        for px, py in row:
            x, z = X(px), Z(py)
            hit, nor = surf.n(x, z)
            nor = nor.normalized()
            r.append((hit.x + nor.x * off, hit.y + nor.y * off, hit.z + nor.z * off))
        out.append(r)
    return out


def rows_to_pts(rows, ncols, grow=0.0, clip=None):
    """行ごとの (py, x0, x1) から、点の格子(画素)を作る。grow は外へ広げる量(px)。clip(py) があれば半幅の上限(中心 CX から)。"""
    pts = []
    n = len(rows)
    for k, (py, x0, x1) in enumerate(rows):
        yy = py - (grow if k == 0 else 0)
        a, b = x0 - grow, x1 + grow
        if clip:
            lim = clip(py)
            a, b = max(a, CX - lim), min(b, CX + lim)
        pts.append([(a + (b - a) * j / ncols, yy) for j in range(ncols + 1)])
    return pts


def plate(name, rows, surf, front, back, mat, ncols=14, grow=0.0, clip=None):
    """行ごとの範囲で作る、体の面に沿う板(前の板と、面の奥へ沈めた後ろの板)。"""
    pts = rows_to_pts(rows, ncols, grow, clip)
    gs = [(px_grid(pts, surf, front), True)]
    if back:          # 大きな当て布は後ろの板を作らない(三角形を節約)
        gs.append((px_grid(pts, surf, -back), False))
    ob = grid_mesh(name, gs, mat)
    return ob


def ribbon(name, center, widths, surf, off, mat):
    """画素の中心線に沿う、幅つきの細い帯(人中・鼻の上の線)。"""
    pts = []
    n = len(center)
    for i, (px, py) in enumerate(center):
        a = center[max(i - 1, 0)]
        b = center[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        w = widths[i] / 2
        pts.append([(px - nx * w, py - ny * w), (px, py), (px + nx * w, py + ny * w)])
    g = px_grid(pts, surf, off)
    # 行 = 中心線に沿う向き、列 = 幅の向き。grid_mesh は 行 → 列 の順なので、そのまま使う(向きはあとで法線を直す)
    ob = grid_mesh(name, [(g, True)], mat)
    fix_to_front(ob)
    return ob


def fix_to_front(ob):
    """板の面が -Y(見る人の側)を向くようにそろえる。"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    bad = [f for f in bm.faces if f.normal.y > 0]
    bmesh.ops.reverse_faces(bm, faces=bad)
    bm.to_mesh(me)
    bm.free()


def ellipse_rows(c, r, n=24, margin=0.0):
    rows = []
    for k in range(n + 1):
        t = -1 + 2 * k / n
        t = max(-0.999, min(0.999, t))
        py = c[1] + r[1] * t
        hw = (r[0] + margin) * math.sqrt(1 - t * t)
        rows.append((py, c[0] - hw, c[0] + hw))
    return rows


def mouth_pts(k, fw):
    """口の黒い板の点(画素)。列ごとに上の縁から下の縁へ。k は下の縁の深さの倍率、fw は幅の倍率。"""
    pts = []
    for (x, top, bot) in MOUTH_COLS:
        xx = 568.0 + (x - 568.0) * fw
        yb = top + (bot - top) * k
        pts.append([(xx, top + (yb - top) * i / 6) for i in range(7)])
    # grid は「行 = 列の位置」なので、行 × 列を入れ替えて、grid_mesh の向き(行は下へ、列は +x)に合わせる
    return [list(r) for r in zip(*pts)]


def mouth_mesh(surf, mats):
    """口: 黒い板(前と後ろ)+ 白い前歯 2 本。mouth_open・mouth_wide・mouth_o のシェイプキー(口の下の縁と幅を動かす)。"""
    def build(k, fw):
        dark = mouth_pts(k, fw)
        grids = [px_grid(dark, surf, 0.0042), px_grid(dark, surf, -0.0015)]
        teeth = []
        for (x0, x1), y0, y1 in TEETH:
            xs = [x0, (x0 + x1) / 2, x1]
            tp = [[(x, y0 + (y1 - y0) * i / 2) for x in xs] for i in range(3)]
            teeth.append(px_grid(tp, surf, 0.0054))
        return grids, teeth
    grids, teeth = build(1.0, 1.0)
    allg = [(grids[0], True), (grids[1], False)] + [(t, True) for t in teeth]
    nd = 2 * len(grids[0]) * len(grids[0][0])
    verts, faces, fmat = [], [], []
    for gi, (g, front) in enumerate(allg):
        base = len(verts)
        nv, nu = len(g), len(g[0])
        for row in g:
            verts.extend(tuple(p) for p in row)
        for i in range(nv - 1):
            for j in range(nu - 1):
                a = base + i * nu + j
                q = (a, a + nu, a + nu + 1, a + 1)
                faces.append(q if front else tuple(reversed(q)))
                fmat.append(0 if gi < 2 else 1)
    mo = P._make("Mouth", verts, faces, mats["mouth"], (0, 0, 0), (0, 0, 0))
    mo.data.materials.append(mats["white"])
    for p, m in zip(mo.data.polygons, fmat):
        p.material_index = m
    mo.shape_key_add(name="Basis")
    for name, (k, fw) in MOUTH_KEYS.items():
        key = mo.shape_key_add(name=name)
        g2, t2 = build(k, fw)
        pts = []
        for g in [g2[0], g2[1]] + t2:
            for row in g:
                pts.extend(row)
        for i, p in enumerate(pts):
            key.data[i].co = Vector(p)
        key.value = 0.0
    return mo


def build_face(surf_head, mats):
    parts = {}
    # 顔の仮面(クリーム)と、その縁の黒い線(少し大きい黒い板を 1 mm 奥に)
    mask_line = plate("mask_line", MASK_ROWS, surf_head, 0.0010, 0, mats["black"], ncols=20, grow=5.0)
    mask = plate("mask", MASK_ROWS, surf_head, 0.0022, 0, mats["cream"], ncols=20)
    nose = plate("nose", ellipse_rows(NOSE_C, NOSE_R, 22), surf_head, 0.0030, 0.0025, mats["pink"], ncols=16)
    # 鼻の上の線(2 本の弧)と人中
    arcL = ribbon("nose_arc_L", [(547, 269), (554, 276), (561, 282), (568, 284)], [4, 8, 9, 8], surf_head, 0.0052, mats["black"])
    arcR = ribbon("nose_arc_R", [(591, 269), (584, 276), (577, 282), (569, 284)], [4, 8, 9, 8], surf_head, 0.0052, mats["black"])
    phil = ribbon("philtrum", [(569, 282), (569, 300), (569, 322), (569, 334)], [9, 8, 8, 9], surf_head, 0.0052, mats["black"])
    mouth = mouth_mesh(surf_head, mats)
    parts["flat"] = [mask_line, mask, nose, arcL, arcR, phil]
    parts["Mouth"] = mouth
    # 目: 黒い玉(頭に半分埋めた楕円体)。向きは頭の面の法線でなく、ほぼ正面(-Y)と少し下。まばたきは上下へつぶす
    eyes_parts = []
    for ci, c in enumerate(EYE_C):
        x, z = X(c[0]), Z(c[1])
        rx, rz = EYE_R[0] / S, EYE_R[1] / S
        al = math.radians(EYE_TILT)
        axis = Vector((0.0, -math.cos(al), math.sin(al)))                 # 玉の前向きの軸
        rot = Matrix.Rotation(-al, 3, "X")                                 # 玉の局所の y を軸へ合わせる回転
        y0 = surf_head(x, z)

        def clearance(sh):
            """玉の赤道の輪(軸に垂直な円)の各点が、頭の面より前へ出ている量の最小(m)。"""
            cc = Vector((x, y0, z)) + axis * sh
            m = 1e9
            for k in range(24):
                t = 2 * math.pi * k / 24
                pnt = cc + rot @ Vector((rx * math.cos(t), 0.0, rz * math.sin(t)))
                m = min(m, surf_head(pnt.x, pnt.z) - pnt.y)
            return m
        lo, hi = -0.02, 0.04
        for _ in range(30):
            mid = (lo + hi) / 2
            if clearance(mid) < EYE_CLEAR:
                lo = mid
            else:
                hi = mid
        sh = hi
        ctr = Vector((x, y0, z)) + axis * sh
        print("EYE", ci, "shift", round(sh, 4), "front-most", round(surf_head(x, z) - (ctr.y - EYE_BULGE * math.cos(al)), 4))
        eyes_parts.append(P.superquadric("eye%d" % ci, (rx, EYE_BULGE, rz), (1.0, 1.0), tuple(ctr), mat=mats["black"], seg=(24, 14),
                                         rot_deg=(-EYE_TILT, 0, 0)))
    eyes = P.join(eyes_parts, "Eyes")
    gL = eyes.vertex_groups.new(name="eye_L")
    gR = eyes.vertex_groups.new(name="eye_R")
    for v in eyes.data.vertices:
        (gL if v.co.x > 0 else gR).add([v.index], 1.0, "REPLACE")
    zc = Z(EYE_C[0][1])
    eyes.shape_key_add(name="Basis")
    bl = eyes.shape_key_add(name="eye_blink")
    for i, v in enumerate(eyes.data.vertices):
        bl.data[i].co = Vector((v.co.x, v.co.y, zc + (v.co.z - zc) * 0.08))
    bl.value = 0.0
    parts["Eyes"] = eyes
    return parts


def xloft(name, secs, mat, n=20):
    """x 方向に伸びる形。secs = [(x, y, z, ry, rz)](y-z 平面の楕円)。両端は平らなふた。"""
    verts, faces = [], []
    for (x, y, z, ry, rz) in secs:
        for i in range(n):
            t = 2 * math.pi * i / n
            verts.append((x, y + ry * math.cos(t), z + rz * math.sin(t)))
    m = len(secs)
    for j in range(m - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    for j in (0, m - 1):
        c = len(verts)
        x, y, z = secs[j][:3]
        verts.append((x, y, z))
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((c, b, a) if j == 0 else (c, a, b))
    ob = P._make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))
    fix_normals(ob)
    return ob


def with_outline(ob, thick, mats, bone_group=True):
    """殻を作って返す(頂点グループは複製が引きつぐ)。検査の「体」に数えない印を付ける。"""
    sh = P.outline(ob, thick, mats["outline"])
    sh["surface_only"] = True
    return sh


def main():
    global WORK
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        k, v = kv.split("=", 1)
        if k == "work":
            WORK = v
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(WORK, exist_ok=True)

    def flat(name, rgb, rough=0.8, spec=0.15):
        return P.material(name, rgb, rough=rough, spec=spec)

    mats = dict(
        brown=flat("Brown", BROWN), cream=flat("Cream", CREAM), pink=flat("Pink", PINK), green=flat("Green", GREEN),
        white=flat("Glove", WHITE, rough=0.85, spec=0.1), stripe=flat("Stripe", STRIPE), black=flat("Ink", BLACK, rough=0.6, spec=0.2),
        mouth=flat("MouthIn", BLACK, rough=0.6, spec=0.2),
    )
    ol = flat("Outline", (0, 0, 0), rough=0.9, spec=0.0)
    ol.use_backface_culling = True
    mats["outline"] = ol

    objs_shell = []     # 殻を付けた物(殻の一覧)

    # ---- 頭と胴(P.loft) ----
    head = P.loft("head_core", secs_from(HEAD), mat=mats["brown"], n=36, e=1.0, refine=2)
    torso = P.loft("torso", secs_from(BODY), mat=mats["brown"], n=36, e=0.97, refine=2)
    surf_head = ray_surface(head)
    surf_torso = ray_surface(torso)

    # ---- 顔 ----
    face = build_face(surf_head, mats)

    # ---- 胴のおなか(クリーム)と黒い縁 ----
    def torso_clip(py):
        return interp([(r[0], r[1]) for r in BODY], py, 1) - 12.0

    belly_line = plate("belly_line", BELLY_ROWS, surf_torso, 0.0012, 0, mats["black"], ncols=32, grow=5.0, clip=lambda py: torso_clip(py) + 3)
    belly = plate("belly", BELLY_ROWS, surf_torso, 0.0032, 0, mats["cream"], ncols=32, clip=torso_clip)

    # ---- 耳(丸みのある三角。頭の上の後ろ寄り。元の絵の耳の輪郭を 7px 縮めた断面を、高さごとに積む) ----
    ears = []
    for sign in (-1, 1):
        secs = []
        for py, xl, xr, yf, yb in EAR_ROWS:
            secs.append(dict(z=Z(py), cx=sign * (((xl + xr) / 2) - CX) / S * -1.0, cy=((yf + yb) / 2 - CX) / S,
                             rx=(xr - xl) / 2 / S, ry=(yb - yf) / 2 / S))
        ears.append(P.loft("ear%d" % sign, secs, mat=mats["brown"], n=28, e=1.0, refine=2))
    head_all = P.join([head] + ears, "Head")
    group(head_all, "head")
    objs_shell.append(head_all)

    group(torso, "body")
    objs_shell.append(torso)

    # ---- 足(クリーム。横の絵では前に長い) ----
    feet = {}
    for sign, nm in ((-1, "leg_R"), (1, "leg_L")):
        foot = P.superquadric(nm + "_foot", (0.080, 0.088, 0.037), (1.0, 1.0), (sign * 0.152, -0.120, 0.0335), mat=mats["cream"], seg=(28, 16))
        group(foot, nm)
        feet[nm] = foot
        objs_shell.append(foot)

    # ---- しっぽ(3D の中心線の管。クリーム) ----
    tail = P.tube("tail", TAIL, TAIL_R, mat=mats["cream"], n=20)
    group(tail, "body")
    objs_shell.append(tail)

    # ---- 腕(管 + 白い手袋 + 袖口の輪) ----
    arms = {}
    for sign, nm in ((-1, "arm_R"), (1, "arm_L")):
        pts = [(sign * x, y, z) for x, y, z in ARM]
        sp, sr = smooth_path(pts, ARM_R, 3)
        tube = P.tube(nm + "_sleeve", sp, sr, mat=mats["brown"], n=22)
        hd = Vector((sign * HAND_DIR[0], HAND_DIR[1], HAND_DIR[2])).normalized()
        heul = hd.to_track_quat("Z", "Y").to_euler()
        hand = P.superquadric(nm + "_hand", HAND_R, (0.8, 1.0), (sign * HAND_C[0], HAND_C[1], HAND_C[2]), mat=mats["white"], seg=(24, 14),
                              rot_deg=tuple(math.degrees(a) for a in heul))
        d = (Vector(pts[-1]) - Vector(pts[-2])).normalized() + hd
        eul = d.normalized().to_track_quat("Z", "Y").to_euler()
        cuff_c = Vector(pts[-1]) - d.normalized() * 0.004
        # 袖口: 手首(袖の端)に密着した短い帯。角丸の長方形の断面の輪で、袖の太さに被せて浮かせない
        cuff = P.ring(nm + "_cuff", CUFF_R - CUFF_W * 0.5, CUFF_W * 0.5, tuple(cuff_c), mat=mats["white"], seg=(24, 6), squash=1.7,
                      sq=0.45, rot_deg=tuple(math.degrees(a) for a in eul))
        arm = P.join([tube, hand, cuff], nm + "_part")
        arm["pivot"] = [round(sign * ARM[0][0], 4), round(ARM[0][1], 4), round(ARM[0][2], 4)]
        group(arm, nm)
        arms[nm] = arm
        objs_shell.append(arm)

    # ---- 蝶ネクタイ(緑。首の前。横の絵で少し前へ出る) ----
    zb = Z(499)
    yb = surf_torso(0.0, zb) - 0.004
    bows = []
    for sign in (-1, 1):
        secs = []
        for px, hz in ((580, 11), (596, 15), (614, 21), (636, 26)):
            secs.append((sign * X(px + CX) if False else sign * (px - 568.0) / S, yb - 0.004, zb, 0.011, hz / S))
        bows.append(xloft("bow%d" % sign, secs if sign > 0 else secs, mats["green"]))
    bow = P.join(bows, "BowWings")
    group(bow, "body")
    knot = P.superquadric("BowKnot", (0.0115, 0.0125, 0.021), (1.0, 1.0), (0.0, yb - 0.006, zb), mat=mats["green"], seg=(20, 12))
    group(knot, "body")
    objs_shell.append(bow)

    # ---- 背中の筋(体の後ろの道。クリームの帯の上に、濃い細い帯を少し短く) ----
    surfaces = [head_all, torso]
    sk = W.wrap_band("stripe_cream", surfaces, [(180, 0.885), (180, 0.172)], 0.058, thick=0.003, clearance=0.001, mat=mats["cream"],
                     seg=64, rows=6, taper=0.2, taper_min=0.05)
    sd = W.wrap_band("stripe_dark", surfaces, [(180, 0.835), (180, 0.205)], 0.027, thick=0.003, clearance=0.002, mat=mats["stripe"],
                     seg=64, rows=4, taper=0.2, taper_min=0.05)
    for st in (sk, sd):
        for v in st.data.vertices:
            pass
    # 筋の上半分は頭の骨、下半分は胴の骨(首の高さで分ける。つなぎ目は頭と胴のすき間なので動いても目立たない)
    z_neck = 0.63
    for st in (sk, sd):
        gh = st.vertex_groups.new(name="head")
        gb = st.vertex_groups.new(name="body")
        for v in st.data.vertices:
            (gh if v.co.z > z_neck else gb).add([v.index], 1.0, "REPLACE")

    # ---- 顔の部品の骨 ----
    for o in face["flat"]:
        group(o, "head")
    group(face["Mouth"], "head")
    group(belly, "body")
    group(belly_line, "body")
    for o in (face["flat"][0], face["flat"][1], belly, belly_line):
        o["surface_only"] = True     # 地の色の当て布(検査の「体」にも「部品」にも数えない)
    group(knot, "body")
    for nm in ("eye_L", "eye_R"):
        pass

    # ---- 輪郭の殻(黒)。目・口・鼻・筋・結び目・当て布には付けない ----
    for ob in objs_shell:
        th = OL_SMALL if ob.name == "BowWings" else OL
        with_outline(ob, th, mats)

    # ---- 骨の位置 ----
    ez = Z(EYE_C[0][1])
    rig = {
        "root": [0, 0, 0],
        "body": [0, 0.0, 0.36],
        "head": [0, -0.17, 0.60],
        "arm_L": list(arms["arm_L"]["pivot"]),
        "arm_R": list(arms["arm_R"]["pivot"]),
        "leg_L": [0.152, -0.06, 0.09],
        "leg_R": [-0.152, -0.06, 0.09],
        "eye_L": [round(X(EYE_C[1][0]), 4), round(surf_head(X(EYE_C[1][0]), ez), 4), round(ez, 4)],
        "eye_R": [round(X(EYE_C[0][0]), 4), round(surf_head(X(EYE_C[0][0]), ez), 4), round(ez, 4)],
    }
    tri = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH"}
    print("BUILD tris", sum(tri.values()), json.dumps(sorted(tri.items(), key=lambda kv: -kv[1])[:8]))
    json.dump(rig, open(WORK + "/rig_at.json", "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD norrie ok", json.dumps(rig))


if __name__ == "__main__":
    main()
