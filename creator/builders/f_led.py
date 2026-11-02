"""手組み版 f_led(LED パネルのゆるキャラ)。元の絵を見て決めた部品:

  体: 丸みのある四角い箱(幅 0.73 × 奥行き 0.56 × 高さ 0.72 m)、紺色のつやなし。前面は光る点の画面(顔の面は骨を入れる段で貼る)
  腕: 短くて太い楕円体を、外へ少し開いて 2 本。体の側面に付け根がうまる
  脚: 太い柱 2 本 + つま先がふくらんだ足 2 つ
寸法は、元の絵(幅 1254px、体の幅 790px = 0.726m)の画素から割り出した。

使い方: blender -b -P f_led.py -- <出力.blend> [--tweak key=value ...]
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402

# 試すたびに Claude が直す数字(m)
D = dict(
    body_rx=0.363, body_ry=0.275, body_rz=0.362, body_zc=0.54, body_e=(0.40, 0.40),
    arm_x=0.412, arm_z=0.375, arm_r=(0.074, 0.082, 0.140), arm_tilt=22.0,
    leg_x=0.150, leg_z=0.150, leg_r=(0.098, 0.105, 0.155), leg_taper=(1.20, 0.86),
    foot_x=0.158, foot_y=-0.062, foot_z=0.044, foot_r=(0.100, 0.130, 0.040),
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
    navy = P.material("Navy", (30, 52, 108), rough=0.9, spec=0.1, sheen=1.0, sheen_tint=(120, 150, 230))
    parts = []
    parts.append(P.superquadric("body", (D["body_rx"], D["body_ry"], D["body_rz"]), D["body_e"],
                                (0, 0, D["body_zc"]), mat=navy, seg=(72, 40)))
    for side, nm in ((1, "L"), (-1, "R")):
        parts.append(P.superquadric(f"arm_{nm}", D["arm_r"], (0.8, 0.9), (side * D["arm_x"], 0.0, D["arm_z"]),
                                    rot_deg=(0, -side * D["arm_tilt"], 0), mat=navy, seg=(40, 24)))
        parts.append(P.superquadric(f"leg_{nm}", D["leg_r"], (0.55, 0.9), (side * D["leg_x"], -0.012, D["leg_z"]),
                                    mat=navy, seg=(40, 24), taper=D["leg_taper"]))
        parts.append(P.superquadric(f"foot_{nm}", D["foot_r"], (0.95, 1.0),
                                    (side * D["foot_x"], D["foot_y"], D["foot_z"]), mat=navy, seg=(40, 24)))
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD f_led", len(parts), "parts")


main()
