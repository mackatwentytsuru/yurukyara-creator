"""段 8b: 動きの途中の姿勢を撮って、骨と重みの崩れを見つける(Blender の背景モード)。

使い方: blender -b -P b06_posecheck.py -- <rig.blend> <出力フォルダ> <動き:フレーム> [<動き:フレーム> …] [--size 360] [--yaw 25]
出力: <出力フォルダ>/pose_<動き>_<フレーム>.png(白い背景、正射影)。一覧にするのは s02_posesheet.py。
- 顔の面は、表の左上の 1 マスだけを出す。
"""
import math
import os
import sys

import bpy
from mathutils import Vector


def main():
    a = sys.argv[sys.argv.index("--") + 1:]
    size, yaw = 560, 20.0
    if "--size" in a:
        i = a.index("--size")
        size = int(a[i + 1])
        del a[i:i + 2]
    if "--yaw" in a:
        i = a.index("--yaw")
        yaw = float(a[i + 1])
        del a[i:i + 2]
    blend, out, shots = a[0], a[1], a[2:]
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    arm = bpy.data.objects["Rig"]
    face = bpy.data.objects.get("Face")
    if face:
        uvl = face.data.uv_layers.active
        for d in uvl.data:
            u, v = d.uv
            d.uv = (u / 4, 1 - (1 - v) / 6)
    world = bpy.data.worlds.new("W2")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bgn = next(n for n in nt.nodes if n.type == "BACKGROUND")
    bgn.inputs[0].default_value = (1, 1, 1, 1)
    bgn.inputs[1].default_value = 0.7
    sun = bpy.data.lights.new("S", "SUN")
    sun.energy = 1.8
    so = bpy.data.objects.new("S", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-30))
    cam = bpy.data.cameras.new("C")
    cam.type = "ORTHO"
    body = bpy.data.objects["Body"]
    zs = [v.co.z for v in body.data.vertices]
    H = max(zs) - min(zs)
    cam.ortho_scale = H * 1.75
    co = bpy.data.objects.new("C", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    r = 10.0
    co.location = (r * math.sin(math.radians(yaw)), -r * math.cos(math.radians(yaw)), H * 0.55)
    co.rotation_euler = (math.radians(90), 0, math.radians(yaw))
    sc.render.resolution_x = sc.render.resolution_y = size
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    sc.view_settings.view_transform = "Standard"
    arm.animation_data_create()
    for sh in shots:
        name, fr = sh.split(":")
        arm.animation_data.action = bpy.data.actions[name]
        sc.frame_set(int(fr))
        sc.render.filepath = os.path.join(out, f"pose_{name}_{int(fr):03d}.png")
        bpy.ops.render.render(write_still=True)
    print("B06 done", len(shots))


main()
