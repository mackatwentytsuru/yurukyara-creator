"""ようこそくん(緑の毛足のぬいぐるみ。大きな丸い頭、小さな丸い胴、短い丸い腕、短い脚に丸い足、赤いたすき)の手組み builder。
元の絵: Claude が SVG で描いた絵(creator/samples/yokoso_元の絵.svg を 1254×1254 に撮った PNG)。
作業フォルダには sash.png と sash.json を先に作っておく(creator/pipeline/t01_band_texture.py)。
使い方: blender -b -P yokoso.py -- <出力.blend> work=<作業フォルダ>"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m01_wrap as W  # noqa: E402

# 絵の高さ(足の底 1142 〜 頭のてっぺん 97)= 1046px を 1.0m に割りあてる
S = 1046.0
CX, FY = 626.5, 1142.0
WORK = "."


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


# 画素のまま。半径は (横 rx, 奥行き ry, 縦 rz)
D = dict(
    head_c=(627, 420), head_r=(342, 330, 322),
    body_c=(627, 868), body_r=(226, 205, 172),
    arm_root=(486, 800), arm_tip=(380, 892), arm_r=62,
    shoulder_c=(486, 780), hand_c=(346, 924), hand_r=(72, 66, 72),
    leg_c=(552, 1042), leg_r=(58, 56, 62),
    foot_c=(526, 1092), foot_r=(96, 86, 50),
    eye_dx=122, eye_c=430, eye_r=(42, 68),
    light_off=(-12, -28), light_r=15,
    mouth_a=(587, 520), mouth_b=(627, 568), mouth_c=(667, 520), mouth_w=6.5,
    cheek_dx=209, cheek_y=540, cheek_r=(58, 44),
    sash_text_fill=1.0, sash_w_scale=1.0,
)
SASH_SEG = 120

GREEN = (138, 186, 40)
CHEEK = (255, 140, 166)
SASH = (208, 44, 40)


def group(ob, bone):
    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


class Head:
    """頭の楕円体の式。顔の部品を面に載せる。"""

    def __init__(self):
        hc, hr = D["head_c"], D["head_r"]
        self.cx, self.zc = X(hc[0]), Z(hc[1])
        self.rx, self.ry, self.rz = R(hr[0]), R(hr[1]), R(hr[2])

    def surf_y(self, x, z):
        v = 1.0 - ((x - self.cx) / self.rx) ** 2 - ((z - self.zc) / self.rz) ** 2
        return -self.ry * math.sqrt(max(v, 0.0))

    def tilt_deg(self, x, z):
        """面の法線が -Y からどれだけ横へ傾くか(Z まわり)。+X 側で正。"""
        y = self.surf_y(x, z)
        nx = (x - self.cx) / self.rx ** 2
        ny = y / self.ry ** 2
        return math.degrees(math.atan2(nx, -ny))


def build_face(H, mats):
    out = {}
    # ---- 目(縦長の楕円)+ ハイライト 1 つ ----
    parts = []
    er = D["eye_r"]
    for sign in (-1, 1):
        ex = X(627 + sign * D["eye_dx"])
        ez = Z(D["eye_c"])
        ys = H.surf_y(ex, ez)
        ang = H.tilt_deg(ex, ez)
        a = math.radians(ang)
        ey = ys - 0.010
        e = P.superquadric(f"eye{sign}", (R(er[0]), 0.006, R(er[1])), (1.0, 1.0), (ex, ey, ez), rot_deg=(0, 0, ang),
                           mat=mats["black"], seg=(40, 20))
        parts.append(e)
        lx, lz = R(D["light_off"][0]), -R(D["light_off"][1])
        cx_ = ex + lx * math.cos(a) + 0.0045 * math.sin(a)
        cy_ = ey + lx * math.sin(a) - 0.0045 * math.cos(a)
        l = P.superquadric(f"light{sign}", (R(D["light_r"]), 0.004, R(D["light_r"])), (1.0, 1.0),
                           (cx_, cy_, ez + lz), rot_deg=(0, 0, ang), mat=mats["white"], seg=(24, 12))
        parts.append(l)
        # 面に沈めた極小の球(m03 の「浮き」を避ける)
        s = P.superquadric(f"eyesink{sign}", (0.004, 0.004, 0.004), (1.0, 1.0), (ex, ys + 0.008, ez - 0.02), mat=mats["black"], seg=(8, 6))
        parts.append(s)
    eyes = P.join(parts, "Eyes")
    gL = eyes.vertex_groups.new(name="eye_L")
    gR = eyes.vertex_groups.new(name="eye_R")
    for v in eyes.data.vertices:   # +X 側 = eye_L
        (gL if v.co.x > 0 else gR).add([v.index], 1.0, "REPLACE")
    eyes.shape_key_add(name="Basis")
    bl = eyes.shape_key_add(name="eye_blink")
    zc = Z(D["eye_c"])
    for i, v in enumerate(eyes.data.vertices):
        bl.data[i].co = Vector((v.co.x, v.co.y, zc + (v.co.z - zc) * 0.06))
    bl.value = 0.0
    out["Eyes"] = eyes

    # ---- 口: 笑った線(黒い管)+ 口の中(基準では点につぶれている楕円)----
    a, b, c = D["mouth_a"], D["mouth_b"], D["mouth_c"]
    pts = []
    n = 13
    for k in range(n):
        t = k / (n - 1)
        px = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0]
        py = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]
        x, z = X(px), Z(py)
        pts.append((x, H.surf_y(x, z) - 0.016, z))
    rw = R(D["mouth_w"])
    tube = P.tube("smile", pts, [rw] * n, mat=mats["black"], n=12)
    ntube = len(tube.data.vertices)
    mz = Z(548)
    mcx = X(627)
    inner = P.superquadric("inner", (R(34), 0.006, R(26)), (1.0, 1.0), (mcx, H.surf_y(mcx, mz) - 0.012, mz), mat=mats["inner"], seg=(24, 12))
    ninner = len(inner.data.vertices)
    inner_full = [v.co.copy() for v in inner.data.vertices]
    ctr = Vector((mcx, H.surf_y(mcx, mz) - 0.012, mz))
    for v in inner.data.vertices:    # 基準では点につぶす
        v.co = ctr.copy()
    sink = P.superquadric("mouthsink", (0.004, 0.004, 0.004), (1.0, 1.0), (mcx, H.surf_y(mcx, Z(530)) + 0.008, Z(530)), mat=mats["black"], seg=(8, 6))
    mo = P.join([tube, inner, sink], "Mouth")
    base = [v.co.copy() for v in mo.data.vertices]
    mo.shape_key_add(name="Basis")

    def key(name, fn):
        k = mo.shape_key_add(name=name)
        for i, p in enumerate(base):
            k.data[i].co = fn(i, p.copy())
        k.value = 0.0

    def on_surface(p0, x1, z1):
        """動かした先の頭の面に合わせて奥行きを直す(面からの距離は、動かす前のまま)。"""
        off = p0.y - H.surf_y(p0.x, p0.z)
        return Vector((x1, H.surf_y(x1, z1) + off, z1))

    def open_fn(i, p):
        if i < ntube:
            t = 1.0 - min(1.0, abs(p.x - mcx) / R(42)) ** 2
            return on_surface(p, p.x, p.z - 0.020 * t)
        if i < ntube + ninner:
            f = inner_full[i - ntube]
            return on_surface(f, f.x, f.z - 0.012)
        return p
    key("mouth_open", open_fn)

    def wide_fn(i, p):
        if i < ntube:
            return on_surface(p, mcx + (p.x - mcx) * 1.35, p.z + 0.004 * min(1.0, abs(p.x - mcx) / R(42)))
        return p
    key("mouth_wide", wide_fn)

    def o_fn(i, p):
        if i < ntube:
            return on_surface(p, mcx + (p.x - mcx) * 0.35, mz + (p.z - mz) * 0.35)
        if i < ntube + ninner:
            f = inner_full[i - ntube]
            return on_surface(f, mcx + (f.x - mcx) * 0.62, f.z + 0.002)
        return p
    key("mouth_o", o_fn)
    out["Mouth"] = mo
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
    band = json.load(open(WORK + "/sash.json", encoding="utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fz = WORK + "/fuzz"
    os.makedirs(fz, exist_ok=True)
    green = P.fuzz_material("Green", GREEN, fz, grain=0.12, normal_strength=1.0)
    mats = dict(
        black=P.material("Black", (18, 18, 20), rough=0.35, spec=0.4),
        white=P.material("White", (252, 252, 252), rough=0.4, spec=0.3),
        inner=P.material("Inner", (96, 20, 30), rough=0.6, spec=0.2),
    )

    # ---- 体: 頭・胴・脚・足・腕 ----
    hc, hr = D["head_c"], D["head_r"]
    head = P.superquadric("head", tuple(R(v) for v in hr), (1.0, 1.0), (X(hc[0]), 0, Z(hc[1])), mat=green, seg=(64, 40))
    P.auto_uv(head, tile=4.0)
    group(head, "head")
    bc, br = D["body_c"], D["body_r"]
    torso = P.superquadric("torso", tuple(R(v) for v in br), (1.0, 1.0), (X(bc[0]), 0, Z(bc[1])), mat=green, seg=(64, 40))
    P.auto_uv(torso, tile=4.0)
    group(torso, "body")
    feet = {}
    for sign, nm in ((-1, "leg_R"), (1, "leg_L")):
        lc, lr = D["leg_c"], D["leg_r"]
        leg = P.superquadric(nm + "_leg", tuple(R(v) for v in lr), (1.0, 1.0), (X(627 + sign * abs(lc[0] - 627)), 0, Z(lc[1])), mat=green, seg=(32, 20))
        fc, fr = D["foot_c"], D["foot_r"]
        foot = P.superquadric(nm + "_foot", tuple(R(v) for v in fr), (1.0, 1.0), (X(627 + sign * abs(fc[0] - 627)), -0.02, Z(fc[1])), mat=green, seg=(40, 24))
        lf = P.join([leg, foot], nm + "_part")
        P.auto_uv(lf, tile=4.0)
        group(lf, nm)
        feet[nm] = lf
    arms = {}
    for sign, nm in ((-1, "arm_R"), (1, "arm_L")):
        rt, tp = D["arm_root"], D["arm_tip"]
        root = (X(627 + sign * abs(rt[0] - 627)), 0.0, Z(rt[1]))
        tip = (X(627 + sign * abs(tp[0] - 627)), 0.0, Z(tp[1]))
        # 丸い腕: 胴の中から手へ、太さの変わらない管(W.limb は付け根を面の外へ出すので、小さな丸い胴では肩に抜けが残った)
        pts = [(root[0] + (tip[0] - root[0]) * t, 0.0, root[2] + (tip[2] - root[2]) * t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        arm = P.tube(nm + "_sleeve", pts, [R(D["arm_r"])] * 5, mat=green, n=28)
        pivot = [round(v, 4) for v in root]
        hcx, hcy = D["hand_c"]
        hand = P.superquadric(nm + "_hand", tuple(R(v) for v in D["hand_r"]), (1.0, 1.0),
                              (X(627 + sign * abs(hcx - 627)), 0.0, Z(hcy)), mat=green, seg=(40, 24))
        arm = P.join([arm, hand], nm + "_part")
        arm["pivot"] = pivot
        P.auto_uv(arm, tile=4.0)
        group(arm, nm)
        arms[nm] = arm

    # ---- 顔 ----
    H = Head()
    face = build_face(H, mats)
    group(face["Mouth"], "head")
    cx_ = R(D["cheek_dx"])
    for sign in (-1, 1):
        x = sign * cx_
        z = Z(D["cheek_y"])
        ang = math.degrees(math.asin(max(-0.99, min(0.99, x / (H.rx * math.sqrt(max(1 - ((z - H.zc) / H.rz) ** 2, 0.01)))))))
        ck = W.soft_patch(f"cheek{sign}", [head], ang, z, R(D["cheek_r"][0]), R(D["cheek_r"][1]), CHEEK, fz,
                          clearance=0.014, hardness=0.35, opacity=0.95)
        group(ck, "head")

    # ---- たすき: 元の絵から測った前の道 → 閉じた 1 本の輪 ----
    bvh = W.body_bvh([torso])
    axis = W._axis_of([torso])
    bw = R(br[0])

    def ang_at(xm, zm):
        lo, hi = -89.0, 89.0
        for _ in range(40):
            mid = (lo + hi) / 2
            loc, _ = W._hit(bvh, axis, mid, zm)
            if loc.x - axis[0] < xm:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2
    front = []
    for (px, py) in band["path"]:
        xm, zm = X(px), Z(py)
        dz = (zm - Z(bc[1])) / R(br[2])
        half = bw * math.sqrt(max(1 - dz * dz, 0.0))
        if abs(xm - X(bc[0])) < half * 0.93:     # 胴の外の点(道の両端)は捨てる
            front.append((ang_at(xm - X(bc[0]) + axis[0], zm), zm))
    sash_m = P.material("SashRed", SASH, rough=0.85, spec=0.15)
    nt = sash_m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = bpy.data.images.load(WORK + "/sash.png")
    tx.image.colorspace_settings.name = "sRGB"
    tx.extension = "EXTEND"
    nt.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])
    # 平面(tilted_loop)は、小さく丸い胴では、傾きが急で肩と腰の横が胴の底へ出て当たらなかった。
    # 前は測った道、背中は端の高さから反対の端へなめらかに戻す、閉じた 1 本の道にする。
    a1, z1 = front[-1]
    a0, z0 = front[0]
    loop = []
    for k in range(36):
        ang = -180.0 + 10.0 * k
        if a0 <= ang <= a1:
            z = float(__import__("numpy").interp(ang, [f[0] for f in front], [f[1] for f in front]))
        else:
            u = (ang - a1) % 360.0
            t = u / ((a0 + 360.0) - a1)
            sm = t * t * (3 - 2 * t)
            z = z1 + (z0 - z1) * sm
        loop.append((ang, z))
    fit_err = 0.0
    sash = W.wrap_band("sash", [torso], loop, R(band["width_px"]) * D["sash_w_scale"], thick=0.006, clearance=0.005, mat=sash_m,
                       seg=SASH_SEG, rows=10, closed=True, over=[arms["arm_R"]], under=[head, arms["arm_L"], arms["arm_R"]])
    W.band_text_uv(sash, loop, SASH_SEG, front[0][0], front[-1][0], D["sash_text_fill"])
    print(f"BUILD sash fit_err_mm={fit_err * 1000:.1f} front_pts={len(front)} a0={front[0][0]:.1f} a1={front[-1][0]:.1f}")
    group(sash, "body")

    body_parts = [head, torso, *arms.values(), *feet.values(), sash]
    W.bake_ao(body_parts, occluders=[head, torso, *arms.values(), *feet.values()], samples=32, dist=0.2, strength=0.6)

    rig = {
        "root": [0, 0, 0],
        "body": [0, 0, round(Z(bc[1]), 4)],
        "head": [0, 0, round(Z(735), 4)],
        "arm_L": [round(v, 4) for v in list(arms["arm_L"]["pivot"])],
        "arm_R": [round(v, 4) for v in arms["arm_R"]["pivot"]],
        "leg_L": [round(X(627 + abs(D["leg_c"][0] - 627)), 4), 0, round(Z(1000), 4)],
        "leg_R": [round(X(627 - abs(D["leg_c"][0] - 627)), 4), 0, round(Z(1000), 4)],
        "eye_L": [round(X(627 + D["eye_dx"]), 4), round(H.surf_y(X(627 + D["eye_dx"]), Z(D["eye_c"])), 4), round(Z(D["eye_c"]), 4)],
        "eye_R": [round(X(627 - D["eye_dx"]), 4), round(H.surf_y(X(627 - D["eye_dx"]), Z(D["eye_c"])), 4), round(Z(D["eye_c"]), 4)],
    }
    json.dump(rig, open(WORK + "/rig_at.json", "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD yokoso ok", json.dumps(rig))


if __name__ == "__main__":
    main()
