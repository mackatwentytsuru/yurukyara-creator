"""q_robot(クリーム色の胴に青緑の差し色、顔が黒い画面のロボット)。お店の入口に立つ案内役。
元の絵(1254px。全高 1203px = 1.0m)の画素から測って組んだ。硬い樹脂の質感なので毛足(fuzz)は使わない。
使い方: blender -b -P creator/builders/q_robot.py -- <出力.blend> <作業フォルダ>   (rig.json を作業フォルダに書く)"""
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
S = 1203.0
CX, FY = 626, 1223


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


# 胴の高さごとの半幅(px)。腕・肩を除いた輪郭から読んだ
TORSO = [(1042, 125), (1030, 150), (1010, 182), (985, 203), (960, 212), (900, 219), (860, 218), (820, 214),
         (780, 208), (720, 207), (680, 203), (660, 199), (640, 190), (620, 178), (600, 165), (586, 150)]
HEAD = [(592, 170), (591, 212), (587, 230), (574, 241), (555, 244), (525, 248), (500, 249), (420, 249), (340, 248), (300, 240), (260, 221),
        (236, 192), (220, 165), (210, 135)]
D = dict(
    head_depth=0.84, torso_depth=0.72,
    screen_c=(626, 420), screen_h=(197, 147),
    eye_c=((527, 407), (728, 407)), eye_r=35,
    mouth_ends=(583, 672), mouth_top=460, mouth_sag=28, mouth_t=5,
    ear_c=(384, 425), ear_r=(42, 70, 79),
    ant_ball=(627, 68, 45), ant_stem=(626, 17), ant_cap=(626, 208),
    bow_c=(626, 645),
    btn_c=(627, 755), btn_r=43,
    shoulder_c=(420, 692), arm_path=((440, 688), (404, 706), (366, 780), (344, 850), (338, 884)), arm_r=46,
    cuff_c=(343, 852), hand_c=(335, 920), hand_r=(54, 50, 52),
    leg_x=93, leg_c=1085, foot_c=(516, 1176), foot_r=(97, 98, 48),
)


def group(ob, bone):
    vg = ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


def secs(rows, depth, e, grow=0.0):
    return [dict(z=Z(py), cx=0.0, cy=0.0, rx=R(h + grow), ry=R(h + grow) * depth, e=e) for py, h in rows]


