"""段 7(手組み・部品ごとの骨): 頂点グループが骨の名前になっている部品の集まりに、骨を入れ、model.glb と動きの GLB を書き出す。

使い方: blender -b -P b07_rig_groups.py -- <rig_spec.json> <入力.blend> <出力フォルダ>

入力の約束(builder が守る):
- メッシュの物ごとに、骨の名前の頂点グループが付いている(重み 1)。つなぎ目で重みを混ぜず、部品ごとに剛体で動かす(玩具のような手組みの体向け)。
- シェイプキーを持つ物(目・口)は、そのまま持ち込まれ、GLB のモーフターゲットになる。
rig_spec.json: { "bones": [ {"name", "at": [x, y, z](メートル), "parent"} … ], "roles": {…}, "motion": {"only": […]} } — 位置はメートル。
出力: model.glb、motions/<名前>.glb、rig.blend、rig_report.json
"""
import json
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b04_motions  # noqa: E402


def main():
    spec_path, blend, out = sys.argv[sys.argv.index("--") + 1:][:3]
    spec = json.load(open(spec_path, encoding="utf-8"))
    os.makedirs(os.path.join(out, "motions"), exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    sc.render.fps = 30
    meshes = [o for o in sc.objects if o.type == "MESH"]
    arm_data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", arm_data)
    sc.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    blen = spec.get("bone_len", 0.05)
    for b in spec["bones"]:
        eb = arm_data.edit_bones.new(b["name"])
        eb.head = Vector(b["at"])
        eb.tail = eb.head + Vector((0, 0, blen))
        eb.roll = 0
    for b in spec["bones"]:
        if b.get("parent"):
            arm_data.edit_bones[b["name"]].parent = arm_data.edit_bones[b["parent"]]
    bpy.ops.object.mode_set(mode="OBJECT")
    names = {b["name"] for b in spec["bones"]}
    problems = []
    for o in meshes:
        groups = {g.name for g in o.vertex_groups}
        if not groups:
            problems.append(f"{o.name}: 頂点グループなし")
        for g in groups - names:
            problems.append(f"{o.name}: 骨にない頂点グループ {g}")
        o.parent = arm
        m = o.modifiers.new("Armature", "ARMATURE")
        m.object = arm
    if problems:
        print("B07 警告", problems)

    def export(path, objs, anim):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        kw = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False)
        if sc.get("ao_vertex"):   # m01_wrap.bake_ao の影(頂点の色 Col)を、材質が使っていなくても GLB に入れる。three.js が色の絵に掛ける
            kw.update(export_vertex_color="ACTIVE")
        if anim:
            kw.update(export_animations=True, export_animation_mode="ACTIVE_ACTIONS", export_force_sampling=True,
                      export_frame_range=True, export_optimize_animation_size=False)
        else:
            kw.update(export_animations=False)
        bpy.ops.export_scene.gltf(**kw)

    export(os.path.join(out, "model.glb"), [arm] + meshes, False)
    arm.rotation_mode = "XYZ"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    rest_q = {pb.name: pb.bone.matrix_local.to_quaternion() for pb in arm.pose.bones}
    spec.setdefault("height_m", max(v.co.z for o in meshes for v in o.data.vertices))
    motions = b04_motions.build_all(spec)
    report = {"problems": problems, "motions": {}, "morphs": {o.name: [k.name for k in o.data.shape_keys.key_blocks[1:]]
                                                            for o in meshes if o.data.shape_keys}}
    for name, m in motions.items():
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data_create()
        arm.animation_data.action = act
        n = int(round(m["duration"] * 30))
        for fr in range(n + 1 if not m["loop"] else n):
            pose = m["fn"](fr / 30.0)
            for pb in arm.pose.bones:
                pb.location = (0, 0, 0)
                pb.rotation_quaternion = (1, 0, 0, 0)
                pb.scale = (1, 1, 1)
            for bone, p in pose.items():
                pb = arm.pose.bones.get(bone)
                if pb is None:
                    continue
                rx, ry, rz = (math.radians(a) for a in p.get("rot", (0, 0, 0)))
                qw = Quaternion((0, 0, 1), rz) @ Quaternion((0, 1, 0), ry) @ Quaternion((1, 0, 0), rx)
                R = rest_q[bone]
                pb.rotation_quaternion = R.inverted() @ qw @ R
                if "loc" in p:
                    pb.location = R.inverted() @ Vector(p["loc"])
                if "scale" in p:
                    loc = R.inverted() @ Vector(p["scale"])
                    pb.scale = (abs(loc.x), abs(loc.y), abs(loc.z))
            for pb in arm.pose.bones:
                pb.keyframe_insert("location", frame=fr)
                pb.keyframe_insert("rotation_quaternion", frame=fr)
                pb.keyframe_insert("scale", frame=fr)
        sc.frame_start, sc.frame_end = 0, (n - 1 if m["loop"] else n)
        bpy.ops.object.mode_set(mode="OBJECT")
        export(os.path.join(out, "motions", name + ".glb"), [arm], True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="POSE")
        report["motions"][name] = {"frames": n, "loop": m["loop"], "seconds": m["duration"]}
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "rig.blend"))
    with open(os.path.join(out, "rig_report.json"), "w", encoding="utf-8") as fp:
        json.dump(report, fp, ensure_ascii=False, indent=1)
    print("B07", json.dumps(report, ensure_ascii=False)[:600])


main()
