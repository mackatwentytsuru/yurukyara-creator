"""質感の案を、同じ形・同じ光・同じ角度で並べて比べる(質感の試験場)。

使い方: blender -b -P _texture_lab.py -- <出力フォルダ> [R,G,B]
  案 A: 平らな色+つや消し(質感なし。基準)
  B: シーン(縁の毛羽)だけ
  C: 頂点の色の濃淡+シーン
  D: 毛足の画像+法線+シーン(ぬいぐるみの毛足)
  E: トゥーン(平らな色+茶色の輪郭線の殻)
  F: 毛足の画像+輪郭の毛羽(縁に毛の殻)
出力: <出力フォルダ>/lab.png(5 つの球を並べた絵)と、案ごとの絵
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402


def main():
    a = sys.argv[sys.argv.index("--") + 1:]
    out = a[0]
    rgb = tuple(int(v) for v in a[1].split(",")) if len(a) > 1 else (244, 150, 150)
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    tint = tuple(min(255, int(v * 1.12 + 10)) for v in rgb)
    line = P.material("Line", (92, 54, 24), rough=1.0, spec=0.0)
    line.use_backface_culling = True
    mats = {
        "A 平らな色": P.material("A", rgb, rough=0.9, spec=0.1),
        "B シーン": P.material("B", rgb, rough=0.9, spec=0.1, sheen=1.0, sheen_tint=tint),
        "C 頂点の色+シーン": P.material("C", rgb, rough=0.9, spec=0.1, sheen=1.0, sheen_tint=tint, edge_rgb=True),
        "D 毛足の画像+法線": P.fuzz_material("D", rgb, os.path.join(out, "tex"), sheen_tint=tint, grain=0.16, normal_strength=1.6),
        "E トゥーン(輪郭線)": P.material("E", rgb, rough=1.0, spec=0.0),
        "F 毛足+輪郭の毛羽": P.fuzz_material("F", rgb, os.path.join(out, "tex"), sheen_tint=tint, grain=0.16, normal_strength=1.2, seed=5),
    }
    objs = []
    for i, (nm, m) in enumerate(mats.items()):
        o = P.superquadric(nm, (0.5, 0.45, 0.5), (0.9, 1.0), ((i - 2.5) * 1.15, 0, 0), mat=m, seg=(96, 48))
        if nm.startswith("C"):
            P.gradient(o, tuple(min(255, int(v * 1.1)) for v in rgb), tuple(int(v * 0.85) for v in rgb), power=1.2, vertical=0.3)
        if nm.startswith("F"):
            P.auto_uv(o, tile=2.2)
            P.fuzz_shell(o, tuple(int(v * 0.97) for v in rgb), os.path.join(out, "tex"), thick=0.02, density=0.5, layers=3)
        if nm.startswith("D"):
            P.auto_uv(o, tile=2.2)
        if nm.startswith("E"):
            P.outline(o, 0.012, line)
        objs.append(o)
    world = bpy.data.worlds.new("W")
    sc.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.8
    for name, rot, e in (("Key", (50, 0, -30), 2.2), ("Fill", (70, 0, 140), 0.8)):
        s = bpy.data.lights.new(name, "SUN")
        s.energy = e
        so = bpy.data.objects.new(name, s)
        sc.collection.objects.link(so)
        so.rotation_euler = [math.radians(r) for r in rot]
    cam = bpy.data.cameras.new("C")
    cam.type = "ORTHO"
    cam.ortho_scale = 7.0
    co = bpy.data.objects.new("C", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    co.location = (0, -10, 0.1)
    co.rotation_euler = (math.radians(90), 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = 2160, 420
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = os.path.join(out, "lab_raw.png")
    bpy.ops.render.render(write_still=True)
    with open(os.path.join(out, "names.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(mats.keys()))
    # D だけ GLB に書き出して、画像が入る(毛足が持ち出せる)ことを確かめる
    bpy.ops.object.select_all(action="DESELECT")
    objs[3].select_set(True)
    bpy.context.view_layer.objects.active = objs[3]
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, "fuzz_D.glb"), export_format="GLB", use_selection=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type == "MESH" and (o.name.startswith("shell") or o.name.startswith("F")):
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, "fuzz_F.glb"), export_format="GLB", use_selection=True)
    print("LAB done")


main()
