"""手組み版 d_lantern(足なしの提灯)。元の絵を見て決めた部品:

  胴: やや平たい丸(紙のあかり。内側からの光を弱い発光で出す)
  骨(横の線): 胴にそった細い輪を 7 本(明るいだいだい色)
  ふた: 茶色の丸い厚い板 + つまみ。台座: 茶色の低い輪
  羽根: 布の板を左右に 1 枚ずつ(足の代わりの手)。上の端で胴に付き、下へ垂れて外へ開く
寸法は、元の絵(幅 1254px、全体の高さ 963px = 0.70m)の画素から割り出した。

使い方: blender -b -P d_lantern.py -- <出力.blend> [key=value ...]
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402

D = dict(
    body_r=(0.305, 0.285, 0.290), body_zc=0.335, body_e=(0.72, 1.0),
    lid_r=(0.165, 0.165, 0.038), lid_zc=0.620, lid_e=(0.45, 1.0),
    knob_r=(0.050, 0.050, 0.034), knob_zc=0.672,
    base_r=(0.196, 0.196, 0.040), base_zc=0.038, base_e=(0.45, 1.0),
    flap_w=0.115, flap_h=0.240, flap_z=0.435, flap_out=16.0, flap_flare=0.32, flap_ang=74.0, flap_yaw=44.0,
    rib_z=(0.105, 0.180, 0.255, 0.330, 0.405, 0.480, 0.545),
)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        k, v = kv.split("=")
        D[k] = eval(v)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    paper = P.material("Paper", (255, 214, 140), rough=0.9, emit=0.16, edge_rgb=True)
    brown = P.material("Wood", (122, 76, 46), rough=0.72)
    cloth = P.material("Cloth", (156, 104, 62), rough=0.92)
    rib = P.material("Rib", (240, 190, 128), rough=0.9, emit=0.25)
    rx, ry, rz = D["body_r"]
    parts = [P.superquadric("body", D["body_r"], D["body_e"], (0, 0, D["body_zc"]), mat=paper, seg=(72, 40))]
    P.gradient(parts[0], (255, 224, 156), (236, 150, 74), power=1.6, vertical=0.55)
    for i, z in enumerate(D["rib_z"]):
        t = (z - D["body_zc"]) / rz
        if abs(t) >= 0.98:
            continue
        k = (1 - abs(t) ** (2.0 / D["body_e"][0])) ** (D["body_e"][0] / 2.0) if D["body_e"][0] != 1 else math.sqrt(1 - t * t)
        parts.append(P.ring(f"rib{i}", (rx + ry) / 2 * k + 0.001, 0.0045, (0, 0, z), mat=rib, squash=1.0, seg=(72, 8)))
    parts.append(P.superquadric("lid", D["lid_r"], D["lid_e"], (0, 0, D["lid_zc"]), mat=brown, seg=(56, 20)))
    parts.append(P.superquadric("knob", D["knob_r"], (0.9, 1.0), (0, 0, D["knob_zc"]), mat=brown, seg=(32, 16)))
    parts.append(P.superquadric("base", D["base_r"], D["base_e"], (0, 0, D["base_zc"]), mat=brown, seg=(56, 20)))
    for side, nm in ((1, "L"), (-1, "R")):
        # 胴の側面(その高さの断面)の、正面から flap_ang 度の所に上の端を付け、胴にそって回す
        t = (D["flap_z"] - D["body_zc"]) / rz
        ev = D["body_e"][0]
        k = (1 - abs(t) ** (2.0 / ev)) ** (ev / 2.0)
        a = math.radians(D["flap_ang"])
        px = side * rx * k * math.sin(a) * 0.95
        py = -ry * k * math.cos(a) * 0.95
        parts.append(P.cloth(f"flap_{nm}", D["flap_w"], D["flap_h"], bend=0.05, flare=D["flap_flare"],
                             center=(px, py, D["flap_z"]), rot_deg=(-D["flap_out"], 0, side * D["flap_yaw"]), mat=cloth))
    bpy.ops.wm.save_as_mainfile(filepath=out)
    vs = [v.co for o in parts for v in o.data.vertices]
    print("BUILD d_lantern", len(parts), "parts", "bbox x", round(min(v.x for v in vs), 3), round(max(v.x for v in vs), 3),
          "z", round(min(v.z for v in vs), 3), round(max(v.z for v in vs), 3))


main()
