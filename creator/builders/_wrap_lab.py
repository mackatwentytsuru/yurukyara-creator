"""m01_wrap の部品と m03_contact の検査を試す場。わざと悪い物も置く(検査が落とすことを確かめるため)。

使い方: blender -b -P _wrap_lab.py -- <出力.blend> <画像の出力フォルダ>
置く物: 胴と頭、一周の帯(belt)、斜めのたすき(sash)、裾のフリル(frill)、頬(cheek)、耳(ear_ok)。
わざと悪い物: 浮いた玉(bad_float)、体に飲まれた玉(bad_swallowed)。
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m01_wrap as W  # noqa: E402


def main():
    a = sys.argv[sys.argv.index("--") + 1:]
    out, tex = a[0], a[1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fur = P.material("Fur", (236, 214, 170), rough=0.95, spec=0.1)
    red = P.material("Red", (214, 62, 62), rough=0.9, spec=0.1)
    blue = P.material("Blue", (60, 110, 200), rough=0.9, spec=0.1)
    white = P.material("White", (250, 246, 236), rough=0.9, spec=0.1)
    body = P.superquadric("body", (0.28, 0.24, 0.30), (0.9, 1.0), (0, 0, 0.30), mat=fur)
    head = P.superquadric("head", (0.32, 0.29, 0.28), (1.0, 1.0), (0, 0, 0.78), mat=fur)
    torso = [body, head]
    # 一周の帯: 高さ一定で 8 点の折れ線。たすき: 右肩から左の腰へ、前の半周
    belt = W.wrap_band("belt", [body], [(i * 45.0, 0.11) for i in range(8)], 0.05, thick=0.012, mat=blue, closed=True)
    sash = W.wrap_band("sash", [body], [(-80, 0.50), (-40, 0.44), (0, 0.38), (40, 0.32), (80, 0.26)], 0.07, thick=0.008,
                       mat=red)
    hem = [(0.285 * math.sin(math.radians(i * 15)), -0.245 * math.cos(math.radians(i * 15)), 0.06) for i in range(24)]
    frill = W.ruffle("frill", hem, 0.06, folds=14, gather=0.5, up=(0, 0, 1), outward=(0, 0, -1), mat=white)
    cheek = W.soft_patch("cheek0", [head], 40, 0.72, 0.06, 0.05, (243, 160, 155), tex)
    ear = P.superquadric("ear_ok", (0.05, 0.05, 0.14), (1, 1), (0.20, 0, 1.08), rot_deg=(0, 20, 0), mat=fur)
    P.superquadric("bad_float", (0.05, 0.05, 0.05), (1, 1), (0.6, 0, 1.0), mat=red)
    P.superquadric("bad_swallowed", (0.05, 0.05, 0.05), (1, 1), (0, 0, 0.78), mat=red)
    bpy.context.view_layer.update()
    report = W.bake_ao([body, head, belt, sash, ear], occluders=torso + [belt, sash, ear], samples=32, dist=0.2, strength=0.7)
    print("AO", report)
    print("BUILD ok", frill.name, cheek.name)
    bpy.ops.wm.save_as_mainfile(filepath=out)


main()
