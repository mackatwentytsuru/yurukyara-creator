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


# 画素のまま。半径は (横 rx, 奥行き ry, 縦 rz)
D = dict(
    body_c=(627, 684), body_r=(352, 330, 322),
    foot_dx=129, foot_c=995, foot_r=(108, 86, 61),
    arm_root_dx=290, hand_dx=386, hand_c=708, hand_r=(90, 62, 82), arm_r=52, arm_y=0.015,
    eye_dx=83, eye_c=716, eye_r=(35, 48), light_off=(-10, -17), light_r=9, light2_off=(8, 14), light2_r=5,
    mouth_c=(627, 795), mouth_r=(40, 18),
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


def build_face(H, mats):
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

    # ---- 口: 開いた笑い口(暗い楕円。下が丸い)+ 舌(桃)。基準は小さい口、mouth_open で縦に開く ----
    mc, mr = D["mouth_c"], D["mouth_r"]
    mcx, mz = X(mc[0]), Z(mc[1])
    dark = P.superquadric("mouthin", (R(mr[0]), 0.006, R(mr[1])), (1.0, 1.0), (mcx, H.surf_y(mcx, mz) - 0.014, mz), mat=mats["mouth"], seg=(32, 16), taper=(0.22, 1.0))
    nd = len(dark.data.vertices)
    tz = mz + R(9)
    tongue = P.superquadric("tongue", (R(12), 0.004, R(6)), (1.0, 1.0), (mcx, H.surf_y(mcx, tz) - 0.017, tz), mat=mats["tongue"], seg=(24, 12))
    nt = len(tongue.data.vertices)
    sink = P.superquadric("mouthsink", (0.004, 0.004, 0.004), (1.0, 1.0), (mcx, H.surf_y(mcx, Z(770)) + 0.008, Z(770)), mat=mats["mouth"], seg=(8, 6))
    mo = P.join([dark, tongue, sink], "Mouth")
    base = [v.co.copy() for v in mo.data.vertices]
    mo.shape_key_add(name="Basis")

    def on_surface(p0, x1, z1):
        off = p0.y - H.surf_y(p0.x, p0.z)
        return Vector((x1, H.surf_y(x1, z1) + off, z1))

    def key(name, fn):
        k = mo.shape_key_add(name=name)
        for i, p in enumerate(base):
            k.data[i].co = fn(i, p.copy())
        k.value = 0.0

    top = mz - R(mr[1])      # 口の上の縁(動かさない)

    def open_fn(i, p):
        if i < nd + nt:
            return on_surface(p, p.x, top + (p.z - top) * 2.0 - R(1) * 0 if i < nd else top + (p.z - top) * 2.0 - R(3))
        return p
    key("mouth_open", open_fn)

    def wide_fn(i, p):
        if i < nd + nt:
            return on_surface(p, mcx + (p.x - mcx) * 1.3, p.z)
        return p
    key("mouth_wide", wide_fn)

    def o_fn(i, p):
        if i < nd + nt:
            return on_surface(p, mcx + (p.x - mcx) * 0.45, mz + (p.z - mz) * 1.5)
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
    face = build_face(H, mats)
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
