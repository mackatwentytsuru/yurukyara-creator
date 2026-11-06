"""手組み版 d_lantern(足なしの提灯)。元の絵(Claude が SVG で描いた絵。creator/samples/d_lantern_元の絵.svg)を見て決めた部品:

  胴: やや平たい丸(和紙。内側からのあかりを、中心のクリーム色 → 縁の橙の頂点の色と、弱い発光で出す)
  骨(横の線): 胴にそった細い橙の輪を 9 本
  ふた: 茶色の丸い厚い板 + つまみ(球。ふたに少し沈める)。台座: 茶色の低い輪
  羽根: 茶色の布の板を左右に 1 枚ずつ(足の代わりの手)。上の端で胴に付き、下へ垂れて外へ少し開く
画素 → メートル: 絵 1254px。足の裏(y=1075)からつまみのてっぺん(y=110)が 966px = 0.70m なので S = 1380 px/m。
胴の幅 840px = 0.609m、ふたの幅 430px、台座の幅 450px、羽根の長さ 385px(measure で測った)。

使い方: blender -b -P d_lantern.py -- <出力.blend> [key=value ...]
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402

S = 1380.0          # px / m
CX, FY = 627, 1075  # 絵の左右の中心と足元(台座の底)の画素


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


# 絵の画素のまま書く。奥行き(ry)は設定の「やや平たい丸」から胴の幅に近い値にした。
D = dict(
    body_c=(627, 650), body_r=(422, 392, 362), body_e=(1.0, 1.0),
    lid_c=(627, 269), lid_r=(218, 218, 53), lid_e=(0.45, 1.0),
    knob_c=(627, 174), knob_r=(64, 64, 64),
    base_c=(627, 1033), base_r=(228, 228, 44), base_e=(0.45, 1.0),
    paper_glow=0.0,
    rib_y=(365, 440, 515, 590, 665, 740, 815, 890, 950),
    flap_path=((392, 532, 44), (425, 610, 60), (461, 700, 72), (477, 786, 80), (481, 826, 80), (483, 852, 70), (485, 872, 50), (485, 886, 20)), flap_y=-0.06, flap_ry=0.28,
)


def smooth(path, per=5):
    """(dx, py, 半幅) の点列を Catmull-Rom でなめらかに増やす(点が少ないと管がかくかくになる)。"""
    pts = [path[0]] + list(path) + [path[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(per):
            t = k / per
            out.append(tuple(0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t * t
                                    + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t ** 3) for c in range(3)))
    out.append(path[-1])
    return out


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        if kv.startswith("--"):
            continue
        k, v = kv.split("=")
        D[k] = eval(v)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    paper = P.material("Paper", (255, 214, 140), rough=0.9, emit=0.5, edge_rgb=True, spec=0.0)
    # 頂点の色 → 発光 の接続は glTF に書き出せず、白い発光になって色が洗われる(測って確認)。発光は一定の暖色にする。
    nt = paper.node_tree
    bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    for lk in list(nt.links):
        if lk.to_socket == bs.inputs["Emission Color"]:
            nt.links.remove(lk)
    bs.inputs["Emission Color"].default_value = (1.0, 0.62, 0.28, 1.0)
    bs.inputs["Emission Strength"].default_value = D["paper_glow"]
    brown = P.material("Wood", (110, 66, 38), rough=0.72)
    cloth = P.material("Cloth", (140, 90, 52), rough=0.92)
    rib = P.material("Rib", (232, 125, 45), rough=0.9, emit=0.25)
    bc, br = D["body_c"], D["body_r"]
    rx, ry, rz = (R(v) for v in br)
    zc = Z(bc[1])
    parts = [P.superquadric("body", (rx, ry, rz), D["body_e"], (0, 0, zc), mat=paper, seg=(72, 40))]
    P.gradient(parts[0], (255, 238, 196), (224, 100, 22), power=0.42, vertical=0.5)
    for i, py in enumerate(D["rib_y"]):
        t = (Z(py) - zc) / rz
        if abs(t) >= 0.98:
            continue
        k = math.sqrt(1 - t * t)
        parts.append(P.ring(f"rib{i}", rx * k + 0.0015, 0.0045, (0, 0, Z(py)), mat=rib, squash=1.0, seg=(72, 8),
                            xy=(1.0, ry / rx)))
    lc, lr = D["lid_c"], D["lid_r"]
    parts.append(P.superquadric("lid", tuple(R(v) for v in lr), D["lid_e"], (0, 0, Z(lc[1])), mat=brown, seg=(56, 20)))
    kc, kr = D["knob_c"], D["knob_r"]
    parts.append(P.superquadric("knob", tuple(R(v) for v in kr), (0.9, 1.0), (0, 0, Z(kc[1])), mat=brown, seg=(32, 16)))
    sc, sr = D["base_c"], D["base_r"]
    parts.append(P.superquadric("base", tuple(R(v) for v in sr), D["base_e"], (0, 0, Z(sc[1])), mat=brown, seg=(56, 20)))
    for side, nm in ((1, "L"), (-1, "R")):
        # 羽根: 絵の羽根の中心線(胴の縁のすぐ内側から、下へ向けて外へ開く曲線)と、各点の半幅(px)から、平たい管で作る。
        # 板(cloth)だと外の縁が直線になり、絵のふくらんだ縁と合わず、すその丸みも出なかった。
        path = smooth(D["flap_path"])
        pts = [(side * X(CX + dx), D["flap_y"], Z(py)) for dx, py, _ in path]
        radii = [R(r) for _, _, r in path]
        parts.append(P.tube(f"flap_{nm}", pts, radii, mat=cloth, n=24, ry_scale=D["flap_ry"]))
    bpy.ops.wm.save_as_mainfile(filepath=out)
    vs = [v.co + o.location for o in parts for v in o.data.vertices]
    print("BUILD d_lantern", len(parts), "parts", "bbox x", round(min(v.x for v in vs), 3), round(max(v.x for v in vs), 3),
          "z", round(min(v.z for v in vs), 3), round(max(v.z for v in vs), 3))


main()
