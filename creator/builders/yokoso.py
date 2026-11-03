"""ようこそくん(たすきを掛けた緑のぬいぐるみ)。受付に立つキャラの見本。
スキルだけの試験で作業役が書いた builder を元に、輪郭・肩・たすきを直した。
使い方: blender -b -P creator/builders/yokoso.py -- <出力.blend> <作業フォルダ>
作業フォルダには sash.png と sash.json を先に作っておく(creator/pipeline/t01_band_texture.py)。rig.json もここに書く。"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m01_wrap as W   # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:]
OUT, WORK = ARGV[0], ARGV[1]
S = 1203.0            # 画素 → メートル(全高 1.0m)
CX, FY = 622, 1230
FX = 625              # 顔の左右の中心


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


D = dict(
    head=[(27, 6), (33, 75), (45, 118), (60, 158), (100, 227), (140, 274), (180, 307), (220, 334), (260, 353),
          (300, 367), (340, 374), (380, 377), (420, 374), (460, 366), (500, 350), (540, 325), (580, 288), (610, 230),
          (628, 120), (636, 6)],
    head_depth=0.95,
    torso=[(500, 190), (560, 222), (600, 246), (630, 272), (660, 284), (700, 292), (780, 303), (860, 310), (940, 303),
           (980, 288), (1020, 266), (1050, 236), (1070, 185), (1080, 90), (1082, 6)],
    torso_depth=0.85,
    arm_root=(400, 690), arm_tip=(188, 812), arm_r=86,
    foot_c=(473, 1150), foot_r=(116, 108, 82), foot_dx=149, leg_dx=139,
    eye_c=((442, 347), (808, 347)), eye_r=(50, 10, 74),
    hl=((455, 305), (797, 306)), hl_r=13,
    cheek=((369, 447), (878, 447)), cheek_r=(50, 46),
    mouth_ends=(540, 708), mouth_top=422, mouth_sag=36, mouth_t=11,
)


TEXT_FILL = 0.92   # 面の曲がりで前の部分が見かけより長いので、字を少し大きく載せる


def _arc_len(path, radius=0.25):
    """帯の道の、面の上のおおよその長さ。"""
    return sum(math.hypot(math.radians(a1 - a0) * radius, z1 - z0) for (a0, z0), (a1, z1) in zip(path, path[1:]))


def group(ob, bone):
    vg = ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


def secs(rows, depth, cx=0.0):
    return [dict(z=Z(py), cx=cx, cy=0.0, rx=R(h), ry=R(h) * depth) for py, h in rows]


def main():
    band = json.load(open(WORK + "/sash.json", encoding="utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fz = WORK + "/fuzz"
    os.makedirs(fz, exist_ok=True)
    green = P.fuzz_material("Green", (124, 168, 68), fz, grain=0.12, normal_strength=1.0)
    black = P.material("Black", (18, 18, 20), rough=0.45, spec=0.3)
    white = P.material("White", (250, 250, 250), rough=0.5, spec=0.2)
    inner = P.material("Inner", (110, 24, 34), rough=0.6, spec=0.2)

    # --- 体 ---
    head = P.loft("head", secs(D["head"], D["head_depth"]), mat=green, n=64, refine=4)
    P.auto_uv(head, 7.0)
    group(head, "head")
    torso = P.loft("torso", secs(D["torso"], D["torso_depth"]), mat=green, n=64, refine=4)
    P.auto_uv(torso, 7.0)
    group(torso, "body")
    arms = {}
    for side, name, sx in ((1, "arm_L", 1), (-1, "arm_R", -1)):
        rx_, ry_ = D["arm_root"]
        tx_, ty_ = D["arm_tip"]
        root = (X(CX + sx * (CX - rx_)), 0.0, Z(ry_))
        tip = (X(CX + sx * (CX - tx_)), 0.0, Z(ty_))
        a = W.limb(name, [torso], root, tip, R(D["arm_r"]), R(D["arm_r"]) * 0.93, mat=green, flare=1.08)
        P.auto_uv(a, 7.0)
        group(a, name)
        arms[name] = a
    feet = {}
    for name, sx in (("leg_L", 1), ("leg_R", -1)):
        fc = D["foot_c"]
        f = P.superquadric(name + "_foot", tuple(R(v) for v in D["foot_r"]), (0.8, 0.95),
                           (sx * R(D["foot_dx"]), -0.012, Z(fc[1])), mat=green, seg=(48, 24))
        P.auto_uv(f, 7.0)
        leg = P.superquadric(name + "_leg", (R(104), R(96), R(76)), (0.8, 1.0), (sx * R(D["leg_dx"]), -0.006, Z(1080)), mat=green, seg=(48, 24))
        P.auto_uv(leg, 7.0)
        group(leg, name)
        group(f, name)
        feet[name] = P.join([f, leg], name + "_foot")

    # --- たすき ---
    bvh_t = W.body_bvh([torso])
    axis = W._axis_of([torso])
    path = []
    for (px, py) in band["path"][1:-1]:   # 端の点は胴の外。3D では面の分だけ長くなるので、ここで字が前に収まる
        z = Z(py)
        lo, hi = -89.0, 89.0
        for _ in range(40):
            mid = (lo + hi) / 2
            loc, _n = W._hit(bvh_t, axis, mid, z)
            if loc.x < X(px):
                lo = mid
            else:
                hi = mid
        path.append(((lo + hi) / 2, z))
    sash_m = P.material("SashRed", (203, 20, 19), rough=0.9, spec=0.1)
    nt = sash_m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = bpy.data.images.load(WORK + "/sash.png")
    tx.image.colorspace_settings.name = "sRGB"
    nt.links.new(tx.outputs["Color"], b.inputs["Base Color"])
    # 帯は前から背中へ回る 1 本。字は前の部分だけに載せ、残りは絵の端の地の色を伸ばす(tx.extension = EXTEND)
    (a_top, z_top), (a_low, z_low) = path[0], path[-1]
    back_path = [(92, z_low - 0.055), (125, z_low - 0.03), (180, (z_low + z_top) / 2), (232, z_top + 0.01)]
    tx.extension = "EXTEND"
    full_path = path + back_path
    sash = W.wrap_band("sash", [torso], full_path, R(band["width_px"]), thick=0.006, clearance=0.008, mat=sash_m, seg=160, rows=10, taper=0.05, taper_min=0.55)
    stretch = TEXT_FILL * _arc_len(full_path) / _arc_len(path)
    uv = sash.data.uv_layers.active.data
    for d in uv:
        d.uv.x *= stretch
    group(sash, "body")

    # --- 顔 ---
    hbvh = W.body_bvh([head])

    def surf_y(xm, zm):
        loc = hbvh.ray_cast(Vector((xm, -3.0, zm)), Vector((0, 1, 0)), 6.0)[0]
        return loc.y

    def conform(ob, cy):
        """頂点ごとに、頭の面へ沿わせる(中心の奥行き cy からのずれは保つ)。"""
        for v in ob.data.vertices:
            v.co.y = surf_y(v.co.x, v.co.z) + (v.co.y - cy)

    eyes = []
    for i, (ec, nm) in enumerate(zip(D["eye_c"], ("eye_L", "eye_R"))):
        # 画像の右 = +X = eye_L
        nm = "eye_L" if ec[0] > FX else "eye_R"
        xm, zm = X(ec[0]), Z(ec[1])
        ys = surf_y(xm, zm)
        er = D["eye_r"]
        e = P.superquadric(f"eye{i}", (R(er[0]), R(er[1]), R(er[2])), (1.0, 1.0), (xm, ys, zm), mat=black, seg=(32, 16))
        conform(e, ys)
        group(e, nm)
        eyes.append(e)
        hc = D["hl"][i]
        hx, hz = X(hc[0]), Z(hc[1])
        h = P.superquadric(f"hl{i}", (R(D["hl_r"]), 0.006, R(D["hl_r"])), (1, 1), (hx, surf_y(hx, hz) - 0.013, hz), mat=white, seg=(16, 8))
        conform(h, surf_y(hx, hz))
        group(h, nm)
        eyes.append(h)
    eo = P.join(eyes, "Eyes")
    eo.shape_key_add(name="Basis")
    bl = eo.shape_key_add(name="eye_blink")
    centers = {"eye_L": Z(D["eye_c"][1][1]), "eye_R": Z(D["eye_c"][0][1])}
    zc = Z(D["eye_c"][0][1])
    for i, v in enumerate(eo.data.vertices):
        bl.data[i].co = Vector((v.co.x, v.co.y, zc + (v.co.z - zc) * 0.07))
    bl.value = 0.0

    # 口: 笑った線(管)+ 口の中(開くと見える)
    x0, x1 = D["mouth_ends"]
    pts, rad = [], []
    N = 14
    for k in range(N + 1):
        px = x0 + (x1 - x0) * k / N
        u = (px - (x0 + x1) / 2) / ((x1 - x0) / 2)
        py = D["mouth_top"] + D["mouth_sag"] * (1 - u * u)
        xm, zm = X(px), Z(py)
        pts.append((xm, surf_y(xm, zm) + 0.000, zm))
        rad.append(R(D["mouth_t"]) * (0.8 + 0.2 * (1 - u * u)))
    mt = P.tube("mouth_line", pts, rad, mat=black, n=10, ry_scale=0.8)
    group(mt, "head")
    mx = X((x0 + x1) / 2)
    mzc = Z(D["mouth_top"] + D["mouth_sag"] - 6)
    mi = P.superquadric("mouth_in", (R(64), 0.005, R(30)), (1, 1), (mx, surf_y(mx, mzc) - 0.002, mzc), mat=inner, seg=(24, 12))
    conform(mi, surf_y(mx, mzc))
    group(mi, "head")
    mi.vertex_groups.new(name="tmp_inner").add([v.index for v in mi.data.vertices], 1.0, "REPLACE")
    mo = P.join([mt, mi], "Mouth")
    tmp = mo.vertex_groups["tmp_inner"].index
    inner_idx = set()
    for v in mo.data.vertices:
        if any(g.group == tmp for g in v.groups):
            inner_idx.add(v.index)
    mo.vertex_groups.remove(mo.vertex_groups["tmp_inner"])
    mo.shape_key_add(name="Basis")
    cen = Vector((mx, 0, mzc))

    def key(name, fn):
        k = mo.shape_key_add(name=name)
        for i, v in enumerate(mo.data.vertices):
            k.data[i].co = fn(i, Vector(v.co))
        k.value = 0.0
        return k

    top_line = Z(D["mouth_top"])
    # Basis で口の中は点にしておく(開くと広がる)。Basis を直接つぶす
    basis = mo.data.shape_keys.key_blocks["Basis"]
    for i in inner_idx:
        v = mo.data.vertices[i].co
        basis.data[i].co = Vector((cen.x + (v.x - cen.x) * 0.02, v.y, cen.z + (v.z - cen.z) * 0.02))
    for i, v in enumerate(mo.data.vertices):
        v.co = basis.data[i].co

    def f_open(i, c):
        if i in inner_idx:
            b0 = Vector(basis.data[i].co)
            return Vector((cen.x + (b0.x - cen.x) * 50, b0.y, cen.z + (b0.z - cen.z) * 50 - 0.0))
        return c
    # 口の中は元の座標の 50 倍(= 本来の大きさ)に戻す
    key("mouth_open", f_open)

    def f_wide(i, c):
        if i in inner_idx:
            b0 = Vector(basis.data[i].co)
            return Vector((cen.x + (b0.x - cen.x) * 50 * 0.8, b0.y, cen.z + (b0.z - cen.z) * 20))
        return Vector((mx + (c.x - mx) * 1.22, c.y, c.z + 0.0))
    key("mouth_wide", f_wide)

    def f_o(i, c):
        if i in inner_idx:
            b0 = Vector(basis.data[i].co)
            return Vector((cen.x + (b0.x - cen.x) * 50 * 0.4, b0.y, cen.z + (b0.z - cen.z) * 50 * 1.2))
        return Vector((mx + (c.x - mx) * 0.45, c.y, c.z - R(14)))
    key("mouth_o", f_o)

    # ほお
    cheeks = []
    for nm, (cxp, cyp) in zip(("cheek_R", "cheek_L"), D["cheek"]):
        zm = Z(cyp)
        # 角度: 頭の面で x が合う角度を二分法で探す
        ax = W._axis_of([head])
        lo, hi = -89.0, 89.0
        for _ in range(40):
            mid = (lo + hi) / 2
            loc, _n = W._hit(hbvh, ax, mid, zm)
            if loc.x < X(cxp):
                lo = mid
            else:
                hi = mid
        c = W.soft_patch(nm, [head], (lo + hi) / 2, zm, R(D["cheek_r"][0]), R(D["cheek_r"][1]), (238, 150, 148),
                         fz, clearance=0.003, hardness=0.75, opacity=1.0, axis=ax)
        group(c, "head")
        cheeks.append(c)

    # 首の下・腕の付け根の影
    W.bake_ao([head, torso, *arms.values(), *feet.values(), sash], occluders=[head, torso, *arms.values(), *feet.values()], samples=32, dist=0.2, strength=0.6)

    # --- 骨の spec ---
    pa = {k: W.pivot_of(v) for k, v in arms.items()}
    spec = dict(
        height_m=1.0,
        bones=[
            dict(name="root", at=[0, 0, 0], parent=None),
            dict(name="body", at=[0, 0, round(Z(1010), 4)], parent="root"),
            dict(name="head", at=[0, 0, round(Z(610), 4)], parent="body"),
            dict(name="arm_L", at=[round(pa["arm_L"][0], 4), 0, round(pa["arm_L"][2] + 0.0, 4)], parent="body"),
            dict(name="arm_R", at=[round(pa["arm_R"][0], 4), 0, round(pa["arm_R"][2] + 0.0, 4)], parent="body"),
            dict(name="leg_L", at=[round(R(D["foot_dx"]), 4), 0, round(Z(1100), 4)], parent="root"),
            dict(name="leg_R", at=[-round(R(D["foot_dx"]), 4), 0, round(Z(1100), 4)], parent="root"),
            dict(name="eye_L", at=[round(X(D["eye_c"][1][0]), 4), -0.2, round(Z(D["eye_c"][1][1]), 4)], parent="head"),
            dict(name="eye_R", at=[round(X(D["eye_c"][0][0]), 4), -0.2, round(Z(D["eye_c"][0][1]), 4)], parent="head"),
        ],
        roles=dict(root="root", body="body", head="head", arm_L="arm_L", arm_R="arm_R", leg_L="leg_L", leg_R="leg_R"),
        motion=dict(only=["idle", "talk", "nod", "bow", "wave"], arm_amp=0.6),
    )
    json.dump(spec, open(WORK + "/rig.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("BUILD yokoso ok")


if __name__ == "__main__":
    main()
