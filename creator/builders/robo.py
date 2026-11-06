"""ロボくん(クリーム色の胴に青緑の差し色、顔が黒い画面の、硬い樹脂の案内ロボット)の手組み builder。
元の絵: Claude が SVG で描いた絵(creator/samples/robo_元の絵.svg を 1254×1254 に撮った PNG)。全高 1048px(足の底 1115 〜 蝶ネクタイでなくアンテナの玉の上 68)= 1.0m。
硬い樹脂なので毛足(fuzz)は使わない。
使い方: blender -b -P robo.py -- <出力.blend> work=<作業フォルダ>"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m01_wrap as W  # noqa: E402

S = 1048.0
CX, FY = 627.0, 1115.0
WORK = "."


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


# 画素のまま。半径は (横 rx, 奥行き ry, 縦 rz)
D = dict(
    head_c=(627, 405), head_r=(280, 205, 215), head_e=(0.3, 0.3),
    screen_c=(627, 405), screen_r=(222, 160), screen_e=(0.3, 0.3),
    eye_c=((539, 371), (713, 371)), eye_r=50,
    mouth_a=(556, 466), mouth_b=(627, 528), mouth_c=(698, 466), mouth_w=10,
    antenna_stem=(627, 168), antenna_stem_r=(10, 10, 27), ball_c=(627, 106), ball_r=38,
    ear_c=(338, 400), ear_r=(50, 76, 76),
    neck_c=(627, 630), neck_r=(98, 58, 12),
    torso_c=(627, 771), torso_r=(140, 105, 135), torso_e=(0.45, 0.45), pants_z=800,
    button_y=(716, 766), button_r=22,
    bow_c=(627, 664), knot_r=(26, 18, 28), wing_c=(570, 662), wing_r=(64, 15, 31), wing_tilt=-8,
    pad_c=(458, 676), pad_r=(70, 62, 54), pad_tilt=18,
    arm_a=(462, 692), arm_b=(404, 830), arm_r=52, cuff_c=(398, 834), cuff_r=(53, 11), cuff_tilt=22.3,
    joint_c=(478, 724), joint_r=(50, 46, 48), hand_c=(382, 896), hand_r=(56, 52, 56),
    leg_x=566, leg_c_z=965, leg_r=(36, 36, 86),
    foot_c=(534, 1062), foot_r=(92, 100, 54),
)

CREAM = (226, 206, 160)
TEAL = (36, 160, 158)
RED = (205, 46, 40)
SCREEN = (16, 26, 38)
GLOW = (255, 238, 196)


def group(ob, bone):
    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


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
    cream = P.material("Cream", CREAM, rough=0.3, spec=0.55)
    teal = P.material("Teal", TEAL, rough=0.25, spec=0.6)
    red = P.material("Red", RED, rough=0.22, spec=0.6)
    screen_m = P.material("Screen", SCREEN, rough=0.12, spec=0.8)
    glow = P.material("Glow", GLOW, rough=0.5, emit=0.8)
    dim = P.material("GlowDim", (230, 170, 100), rough=0.5, emit=0.9)

    # ---- 頭: 角の丸い四角 ----
    hc, hr = D["head_c"], D["head_r"]
    head = P.superquadric("head", tuple(R(v) for v in hr), D["head_e"], (X(hc[0]), 0, Z(hc[1])), mat=cream, seg=(64, 48))
    group(head, "head")
    front = -R(hr[1])
    sc, sr = D["screen_c"], D["screen_r"]
    screen = P.superquadric("screen", (R(sr[0]), 0.010, R(sr[1])), D["screen_e"], (X(sc[0]), front - 0.004, Z(sc[1])),
                            mat=screen_m, seg=(48, 24))
    group(screen, "head")
    sfront = front - 0.004 - 0.010     # 画面の前面
    # ---- 目(光る円)と口(光る笑った線)----
    parts = []
    ey = sfront - 0.004
    for (px, py) in D["eye_c"]:
        e = P.superquadric(f"eye{px}", (R(D["eye_r"]), 0.005, R(D["eye_r"])), (1.0, 1.0), (X(px), ey, Z(py)), mat=glow, seg=(40, 20))
        parts.append(e)
        parts.append(P.superquadric(f"eyesink{px}", (0.004, 0.004, 0.004), (1.0, 1.0), (X(px), sfront + 0.012, Z(py) - 0.01), mat=screen_m, seg=(8, 6)))
    eyes = P.join(parts, "Eyes")
    gL = eyes.vertex_groups.new(name="eye_L")
    gR = eyes.vertex_groups.new(name="eye_R")
    for v in eyes.data.vertices:
        (gL if v.co.x > 0 else gR).add([v.index], 1.0, "REPLACE")
    eyes.shape_key_add(name="Basis")
    bl = eyes.shape_key_add(name="eye_blink")
    zc = Z(D["eye_c"][0][1])
    for i, v in enumerate(eyes.data.vertices):
        bl.data[i].co = Vector((v.co.x, v.co.y, zc + (v.co.z - zc) * 0.06))
    bl.value = 0.0

    a, b, c = D["mouth_a"], D["mouth_b"], D["mouth_c"]
    n = 13
    pts = []
    for k in range(n):
        t = k / (n - 1)
        px = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0]
        py = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]
        pts.append((X(px), ey, Z(py)))
    tube = P.tube("smile", pts, [R(D["mouth_w"])] * n, mat=glow, n=12)
    ntube = len(tube.data.vertices)
    mcx, mz = X(627), Z(492)
    inner = P.superquadric("inner", (R(48), 0.005, R(30)), (1.0, 1.0), (mcx, ey, mz), mat=dim, seg=(24, 12))
    ninner = len(inner.data.vertices)
    inner_full = [v.co.copy() for v in inner.data.vertices]
    ctr = Vector((mcx, ey, mz))
    for v in inner.data.vertices:
        v.co = ctr.copy()
    sink = P.superquadric("mouthsink", (0.004, 0.004, 0.004), (1.0, 1.0), (mcx, sfront + 0.012, Z(520)), mat=screen_m, seg=(8, 6))
    mo = P.join([tube, inner, sink], "Mouth")
    base = [v.co.copy() for v in mo.data.vertices]
    mo.shape_key_add(name="Basis")

    def key(name, fn):
        k = mo.shape_key_add(name=name)
        for i, p in enumerate(base):
            k.data[i].co = fn(i, p.copy())
        k.value = 0.0

    def open_fn(i, p):
        if i < ntube:
            t = 1.0 - min(1.0, abs(p.x - mcx) / R(80)) ** 2
            return Vector((p.x, p.y, p.z - 0.022 * t))
        if i < ntube + ninner:
            f = inner_full[i - ntube]
            return Vector((f.x, f.y, f.z - 0.004))
        return p
    key("mouth_open", open_fn)
    key("mouth_wide", lambda i, p: Vector((mcx + (p.x - mcx) * 1.3, p.y, p.z + 0.004 * min(1.0, abs(p.x - mcx) / R(80)))) if i < ntube else p)

    def o_fn(i, p):
        if i < ntube:
            return Vector((mcx + (p.x - mcx) * 0.3, p.y, mz + (p.z - mz) * 0.3))
        if i < ntube + ninner:
            f = inner_full[i - ntube]
            return Vector((mcx + (f.x - mcx) * 0.55, f.y, f.z))
        return p
    key("mouth_o", o_fn)
    group(mo, "head")

    # ---- アンテナ・耳当て・首 ----
    stem = P.superquadric("stem", tuple(R(v) for v in D["antenna_stem_r"]), (0.6, 1.0), (X(D["antenna_stem"][0]), 0, Z(D["antenna_stem"][1])), mat=teal, seg=(24, 12))
    ball = P.superquadric("ball", (R(D["ball_r"]),) * 3, (1.0, 1.0), (X(D["ball_c"][0]), 0, Z(D["ball_c"][1])), mat=red, seg=(40, 24))
    group(stem, "head")
    group(ball, "head")
    for sign in (-1, 1):
        ear = P.superquadric(f"ear{sign}", tuple(R(v) for v in D["ear_r"]), (1.0, 1.0), (X(627 + sign * abs(D["ear_c"][0] - 627)), 0, Z(D["ear_c"][1])), mat=teal, seg=(32, 20))
        group(ear, "head")
    neck = P.superquadric("neck", tuple(R(v) for v in D["neck_r"]), (0.7, 1.0), (X(D["neck_c"][0]), 0, Z(D["neck_c"][1])), mat=cream, seg=(24, 12))
    group(neck, "body")

    # ---- 胴: クリーム色。下の半分の面だけ青緑(パンツ形)----
    tc, tr = D["torso_c"], D["torso_r"]
    torso = P.superquadric("torso", tuple(R(v) for v in tr), D["torso_e"], (X(tc[0]), 0, Z(tc[1])), mat=cream, seg=(64, 40))
    torso.data.materials.append(teal)
    zp = Z(D["pants_z"])
    for p in torso.data.polygons:
        zc_ = sum(torso.data.vertices[i].co.z for i in p.vertices) / len(p.vertices)
        # 腰の線をゆるく弧にする(中央が低い)
        xc_ = sum(torso.data.vertices[i].co.x for i in p.vertices) / len(p.vertices)
        p.material_index = 1 if zc_ < zp - 0.012 * (1 - (xc_ / R(tr[0])) ** 2) else 0
    group(torso, "body")
    tfront = -R(tr[1])
    for i, py in enumerate(D["button_y"]):
        bt = P.superquadric(f"button{i}", (R(D["button_r"]), 0.008, R(D["button_r"])), (1.0, 1.0), (X(627), tfront - 0.003, Z(py)), mat=teal, seg=(24, 12))
        group(bt, "body")
    # 蝶ネクタイ
    knot = P.superquadric("knot", tuple(R(v) for v in D["knot_r"]), (0.7, 0.7), (X(D["bow_c"][0]), tfront - 0.008, Z(D["bow_c"][1])), mat=red, seg=(24, 16))
    wings = [knot]
    for sign in (-1, 1):
        wc, wr = D["wing_c"], D["wing_r"]
        wg = P.superquadric(f"wing{sign}", tuple(R(v) for v in wr), (1.0, 1.0), (X(627 + sign * abs(wc[0] - 627)), tfront - 0.002, Z(wc[1])),
                            rot_deg=(0, sign * D["wing_tilt"] * -1, 0), mat=red, seg=(32, 16))
        wings.append(wg)
    bow = P.join(wings, "bow")
    group(bow, "body")

    # ---- 腕・肩のパッド・手首の輪・手 / 脚と足 ----
    arms = {}
    for sign, nm in ((-1, "arm_R"), (1, "arm_L")):
        def sx(px):
            return X(627 + sign * abs(px - 627))
        a0, a1 = D["arm_a"], D["arm_b"]
        pts = [(sx(a0[0]) + (sx(a1[0]) - sx(a0[0])) * t, 0.0, Z(a0[1]) + (Z(a1[1]) - Z(a0[1])) * t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        arm = P.tube(nm + "_sleeve", pts, [R(D["arm_r"])] * 5, mat=cream, n=28)
        cc = D["cuff_c"]
        cuff = P.ring(nm + "_cuff", R(D["cuff_r"][0]), R(D["cuff_r"][1]), (sx(cc[0]), 0, Z(cc[1])), mat=teal, seg=(48, 16), squash=1.3, sq=0.6,
                      rot_deg=(0, sign * -D["cuff_tilt"], 0))
        hcn = D["hand_c"]
        hand = P.superquadric(nm + "_hand", tuple(R(v) for v in D["hand_r"]), (1.0, 1.0), (sx(hcn[0]), 0.0, Z(hcn[1])), mat=cream, seg=(40, 24))
        pc = D["pad_c"]
        pad = P.superquadric(nm + "_pad", tuple(R(v) for v in D["pad_r"]), (1.0, 1.0), (sx(pc[0]), 0.0, Z(pc[1])),
                             rot_deg=(0, sign * D["pad_tilt"], 0), mat=teal, seg=(40, 24))
        jc = D["joint_c"]
        joint = P.superquadric(nm + "_joint", tuple(R(v) for v in D["joint_r"]), (1.0, 1.0), (sx(jc[0]), 0.0, Z(jc[1])), mat=cream, seg=(32, 20))
        arm = P.join([arm, cuff, hand, pad, joint], nm + "_part")
        arm["pivot"] = [round(v, 4) for v in (sx(pc[0]), 0.0, Z(pc[1]))]
        group(arm, nm)
        arms[nm] = arm
    legs = {}
    for sign, nm in ((-1, "leg_R"), (1, "leg_L")):
        lx = X(627 + sign * abs(D["leg_x"] - 627))
        leg = P.superquadric(nm + "_leg", tuple(R(v) for v in D["leg_r"]), (0.5, 1.0), (lx, 0, Z(D["leg_c_z"])), mat=cream, seg=(32, 20))
        fc, fr = D["foot_c"], D["foot_r"]
        foot = P.superquadric(nm + "_foot", tuple(R(v) for v in fr), (1.0, 1.0), (X(627 + sign * abs(fc[0] - 627)), -0.03, Z(fc[1])), mat=teal, seg=(48, 24))
        lf = P.join([leg, foot], nm + "_part")
        group(lf, nm)
        legs[nm] = lf

    body_parts = [head, torso, neck, bow, *arms.values(), *legs.values()]
    W.bake_ao(body_parts, occluders=body_parts, samples=32, dist=0.2, strength=0.5)

    eyez = Z(D["eye_c"][0][1])
    rig = {
        "root": [0, 0, 0],
        "body": [0, 0, round(Z(tc[1]), 4)],
        "head": [0, 0, round(Z(630), 4)],
        "arm_L": list(arms["arm_L"]["pivot"]), "arm_R": list(arms["arm_R"]["pivot"]),
        "leg_L": [round(X(627 + abs(D["leg_x"] - 627)), 4), 0, round(Z(900), 4)],
        "leg_R": [round(X(627 - abs(D["leg_x"] - 627)), 4), 0, round(Z(900), 4)],
        "eye_L": [round(X(713), 4), round(ey, 4), round(eyez, 4)],
        "eye_R": [round(X(539), 4), round(ey, 4), round(eyez, 4)],
    }
    json.dump(rig, open(WORK + "/rig_at.json", "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD robo ok", json.dumps(rig))


if __name__ == "__main__":
    main()
