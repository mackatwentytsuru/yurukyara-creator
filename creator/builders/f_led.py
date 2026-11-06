"""手組み版 f_led(LED パネルのゆるキャラ)。元の絵(Claude が SVG で描いた絵。creator/samples/f_led_元の絵.svg)を見て決めた部品:

  体: 丸みのある四角い箱(紺色のつや消し・やわらかいゴム)。前面は光る点の画面(顔の面は骨を入れる段で貼る)
  腕: 短くて太い楕円体を、外へ少し開いて 2 本。体の側面に付け根がうまる
  脚: 太い柱 2 本 + つま先がふくらんだ足 2 つ
画素 → メートル: 絵 1254px。足の裏(y=1093)から体のてっぺん(y=140)が 954px = 0.9m なので S = 1060 px/m。
体の幅 762px = 0.719m、画面 613×536px、脚の幅 143px、足の幅 245px(measure.py で測った)。

使い方: blender -b -P f_led.py -- <出力.blend> [key=value ...]
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402

S = 1060.0          # px / m
CX, FY = 627, 1093  # 絵の左右の中心と足元の画素


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


# 絵の画素のまま書く(撮って重ねて直す)。奥行き(ry)は、設定の幅 0.73 × 奥行き 0.56 から。
D = dict(
    body_c=(627, 516), body_r=(381, 297, 376), body_e=(0.24, 0.24),
    arm_c=(1001, 592), arm_r=(90, 90, 215), arm_tilt=37.0,
    leg_c=(190, 937), leg_r=(74, 80, 60),
    foot_c=(204, 1036), foot_dy=-0.05, foot_r=(124, 138, 58),
)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        if kv.startswith("--"):
            continue
        k, v = kv.split("=")
        D[k] = eval(v)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # 紺のやわらかいゴム: 絵の標本(側面 45,68,138 など)に、ブラウザの沈み(約 0.9 倍)を見込んで、つや消し + 縁の明るみ(sheen)
    navy = P.material("Navy", (34, 56, 128), rough=0.88, spec=0.12, sheen=1.0, sheen_tint=(120, 150, 230))
    parts = []
    bc, br = D["body_c"], D["body_r"]
    parts.append(P.superquadric("body", tuple(R(v) for v in br), D["body_e"], (0, 0, Z(bc[1])), mat=navy, seg=(72, 40)))
    for side, nm in ((1, "L"), (-1, "R")):
        ac, ar = D["arm_c"], D["arm_r"]
        parts.append(P.superquadric(f"arm_{nm}", tuple(R(v) for v in ar), (0.8, 0.9), (side * X(ac[0]), 0.0, Z(ac[1])),
                                    rot_deg=(0, -side * D["arm_tilt"], 0), mat=navy, seg=(40, 24)))
        lc, lr = D["leg_c"], D["leg_r"]
        parts.append(P.superquadric(f"leg_{nm}", tuple(R(v) for v in lr), (0.45, 0.9), (side * R(lc[0]), -0.012, Z(lc[1])),
                                    mat=navy, seg=(40, 24)))
        fc, fr = D["foot_c"], D["foot_r"]
        parts.append(P.superquadric(f"foot_{nm}", tuple(R(v) for v in fr), (0.95, 1.0),
                                    (side * R(fc[0]), D["foot_dy"], Z(fc[1])), mat=navy, seg=(40, 24)))
    bpy.ops.wm.save_as_mainfile(filepath=out)
    vs = [v.co + o.location for o in parts for v in o.data.vertices]
    print("BUILD f_led", len(parts), "parts", "bbox x", round(min(v.x for v in vs), 3), round(max(v.x for v in vs), 3),
          "z", round(min(v.z for v in vs), 3), round(max(v.z for v in vs), 3))


main()
