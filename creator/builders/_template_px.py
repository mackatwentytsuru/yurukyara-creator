"""手組みの builder の型(画素から組む版)。新しいキャラは、この型をコピーして、辞書 D の数字と部品を書き換える。

考え方:
1. 元の絵の高さ(足から頭のてっぺん)の画素数を、実寸(メートル)に割りあてる。S = 画素数 ÷ 実寸。
2. 絵の左右の中心の画素 CX と、足元の画素 FY を決める。X(px) = (px - CX) / S、Z(py) = (FY - py) / S、R(px) = px / S。
3. 部品の中心・半径を、絵の画素のまま辞書 D に書く(例: 目玉の中心 (350, 320)、半径 118)。奥行き(Y、前が負)は、横向きの絵から。
4. 部品ごとに、骨の名前の頂点グループ(重み 1)をつける。目・口はシェイプキーを持つ別の物にまとめる。
5. 保存した .blend を b07_rig_groups.py に渡すと、骨・GLB・動きが出る。

使い方: blender -b -P _template_px.py -- <出力.blend> [key=value …]
この型は、頭と胴と 2 つの目と口だけの、ごく小さなキャラを作る(動作の確認用)。
"""
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402

S = 1000.0          # 画素 → メートルの割合(絵の高さ 800px を 0.8m にするなら S = 1000)
CX, FY = 512, 900   # 絵の左右の中心と足元の画素


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


D = dict(
    body_c=(512, 700), body_r=(150, 120, 170),
    head_c=(512, 420), head_r=(190, 170, 180),
    eye_cx=(440, 584), eye_cy=410, eye_r=(30, 12, 38),
    mouth_c=(512, 500), mouth_r=(50, 10, 20),
)


def group(ob, bone):
    vg = ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        k, v = kv.split("=")
        D[k] = eval(v)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body_m = P.material("Body", (120, 170, 240), rough=0.5)
    head_m = P.material("Head", (250, 210, 160), rough=0.5)
    eye_m = P.material("Eye", (30, 30, 40), rough=0.3)
    mouth_m = P.material("Mouth", (200, 60, 70), rough=0.5)
    bc, br = D["body_c"], D["body_r"]
    body = P.superquadric("body", tuple(R(v) for v in br), (0.7, 0.8), (X(bc[0]), 0, Z(bc[1])), mat=body_m)
    group(body, "body")
    hc, hr = D["head_c"], D["head_r"]
    head = P.superquadric("head", tuple(R(v) for v in hr), (1.0, 1.0), (X(hc[0]), 0, Z(hc[1])), mat=head_m)
    group(head, "head")
    eyes = []
    for i, ex in enumerate(D["eye_cx"]):
        er = D["eye_r"]
        e = P.superquadric(f"eye{i}", tuple(R(v) for v in er), (1.0, 1.0), (X(ex), -R(hr[1]) + 0.004, Z(D["eye_cy"])), mat=eye_m, seg=(24, 12))
        group(e, "head")
        eyes.append(e)
    eo = P.join(eyes, "Eyes")
    eo.shape_key_add(name="Basis")
    bl = eo.shape_key_add(name="eye_blink")
    zc = Z(D["eye_cy"])
    for i, v in enumerate(eo.data.vertices):
        bl.data[i].co = Vector((v.co.x, v.co.y, zc + (v.co.z - zc) * 0.08))
    bl.value = 0.0
    mc, mr = D["mouth_c"], D["mouth_r"]
    mo = P.superquadric("Mouth", tuple(R(v) for v in mr), (1.0, 1.0), (X(mc[0]), -R(hr[1]) + 0.004, Z(mc[1])), mat=mouth_m, seg=(24, 12))
    group(mo, "head")
    mo.shape_key_add(name="Basis")
    op = mo.shape_key_add(name="mouth_open")
    top = Z(mc[1] - mr[2])
    for i, v in enumerate(mo.data.vertices):
        op.data[i].co = Vector((v.co.x, v.co.y, top + (v.co.z - top) * 2.2))
    op.value = 0.0
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD template ok")


if __name__ == "__main__":
    main()