def interp(rows, py):
    rows = sorted(rows)
    for (y0, h0), (y1, h1) in zip(rows, rows[1:]):
        if y0 <= py <= y1:
            return h0 + (h1 - h0) * (py - y0) / (y1 - y0)
    return rows[0][1] if py < rows[0][0] else rows[-1][1]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cream = P.material("Cream", (228, 204, 167), rough=0.55, spec=0.35)
    teal = P.material("Teal", (52, 126, 115), rough=0.5, spec=0.4)
    red = P.material("Red", (194, 68, 52), rough=0.45, spec=0.4)
    screen_m = P.material("Screen", (40, 41, 39), rough=0.4, spec=0.25)
    glow = P.material("Glow", (255, 238, 168), rough=0.5, emit=1.0, spec=0.1)
    halo = P.material("Halo", (58, 52, 36), rough=0.6, emit=0.2, spec=0.1)

    # --- 頭 ---
    head = P.loft("head", secs(HEAD, D["head_depth"], 0.7), mat=cream, n=64, refine=4)
    group(head, "head")
    hbvh = W.body_bvh([head])

    def hy(xm, zm):
        return hbvh.ray_cast(Vector((xm, -3.0, zm)), Vector((0, 1, 0)), 6.0)[0].y

    def conform(ob, cy):
        for v in ob.data.vertices:
            v.co.y = hy(v.co.x, v.co.z) + (v.co.y - cy)

    sc_c, sc_h = D["screen_c"], D["screen_h"]
    screen = P.superquadric("screen", (R(sc_h[0]), 0.012, R(sc_h[1])), (0.5, 0.55),
                            (X(sc_c[0]), hy(X(sc_c[0]), Z(sc_c[1])), Z(sc_c[1])), mat=screen_m, seg=(64, 32))
    conform(screen, hy(X(sc_c[0]), Z(sc_c[1])))
    for v in screen.data.vertices:
        v.co.y -= 0.004
    group(screen, "head")
    for sx in (1, -1):
        ear = P.superquadric(f"ear{sx}", tuple(R(v) for v in D["ear_r"]), (0.7, 0.8),
                             (X(CX + sx * (CX - D["ear_c"][0])), 0, Z(D["ear_c"][1])), mat=teal, seg=(40, 24))
        group(ear, "head")
    bx, by_, br = D["ant_ball"]
    ball = P.superquadric("ant_ball", (R(br), R(br), R(br)), (1, 1), (X(bx), 0, Z(by_)), mat=red, seg=(32, 16))
    group(ball, "head")
    stem = P.tube("ant_stem", [(X(626), 0, Z(205 - 10 * k)) for k in range(11)], [R(D["ant_stem"][1])] * 11, mat=teal, n=16)
    group(stem, "head")
    cap = P.superquadric("ant_cap", (R(58), R(58), R(40)), (0.8, 1.0), (X(626), 0, Z(208)), mat=teal, seg=(32, 16))
    group(cap, "head")

    # --- 胴(上はクリーム、下は青緑) ---
    cream_rows = [(py, interp(TORSO, py)) for py in range(586, 861, 14)]
    teal_rows = [(py, interp(TORSO, py)) for py in range(846, 1043, 14)] + [(1042, 125)]
    tors_c = P.loft("torso_top", secs(cream_rows, D["torso_depth"], 0.9), mat=cream, n=64, refine=3)
    group(tors_c, "body")
    tors_t = P.loft("torso_low", secs(teal_rows, D["torso_depth"], 0.9, grow=2.0), mat=teal, n=64, refine=3)
    group(tors_t, "body")
    bvh_t = W.body_bvh([tors_c, tors_t])

    def ty(xm, zm):
        return bvh_t.ray_cast(Vector((xm, -3.0, zm)), Vector((0, 1, 0)), 6.0)[0].y

    bc = D["btn_c"]
    btn = P.superquadric("button", (R(D["btn_r"]), 0.010, R(D["btn_r"])), (1.0, 1.0),
                         (X(bc[0]), ty(X(bc[0]), Z(bc[1])), Z(bc[1])), mat=teal, seg=(40, 16))
    cy0 = ty(X(bc[0]), Z(bc[1]))
    for v in btn.data.vertices:
        v.co.y = ty(v.co.x, v.co.z) + (v.co.y - cy0) - 0.004
    group(btn, "body")
    # 蝶ネクタイ
    bw = D["bow_c"]
    bparts = []
    ykn = ty(X(bw[0]), Z(bw[1]))
    for sx in (1, -1):
        wx = X(CX + sx * 62)
        w = P.superquadric(f"bow_w{sx}", (R(40), 0.020, R(45)), (0.7, 0.8),
                           (wx, ty(wx, Z(bw[1])) - 0.004, Z(bw[1])), mat=red, seg=(32, 16))
        for v in w.data.vertices:   # 外へ向かって開く(結び目側は細い)
            side = (v.co.x - wx) * sx
            v.co.z = Z(bw[1]) + (v.co.z - Z(bw[1])) * (0.75 + 0.30 * (side / R(40) + 1) / 2)
        bparts.append(w)
    knot = P.superquadric("bow_knot", (R(27), 0.026, R(36)), (0.7, 0.8), (X(bw[0]), ykn - 0.012, Z(bw[1])), mat=red, seg=(24, 12))
    bparts.append(knot)
    for o in bparts:
        group(o, "body")

    # --- 腕(画像の右 = +X = arm_L) ---
    arms = {}
    for name, sx in (("arm_L", 1), ("arm_R", -1)):
        def mx(px, sx=sx):
            return X(CX + sx * (CX - px))
        path = []
        for (x0_, y0_), (x1_, y1_) in zip(D["arm_path"], D["arm_path"][1:]):
            for k in range(4):
                path.append((x0_ + (x1_ - x0_) * k / 4, y0_ + (y1_ - y0_) * k / 4))
        path.append(D["arm_path"][-1])
        a = P.tube(name, [(mx(px), 0.0, Z(py)) for px, py in path], [R(D["arm_r"])] * (len(path) - 1) + [R(D["arm_r"]) * 0.95], mat=cream, n=24)
        a["pivot"] = [mx(D["arm_path"][0][0]), 0.0, Z(D["arm_path"][0][1])]
        group(a, name)
        pad = P.superquadric(name + "_pad", (R(46), R(52), R(50)), (0.7, 0.8), (mx(D["shoulder_c"][0]), 0, Z(D["shoulder_c"][1])),
                             rot_deg=(0, sx * 12, 0), mat=teal, seg=(40, 24))
        group(pad, name)
        ang = math.degrees(math.atan2(D["arm_path"][-3][0] - D["arm_path"][-1][0], D["arm_path"][-1][1] - D["arm_path"][-3][1]))
        cuff = P.ring(name + "_cuff", R(45), R(8), (mx(D["cuff_c"][0]), 0, Z(D["cuff_c"][1])), mat=teal, seg=(40, 12),
                      squash=1.7, rot_deg=(0, sx * ang, 0), sq=0.6)
        group(cuff, name)
        hand = P.superquadric(name + "_hand", tuple(R(v) for v in D["hand_r"]), (0.9, 0.95),
                              (mx(D["hand_c"][0]), 0, Z(D["hand_c"][1])), mat=cream, seg=(40, 24))
        group(hand, name)
        arms[name] = a

    # --- 脚と足 ---
    for name, sx in (("leg_L", 1), ("leg_R", -1)):
        leg = P.tube(name + "_leg", [(sx * R(D["leg_x"]), -0.003, Z(1030 + 10 * k)) for k in range(12)], [R(53)] * 12, mat=cream, n=28)
        group(leg, name)
        fc, fr = D["foot_c"], D["foot_r"]
        foot = P.superquadric(name + "_foot", tuple(R(v) for v in fr), (0.7, 0.9), (sx * R(CX - fc[0]), -0.012, Z(fc[1])), mat=teal, seg=(48, 24))
        group(foot, name)

    # --- 顔(光る目・笑う口) ---
    eyes = []
    for i, (ec, nm) in enumerate(zip(D["eye_c"], ("eye_R", "eye_L"))):
        xm, zm = X(ec[0]), Z(ec[1])
        ys = hy(xm, zm)
        e = P.superquadric(f"eye{i}", (R(D["eye_r"]), 0.006, R(D["eye_r"])), (1, 1), (xm, ys, zm), mat=glow, seg=(32, 16))
        conform(e, ys)
        for v in e.data.vertices:
            v.co.y -= 0.019
        group(e, nm)
        eyes.append(e)
        h = P.superquadric(f"eyehalo{i}", (R(D["eye_r"] * 1.3), 0.004, R(D["eye_r"] * 1.3)), (1, 1), (xm, ys, zm), mat=halo, seg=(32, 16))
        conform(h, ys)
        for v in h.data.vertices:
            v.co.y -= 0.0165
        group(h, nm)
        eyes.append(h)
    eo = P.join(eyes, "Eyes")
    eo.shape_key_add(name="Basis")
    bl = eo.shape_key_add(name="eye_blink")
    zc = Z(D["eye_c"][0][1])
    for i, v in enumerate(eo.data.vertices):
        bl.data[i].co = Vector((v.co.x, v.co.y, zc + (v.co.z - zc) * 0.08))
    bl.value = 0.0

    x0, x1 = D["mouth_ends"]
    pts, rad = [], []
    N = 14
    for k in range(N + 1):
        px = x0 + (x1 - x0) * k / N
        u = (px - (x0 + x1) / 2) / ((x1 - x0) / 2)
        py = D["mouth_top"] + D["mouth_sag"] * (1 - u * u)
        xm, zm = X(px), Z(py)
        pts.append((xm, hy(xm, zm) - 0.018, zm))
        rad.append(R(D["mouth_t"]) * (0.75 + 0.25 * (1 - u * u)))
    mt = P.tube("mouth_line", pts, rad, mat=glow, n=10, ry_scale=0.6)
    group(mt, "head")
    mx_ = X((x0 + x1) / 2)
    mzc = Z(D["mouth_top"] + D["mouth_sag"] - 8)
    mi = P.superquadric("mouth_in", (R(50), 0.006, R(26)), (1, 1), (mx_, hy(mx_, mzc), mzc), mat=glow, seg=(24, 12))
    conform(mi, hy(mx_, mzc))
    for v in mi.data.vertices:
        v.co.y -= 0.018
    group(mi, "head")
    mi.vertex_groups.new(name="tmp_inner").add([v.index for v in mi.data.vertices], 1.0, "REPLACE")
    mo = P.join([mt, mi], "Mouth")
    tmp = mo.vertex_groups["tmp_inner"].index
    inner_idx = {v.index for v in mo.data.vertices if any(g.group == tmp for g in v.groups)}
    mo.vertex_groups.remove(mo.vertex_groups["tmp_inner"])
    mo.shape_key_add(name="Basis")
    cen = Vector((mx_, 0, mzc))
    basis = mo.data.shape_keys.key_blocks["Basis"]
    for i in inner_idx:
        v = mo.data.vertices[i].co
        basis.data[i].co = Vector((cen.x + (v.x - cen.x) * 0.02, v.y, cen.z + (v.z - cen.z) * 0.02))
    for i, v in enumerate(mo.data.vertices):
        v.co = basis.data[i].co

    def key(name, fn):
        k = mo.shape_key_add(name=name)
        for i, v in enumerate(mo.data.vertices):
            k.data[i].co = fn(i, Vector(v.co))
        k.value = 0.0

    def inner(i, fx, fz):
        b0 = Vector(basis.data[i].co)
        return Vector((cen.x + (b0.x - cen.x) * fx, b0.y, cen.z + (b0.z - cen.z) * fz))

    key("mouth_open", lambda i, c: inner(i, 50, 50) if i in inner_idx else c)
    key("mouth_wide", lambda i, c: inner(i, 40, 20) if i in inner_idx else Vector((mx_ + (c.x - mx_) * 1.22, c.y, c.z)))
    key("mouth_o", lambda i, c: inner(i, 20, 60) if i in inner_idx else Vector((mx_ + (c.x - mx_) * 0.45, c.y, c.z - R(14))))

    # --- 骨 ---
    pa = {k: W.pivot_of(v) for k, v in arms.items()}
    spec = dict(
        height_m=1.0,
        bones=[
            dict(name="root", at=[0, 0, 0], parent=None),
            dict(name="body", at=[0, 0, round(Z(1000), 4)], parent="root"),
            dict(name="head", at=[0, 0, round(Z(600), 4)], parent="body"),
            dict(name="arm_L", at=[round(pa["arm_L"][0], 4), 0, round(pa["arm_L"][2], 4)], parent="body"),
            dict(name="arm_R", at=[round(pa["arm_R"][0], 4), 0, round(pa["arm_R"][2], 4)], parent="body"),
            dict(name="leg_L", at=[round(R(D["leg_x"]), 4), 0, round(Z(1050), 4)], parent="root"),
            dict(name="leg_R", at=[-round(R(D["leg_x"]), 4), 0, round(Z(1050), 4)], parent="root"),
            dict(name="eye_L", at=[round(X(D["eye_c"][1][0]), 4), -0.2, round(Z(D["eye_c"][1][1]), 4)], parent="head"),
            dict(name="eye_R", at=[round(X(D["eye_c"][0][0]), 4), -0.2, round(Z(D["eye_c"][0][1]), 4)], parent="head"),
        ],
        roles=dict(root="root", body="body", head="head", arm_L="arm_L", arm_R="arm_R", leg_L="leg_L", leg_R="leg_R"),
        motion=dict(only=["idle", "talk", "nod", "bow", "wave"], arm_amp=0.6),
    )
    json.dump(spec, open(WORK + "/rig.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("BUILD q_robot ok")


main()
