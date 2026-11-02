"""段 4: TRELLIS の GLB を、塗れて動かせるメッシュに整える(Blender の背景モード)。

使い方:
  blender -b -P b01_mesh.py -- <入力.glb> <出力.obj> --height 1.0 --faces 30000 [--yaw 0] [--smooth 0] [--info 出力.json]

- 大きさ: 高さを --height(m)にそろえ、足元を z=0、左右と前後の中心を原点に置く。
- 向き: 正面が -Y、上が +Z(p05 の決まり)。--yaw は Z まわりの回転(度)で、向きの直しに使う。
- 減らす: 形を先に減らす(模様つきのまま減らさない)。collapse の後に平面の溶け合わせは使わない。
- UV: スマート UV(角度 66°)。出力 OBJ は UV つき。
"""
import json
import math
import sys

import bpy
import bmesh
from mathutils import Vector


def args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = {"yaw": 0.0, "height": 1.0, "faces": 30000, "smooth": 0, "info": None, "pos": []}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--yaw", "--height", "--faces", "--smooth", "--info"):
            out[a[2:]] = type(out[a[2:]])(argv[i + 1]) if out[a[2:]] is not None else argv[i + 1]
            i += 2
        else:
            out["pos"].append(a)
            i += 1
    return out


def main():
    a = args()
    src, dst = a["pos"][0], a["pos"][1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # 材質と頂点の色は捨てる(形だけを使う)
    ob.data.materials.clear()
    for attr in list(ob.data.color_attributes):
        ob.data.color_attributes.remove(attr)
    if a["yaw"]:
        ob.rotation_euler[2] = math.radians(a["yaw"])
        bpy.ops.object.transform_apply(rotation=True)
    # 重なった点をまとめる
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-6)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    n0 = len(ob.data.polygons)
    # 三角形にそろえてから減らす
    mod = ob.modifiers.new("tri", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=mod.name)
    n_tri = len(ob.data.polygons)
    if n_tri > a["faces"]:
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = a["faces"] / n_tri
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # 減らした後の面のかたかたを、軽くならす(薄い所が縮まないよう少しだけ)
    if a["smooth"] > 0:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.vertices_smooth(factor=0.4, repeat=a["smooth"])
        bpy.ops.object.mode_set(mode="OBJECT")
    # 大きさと置き場所
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    s = a["height"] / (mx.z - mn.z)
    cx, cy = 0.5 * (mn.x + mx.x), 0.5 * (mn.y + mx.y)
    for v in ob.data.vertices:
        v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z - mn.z) * s))
    ob.data.update()
    # UV
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.validate()
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.wm.obj_export(filepath=dst, export_selected_objects=True, forward_axis="NEGATIVE_Y", up_axis="Z",
                          export_materials=False, export_normals=True, export_uv=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    vs = [v.co for v in ob.data.vertices]
    info = {"faces_in": n0, "faces_tri": n_tri, "faces_out": len(ob.data.polygons), "verts": len(vs),
            "scale": s, "boundary_edges": boundary, "nonmanifold_edges": nonman,
            "bbox_min": [min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)],
            "bbox_max": [max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)]}
    print("B01", json.dumps(info))
    if a["info"]:
        with open(a["info"], "w", encoding="utf-8") as f:
            json.dump(info, f, indent=1)


main()
