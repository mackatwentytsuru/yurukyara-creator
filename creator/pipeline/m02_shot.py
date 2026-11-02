"""手組みの形(.blend)を、正面・横・斜めから撮る(Blender の背景モード)。比べる絵を作るための道具。

使い方: blender -b -P m02_shot.py -- <入力.blend> <出力フォルダ> [--views front,right,back,left,q] [--size 700]
        [--center x,z] [--scale 1.2]
- 正射影。既定は、部品全体の外接箱に合わせる。--center と --scale(メートル)で、頭だけなどの範囲を指定できる。
- 出力: <出力フォルダ>/shot_<向き>.png(白に近い背景)。向き: front(正面 -Y から)、right(キャラの右 -X から)、
  back、left、q(右前 45°)。
"""
import math
import os
import sys

import bpy
from mathutils import Vector

VIEWS = {"front": 0.0, "q": 40.0, "right": 90.0, "back": 180.0, "left": 270.0}


def main():
    a = sys.argv[sys.argv.index("--") + 1:]
    src, out = a[0], a[1]
    opt = {"--views": "front,right,q", "--size": "700", "--center": None, "--scale": None}
    for k in opt:
        if k in a:
            opt[k] = a[a.index(k) + 1]
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=src)
    sc = bpy.context.scene
    meshes = [o for o in sc.objects if o.type == "MESH"]
    vs = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    if opt["--center"]:
        cx, cz = [float(x) for x in opt["--center"].split(",")]
    else:
        cx, cz = 0.0, (mn.z + mx.z) / 2
    scale = float(opt["--scale"]) if opt["--scale"] else max(mx.z - mn.z, mx.x - mn.x) * 1.15
    # 全体を軸にぶら下げて回す
    piv = bpy.data.objects.new("Pivot", None)
    sc.collection.objects.link(piv)
    for o in [o for o in sc.objects if o.parent is None and o is not piv]:
        o.parent = piv
    world = bpy.data.worlds.new("W")
    sc.world = world
    world.use_nodes = True
    bgn = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bgn.inputs[0].default_value = (1, 1, 1, 1)
    bgn.inputs[1].default_value = 0.8
    for name, rot, energy in (("Key", (50, 0, -30), 2.2), ("Fill", (70, 0, 140), 0.8)):
        sun = bpy.data.lights.new(name, "SUN")
        sun.energy = energy
        so = bpy.data.objects.new(name, sun)
        sc.collection.objects.link(so)
        so.rotation_euler = [math.radians(r) for r in rot]
    cam = bpy.data.cameras.new("C")
    cam.type = "ORTHO"
    cam.ortho_scale = scale
    co = bpy.data.objects.new("C", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = (cx, -10, cz)
    co.rotation_euler = (math.radians(90), 0, 0)
    size = int(opt["--size"])
    sc.render.resolution_x = sc.render.resolution_y = size
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    sc.view_settings.view_transform = "Standard"
    for v in opt["--views"].split(","):
        piv.rotation_euler[2] = math.radians(VIEWS[v])
        sc.render.filepath = os.path.join(out, f"shot_{v}.png")
        bpy.ops.render.render(write_still=True)
    print("SHOT done", opt["--views"])


main()
