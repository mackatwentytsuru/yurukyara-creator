"""みかんちゃん(丸いみかんの胴、頭に葉っぱ 1 枚、丸い手足)の手組み builder。型 B(球の胴・頭なし)。
元の絵: creator/samples/mikan_元の絵.png(gen_mikan.py が SVG で描いた絵)。座標は creator/samples/mikan_設定.md の「最終の画素」。
全高(足の底 1054 〜 葉の先 270)= 784px を 0.8m に割りあてる。
使い方: blender -b -P mikan.py -- <出力.blend> work=<作業フォルダ>"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m01_wrap as W  # noqa: E402

S = 980.0
CX, FY = 627.0, 1054.0
WORK = "."


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


def svg_px(x, y):
    """元の SVG の座標を最終の画素へ。<g id="char"> の変換 translate(627 1000) scale(1.05) translate(-627 -930)。"""
    return (round(627 + 1.05 * (x - 627), 2), round(1000 + 1.05 * (y - 930), 2))


# 画素のまま。半径は (横 rx, 奥行き ry, 縦 rz)
D = dict(
    body_c=(627, 684), body_r=(352, 330, 322),
    foot_dx=129, foot_c=995, foot_r=(108, 86, 61),
    arm_root_dx=290, hand_dx=386, hand_c=708, hand_r=(90, 62, 82), arm_r=52, arm_y=0.015,
    # 目: 元の SVG の <g id="eye_L">(楕円 半径 39×53、白いつや r 14.04 と 6.63)を最終の画素に直した値(×1.05)。
    # 前は設定の表の古い値(71×97)を使い、元より 15% 小さかった(口が大きく見える元になった)
    eye_dx=83, eye_c=716, eye_r=(40.95, 55.65), light_off=(-11.47, -16.7), light_r=14.74, light2_off=(12.29, 21.15), light2_r=6.96,
    # 口: 元の SVG の <g id="mouth">(2 次ベジェ 2 本と、口の形で切り抜いた舌の楕円)を最終の画素に直した値。
    # 角 (582.9, 775.3)・(671.1, 775.3)、上の縁の制御点 y 782.5、下の縁の制御点 y 867.1 → 幅 88.2px・深さ 45.9px(下の端 821.2)。
    mouth_a=svg_px(585.0, 716), mouth_b=svg_px(669.0, 716), mouth_top_q=svg_px(627, 722.9), mouth_bot_q=svg_px(627, 803.4),
    tongue_c=svg_px(627, 778.1), tongue_r=(round(18.48 * 1.05, 2), round(23.0 * 1.05, 2)),
    mouth_front=0.0025, mouth_back=0.001, tongue_front=0.0006,
    cheek_dx=173, cheek_y=780, cheek_r=(46, 30),
    stem_c=(615, 390), stem_r=(29, 22, 42),
)

ORANGE = (255, 138, 28)
CHEEK = (255, 90, 90)
FOOT = (226, 134, 38)
LEAF = (86, 184, 52)
LEAF_DARK = (31, 110, 34)
STEM = (106, 74, 26)


def group(ob, bone):
    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


class Body:
    """胴の楕円体の式。顔の部品を面に載せる。"""

    def __init__(self):
        c, r = D["body_c"], D["body_r"]
        self.cx, self.zc = X(c[0]), Z(c[1])
        self.rx, self.ry, self.rz = R(r[0]), R(r[1]), R(r[2])

    def surf_y(self, x, z):
        v = 1.0 - ((x - self.cx) / self.rx) ** 2 - ((z - self.zc) / self.rz) ** 2
        return -self.ry * math.sqrt(max(v, 0.0))

    def tilt_deg(self, x, z):
        y = self.surf_y(x, z)
        nx = (x - self.cx) / self.rx ** 2
        ny = y / self.ry ** 2
        return math.degrees(math.atan2(nx, -ny))


MOUTH_NU, MOUTH_NV, TONGUE_NC, TONGUE_NR = 24, 8, 12, 6
# シェイプキー → (深さの倍率, 幅の倍率)。上の縁は動かさず、下の縁と左右の端を動かす
MOUTH_KEYS = {"mouth_open": (1.8, 1.0), "mouth_wide": (1.0, 1.3), "mouth_o": (1.3, 0.5)}


def mesh_surface(ob):
    """体の正面の面の y を、組んだ網に正面から光線を当てて求める(式の楕円体ではなく、実物の面に沿わせる)。"""
    me = ob.data
    me.calc_loop_triangles()
    bvh = BVHTree.FromPolygons([ob.matrix_world @ v.co for v in me.vertices], [tuple(t.vertices) for t in me.loop_triangles],
                               all_triangles=True)

    def surf(x, z):
        hit = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0.0, 1.0, 0.0)), 4.0)[0]
        if hit is None:
            raise RuntimeError("口の場所 (%.3f, %.3f) に体の面が無い" % (x, z))
        return hit.y
    return surf


def mouth_shape(k, fw):
    """口の形(最終の画素)。元の SVG の上の縁・下の縁は、両端が角の 2 次ベジェ = 放物線:
    x = 中心 + 半幅 × s、y = 角の y + 下がり × (1 - s²)(s は -1〜1)。下がりは「制御点の y - 角の y」の半分。
    k は下の縁の深さの倍率、fw は幅の倍率。戻り値 (中心 x, 半幅, 角の y, 上の縁の下がり, 下の縁の下がり)。"""
    (ax, ay), (bx, _) = D["mouth_a"], D["mouth_b"]
    top = (D["mouth_top_q"][1] - ay) / 2
    bot = (D["mouth_bot_q"][1] - ay) / 2
    return (ax + bx) / 2, (bx - ax) / 2 * fw, ay, top, top + k * (bot - top)


def mouth_grid(k, fw):
    """口の板の点(画素)。順: 絵の左の角、列 1〜NU-1 の (NV+1) 点ずつ(上の縁 → 下の縁)、絵の右の角。"""
    cx, half, ay, top, bot = mouth_shape(k, fw)
    pts = [(cx - half, ay)]
    for j in range(1, MOUTH_NU):
        s = -1 + 2 * j / MOUTH_NU
        yt, yb = ay + top * (1 - s * s), ay + bot * (1 - s * s)
        pts += [(cx + half * s, yt + (yb - yt) * i / MOUTH_NV) for i in range(MOUTH_NV + 1)]
    pts.append((cx + half, ay))
    return pts


def tongue_grid(k, fw):
    """舌の点(画素)。元の SVG と同じく「舌の楕円 ∩ 口の形」。行は上から下、列は左から右。口が開くほど見える所が増える。"""
    cx, half, ay, top, bot = mouth_shape(k, fw)
    (tx, ty), (trx, tr_y) = D["tongue_c"], D["tongue_r"]
    trx *= fw
    eps = 0.4
    y0 = max(ty - tr_y, ay + top) + eps
    y1 = min(ay + bot, ty + tr_y) - eps
    if y1 <= y0:        # 舌が見えない形: 口の下の端の 1 点に集める(板の後ろに隠れる)
        y0 = y1 = ay + bot - eps
    pts = []
    for r in range(TONGUE_NR + 1):
        y = y0 + (y1 - y0) * r / TONGUE_NR
        hw_m = half * math.sqrt(max(0.0, 1 - (y - ay) / bot))
        hw_t = trx * math.sqrt(max(0.0, 1 - ((y - ty) / tr_y) ** 2))
        hw = 0.96 * min(hw_m, hw_t)
        pts += [(tx + hw * (2 * c / TONGUE_NC - 1), y) for c in range(TONGUE_NC + 1)]
    return pts


def _faces_toward(faces, pts2, want_front):
    """面の向きをそろえる。画素の座標(y が下向き)で 2 次元の外積が負なら、3D の法線は -y(見る人の側)。"""
    out = []
    for f in faces:
        (x0, y0), (x1, y1), (x2, y2) = (pts2[f[0]], pts2[f[1]], pts2[f[-1]])
        cross = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
        front = cross < 0
        out.append(tuple(f) if front == want_front else tuple(reversed(f)))
    return out


def mouth_points(surf, k, fw):
    """1 つの形(k, fw)の口の全部の点(3D)。並びはいつも同じ(シェイプキーに使う)。
    前の板(面から mouth_front 手前)・後ろの板(面から mouth_back 奥)・縁の壁(前と後ろの縁を別の点で)・舌(前の板のさらに手前)。"""
    g = mouth_grid(k, fw)
    t = tongue_grid(k, fw)

    def at(px, py, off):
        x, z = X(px), Z(py)
        return Vector((x, surf(x, z) + off, z))
    front = [at(px, py, -D["mouth_front"]) for px, py in g]
    back = [at(px, py, D["mouth_back"]) for px, py in g]
    ring = mouth_ring()
    wall = [front[i] for i in ring] + [back[i] for i in ring]
    tongue = [at(px, py, -D["mouth_front"] - D["tongue_front"]) for px, py in t]
    return front + back + wall + tongue, g, t


def mouth_ring():
    """板の縁を 1 周する点の番号(絵の左の角 → 上の縁 → 絵の右の角 → 下の縁を戻る)。"""
    col = lambda j, i: 1 + (j - 1) * (MOUTH_NV + 1) + i
    last = 1 + (MOUTH_NU - 1) * (MOUTH_NV + 1)
    return [0] + [col(j, 0) for j in range(1, MOUTH_NU)] + [last] + [col(j, MOUTH_NV) for j in range(MOUTH_NU - 1, 0, -1)]


def mouth_mesh(surf, mats):
    """口(暗い板 + 舌)を 1 つの網で作り、mouth_open・mouth_wide・mouth_o のシェイプキーを付ける。"""
    pts, g, t = mouth_points(surf, 1.0, 1.0)
    ng, nt = len(g), len(t)
    col = lambda j, i: 1 + (j - 1) * (MOUTH_NV + 1) + i
    last = 1 + (MOUTH_NU - 1) * (MOUTH_NV + 1)
    grid = [(0, col(1, i + 1), col(1, i)) for i in range(MOUTH_NV)]
    for j in range(1, MOUTH_NU - 1):
        grid += [(col(j, i), col(j, i + 1), col(j + 1, i + 1), col(j + 1, i)) for i in range(MOUTH_NV)]
    grid += [(col(MOUTH_NU - 1, i), col(MOUTH_NU - 1, i + 1), last) for i in range(MOUTH_NV)]
    front_f = _faces_toward(grid, g, True)
    back_f = [tuple(ng + i for i in f) for f in _faces_toward(grid, g, False)]
    nr = len(mouth_ring())
    w0, w1 = 2 * ng, 2 * ng + nr
    cx, cz = X(sum(p[0] for p in g) / ng), Z(sum(p[1] for p in g) / ng)
    wall_f = []
    for i in range(nr):
        f = (w0 + i, w0 + (i + 1) % nr, w1 + (i + 1) % nr, w1 + i)
        a, b, c = pts[f[0]], pts[f[1]], pts[f[2]]
        n = (b - a).cross(c - a)
        mid = (a + b) / 2
        out_dir = Vector((mid.x - cx, 0.0, mid.z - cz))
        wall_f.append(f if n.dot(out_dir) >= 0 else tuple(reversed(f)))
    t0 = 2 * ng + 2 * nr
    tq = []
    for r in range(TONGUE_NR):
        for c in range(TONGUE_NC):
            a = r * (TONGUE_NC + 1) + c
            tq.append((a, a + 1, a + TONGUE_NC + 2, a + TONGUE_NC + 1))
    tongue_f = [tuple(t0 + i for i in f) for f in _faces_toward(tq, t, True)]
    dark_faces = front_f + back_f + wall_f
    mo = P._make("Mouth", [tuple(p) for p in pts], dark_faces + tongue_f, mats["mouth"], (0, 0, 0), (0, 0, 0))
    mo.data.materials.append(mats["tongue"])
    for k, p in enumerate(mo.data.polygons):
        p.material_index = 1 if k >= len(dark_faces) else 0
        p.use_smooth = k < len(front_f) or k >= len(dark_faces)     # 前の板と舌はなめらか、後ろと壁は平ら
    assert len(mo.data.vertices) == len(pts), "口の点の数が合わない"
    mo.shape_key_add(name="Basis")
    for name, (k, fw) in MOUTH_KEYS.items():
        key = mo.shape_key_add(name=name)
        for i, p in enumerate(mouth_points(surf, k, fw)[0]):
            key.data[i].co = p
        key.value = 0.0
    return mo


def build_face(H, mats, torso):
    out = {}
    parts = []
    er = D["eye_r"]
    ez = Z(D["eye_c"])
    for sign in (-1, 1):
        ex = X(627 + sign * D["eye_dx"])
        ys = H.surf_y(ex, ez)
        ang = H.tilt_deg(ex, ez)
        a = math.radians(ang)
        ey = ys - 0.012
        parts.append(P.superquadric(f"eye{sign}", (R(er[0]), 0.006, R(er[1])), (1.0, 1.0), (ex, ey, ez), rot_deg=(0, 0, ang),
                                    mat=mats["eye"], seg=(40, 20)))
        for k, (off, rr) in enumerate(((D["light_off"], D["light_r"]), (D["light2_off"], D["light2_r"]))):
            lx, lz = R(off[0]), -R(off[1])
            cx_ = ex + lx * math.cos(a) + 0.0045 * math.sin(a)
            cy_ = ey + lx * math.sin(a) - 0.0045 * math.cos(a)
            parts.append(P.superquadric(f"light{sign}_{k}", (R(rr), 0.004, R(rr)), (1.0, 1.0), (cx_, cy_, ez + lz),
                                        rot_deg=(0, 0, ang), mat=mats["white"], seg=(24, 12)))
        parts.append(P.superquadric(f"eyesink{sign}", (0.004, 0.004, 0.004), (1.0, 1.0), (ex, ys + 0.008, ez - 0.02),
                                    mat=mats["eye"], seg=(8, 6)))
    eyes = P.join(parts, "Eyes")
    gL = eyes.vertex_groups.new(name="eye_L")
    gR = eyes.vertex_groups.new(name="eye_R")
    for v in eyes.data.vertices:
        (gL if v.co.x > 0 else gR).add([v.index], 1.0, "REPLACE")
    eyes.shape_key_add(name="Basis")
    bl = eyes.shape_key_add(name="eye_blink")
    for i, v in enumerate(eyes.data.vertices):
        bl.data[i].co = Vector((v.co.x, v.co.y, ez + (v.co.z - ez) * 0.06))
    bl.value = 0.0
    out["Eyes"] = eyes

    # ---- 口: 元の SVG の開いた笑い口(上の縁はほぼ平ら・下は深い U・舌は下の端)を、体の面に沿う薄い板で ----
    # 11-06 の 1 回目は、小さな楕円を下へ細らせた形(幅 約 52px・上が丸い)で、舌の桃色を上に置いていた。
    # 判定役は 2 回とも 6 回中 6 回「鼻に見える」と答えた。幅と深さは元の SVG から測った値(D の mouth_*)をそのまま使う。
    out["Mouth"] = mouth_mesh(mesh_surface(torso), mats)
    return out


def main():
    global WORK
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        k, v = kv.split("=", 1)
        if k == "work":
            WORK = v
        else:
            D[k] = eval(v)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fz = WORK + "/fuzz"
    os.makedirs(fz, exist_ok=True)
    skin = P.material("Orange", ORANGE, rough=0.55, spec=0.3)
    mats = dict(
        eye=P.material("Eye", (58, 28, 14), rough=0.3, spec=0.5),
        white=P.material("White", (252, 252, 252), rough=0.4, spec=0.3),
        mouth=P.material("MouthIn", (58, 28, 14), rough=0.5, spec=0.2),
        tongue=P.material("Tongue", (255, 111, 127), rough=0.5, spec=0.2),
        foot=P.material("Foot", FOOT, rough=0.6, spec=0.2),
        leaf=P.material("Leaf", LEAF, rough=0.5, spec=0.3),
        leafd=P.material("LeafDark", LEAF_DARK, rough=0.55, spec=0.2),
        stem=P.material("Stem", STEM, rough=0.7, spec=0.1),
    )

    bc, br = D["body_c"], D["body_r"]
    torso = P.superquadric("torso", tuple(R(v) for v in br), (0.93, 0.93), (X(bc[0]), 0, Z(bc[1])), mat=skin, seg=(72, 44))
    torso.name = "torso"
    group(torso, "body")

    feet = {}
    for sign, nm in ((-1, "leg_R"), (1, "leg_L")):
        foot = P.superquadric(nm + "_foot", tuple(R(v) for v in D["foot_r"]), (1.0, 1.0),
                              (X(627 + sign * D["foot_dx"]), -0.01, Z(D["foot_c"])), mat=mats["foot"], seg=(40, 24))
        group(foot, nm)
        feet[nm] = foot

    arms = {}
    for sign, nm in ((-1, "arm_R"), (1, "arm_L")):
        z = Z(D["hand_c"])
        pts = [(X(627 + sign * (D["arm_root_dx"] + (D["hand_dx"] - D["arm_root_dx"]) * t)), D["arm_y"], z) for t in (0.0, 0.5, 1.0)]
        tube = P.tube(nm + "_sleeve", pts, [R(D["arm_r"])] * 3, mat=skin, n=24)
        hand = P.superquadric(nm + "_hand", tuple(R(v) for v in D["hand_r"]), (1.0, 1.0),
                              (X(627 + sign * D["hand_dx"]), D["arm_y"], z), mat=skin, seg=(40, 24))
        arm = P.join([tube, hand], nm + "_part")
        arm["pivot"] = [round(pts[0][0], 4), 0.0, round(z, 4)]
        group(arm, nm)
        arms[nm] = arm

    # ---- 葉っぱ 1 枚(平たい管 2 枚重ね)とへた。胴の上に載る ----
    key_px = [(632, 404), (674, 368), (728, 336), (792, 305), (846, 282), (876, 270)]
    key_w = [16, 72, 94, 80, 58, 32]
    import numpy as np
    n_leaf = 16
    tt = np.linspace(0, 1, len(key_px))
    uu = np.linspace(0, 1, n_leaf)
    # 点を細かく補間して、縁をなめらかにする(点が少ないと多角形に見えた)
    xs = np.interp(uu, tt, [q[0] for q in key_px])
    ys = np.interp(uu, tt, [q[1] for q in key_px])
    ws = np.interp(uu, tt, key_w)
    for _ in range(3):
        ws = np.convolve(np.pad(ws, 1, mode="edge"), [0.25, 0.5, 0.25], mode="valid")
        xs = np.convolve(np.pad(xs, 1, mode="edge"), [0.25, 0.5, 0.25], mode="valid")
        ys = np.convolve(np.pad(ys, 1, mode="edge"), [0.25, 0.5, 0.25], mode="valid")
    leaf_pts_px = list(zip(xs, ys))
    leaf_w = list(ws)
    pts = [(X(px), -0.02, Z(py)) for px, py in leaf_pts_px]
    leafd_pts = [(X(px + 3), -0.02, Z(py + 26)) for px, py in leaf_pts_px]
    leaf_d = P.tube("leaf_under", leafd_pts, [R(w * 0.92) for w in leaf_w], mat=mats["leafd"], n=28, ry_scale=0.28)
    leaf_t = P.tube("leaf_top", pts, [R(w) for w in leaf_w], mat=mats["leaf"], n=28, ry_scale=0.28)
    sc, sr = D["stem_c"], D["stem_r"]
    stem = P.superquadric("stem", tuple(R(v) for v in sr), (0.6, 0.6), (X(sc[0]), 0, Z(sc[1])), mat=mats["stem"], seg=(24, 14))
    leaf = P.join([leaf_d, leaf_t, stem], "Leaf")
    group(leaf, "body")

    # ---- 顔 ----
    H = Body()
    face = build_face(H, mats, torso)
    group(face["Mouth"], "body")
    for sign in (-1, 1):
        x = sign * R(D["cheek_dx"])
        z = Z(D["cheek_y"])
        ang = math.degrees(math.asin(max(-0.99, min(0.99, x / (H.rx * math.sqrt(max(1 - ((z - H.zc) / H.rz) ** 2, 0.01)))))))
        ck = W.soft_patch(f"cheek{sign}", [torso], ang, z, R(D["cheek_r"][0]), R(D["cheek_r"][1]), CHEEK, fz,
                          clearance=0.012, hardness=0.35, opacity=0.85)
        group(ck, "body")

    body_parts = [torso, leaf, *arms.values(), *feet.values()]
    W.bake_ao(body_parts, occluders=[torso, *arms.values(), *feet.values()], samples=32, dist=0.2, strength=0.5)

    rig = {
        "root": [0, 0, 0],
        "body": [0, 0, round(Z(bc[1]), 4)],
        "arm_L": list(arms["arm_L"]["pivot"]),
        "arm_R": list(arms["arm_R"]["pivot"]),
        "leg_L": [round(X(627 + D["foot_dx"]), 4), 0, round(Z(960), 4)],
        "leg_R": [round(X(627 - D["foot_dx"]), 4), 0, round(Z(960), 4)],
        "eye_L": [round(X(627 + D["eye_dx"]), 4), round(H.surf_y(X(627 + D["eye_dx"]), Z(D["eye_c"])), 4), round(Z(D["eye_c"]), 4)],
        "eye_R": [round(X(627 - D["eye_dx"]), 4), round(H.surf_y(X(627 - D["eye_dx"]), Z(D["eye_c"])), 4), round(Z(D["eye_c"]), 4)],
    }
    json.dump(rig, open(WORK + "/rig_at.json", "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD mikan ok", json.dumps(rig))


if __name__ == "__main__":
    main()
