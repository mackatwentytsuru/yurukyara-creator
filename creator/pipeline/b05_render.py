"""段 9: model.glb を 8 方向から撮る(Blender の背景モード)。

使い方: blender -b -P b05_render.py -- <model.glb> <出力フォルダ> [--face-cols 4 --face-rows 6] [--size 600] [--pose <動きのGLB:フレーム>]
出力: <出力フォルダ>/view_<角度>.png(背景は白、正射影、真ん中に立つ)
- 顔の面は、表の左上の 1 マス(neutral・口を閉じた形)だけが出るよう UV を詰める。
- 動きの GLB を指定すると、そのフレームの姿勢で撮る。
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]


def arg(name, default, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:]
    return cast(a[a.index(name) + 1]) if name in a else default


def main():
    a = sys.argv[sys.argv.index("--") + 1:]
    src, out = a[0], a[1]
    cols, rows, size = arg("--face-cols", 4, int), arg("--face-rows", 6, int), arg("--size", 600, int)
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=src)
    # 読み込みが作る骨の飾り(Icosphere)は、親のない丸い玉。除く
    for o in [o for o in sc.objects if o.type == "MESH" and o.parent is None]:
        bpy.data.objects.remove(o)
    meshes = [o for o in sc.objects if o.type == "MESH"]
    for o in meshes:
        if o.name.startswith("Face"):
            uvl = o.data.uv_layers.active
            for d in uvl.data:
                u, v = d.uv
                d.uv = (u / cols, 1 - (1 - v) / rows)
    # 全体を 1 つの軸(空の物)にぶら下げて、それを回す
    root = bpy.data.objects.new("Pivot", None)
    sc.collection.objects.link(root)
    for o in [o for o in sc.objects if o.parent is None and o is not root]:
        o.parent = root
    if "--pose" in a:
        pgl, fr = arg("--pose", "", str).rsplit(":", 1)
        arm = next(o for o in sc.objects if o.type == "ARMATURE")
        before = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=pgl)
        new = [x for x in bpy.data.actions if x not in before]
        arm.animation_data_create()
        # 動きの GLB の骨にも同じ名前の action が付くので、元の骨へ付け替える
        arm.animation_data.action = new[0] if new else None
        sc.frame_set(int(fr))
        for o in list(sc.objects):
            if o.type == "ARMATURE" and o is not arm:
                bpy.data.objects.remove(o)
    vs = []
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        vs += [eo.matrix_world @ v.co for v in me.vertices]
        eo.to_mesh_clear()
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    ctr = (mn + mx) / 2
    h = mx.z - mn.z
    # 光(世界は白に近いやわらかい光 + 太陽)
    world = bpy.data.worlds.new("W")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.7
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 1.8
    so = bpy.data.objects.new("Sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-30))
    cam = bpy.data.cameras.new("Cam")
    cam.type = "ORTHO"
    cam.ortho_scale = h * 1.25
    co = bpy.data.objects.new("Cam", cam)
    sc.collection.objects.link(co)
    co.location = (ctr.x, ctr.y - 10, ctr.z)
    co.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = co
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.film_transparent = False
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError as e:
        print("engine", e)
    sc.view_settings.view_transform = "Standard"
    for ang in ANGLES:
        root.rotation_euler[2] = math.radians(ang)
        sc.render.filepath = os.path.join(out, f"view_{ang:03d}.png")
        bpy.ops.render.render(write_still=True)
    print("B05 done", out)


main()
