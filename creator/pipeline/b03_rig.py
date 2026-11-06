"""段 7: メッシュに骨・重み・顔の面を入れて、model.glb と動きの GLB を書き出す(Blender の背景モード)。

使い方:
  blender -b -P b03_rig.py -- <rig_spec.json> <手組みの形.blend> <色の絵.png> <顔の表フォルダ> <出力フォルダ>

rig_spec.json(キャラごとに 1 つ。位置は、メッシュの外接箱に対する割合 0〜1 で書く):
  {
    "id": "f_led", "height_m": 0.9,
    "bones": [ {"name": "root", "at": [0.5, 0.5, 0.0], "parent": null}, … ],   # 全部「上向きの短い棒」(回転の軸は世界と同じ向き)
    "base_bone": "body",
    "rules": [ {"bone": "arm_L", "x": [0.82, null], "blend": 0.04}, … ],  # 箱で区切った重み(null は無制限)
    "face": {"center": [0.5, 0.55], "size": [0.62, 0.38], "grid": [32, 20], "lift": 0.003, "bone": "body"},
    "roles": {"body": "body", "arm_L": "arm_L", …}                        # 動きの定義が使う役割と骨の対応
  }
- 骨は全部、まっすぐ上を向ける。回転は「世界の軸まわり」で書ける(前に倒す = 正の x まわり)。
- 重みは、骨の位置ではなく箱の区切りで決める(滑らかに混ぜる)。胴の角が腕に引かれて崩れない。
- 顔の面: 体の表面に格子の面を貼り付ける(正面から光線を当てて、表面に 3mm 浮かせる)。UV は 0〜1。
出力: model.glb、motions/<名前>.glb、rig.blend、rig_report.json
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b04_motions  # noqa: E402


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def soft_box(v, lo, hi, blend):
    """lo〜hi の中なら 1、外へ blend かけて 0 に落ちる。None は無制限。"""
    t = 1.0
    if lo is not None:
        t *= smooth((v - (lo - blend / 2)) / blend)
    if hi is not None:
        t *= smooth(((hi + blend / 2) - v) / blend)
    return t


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    spec_path, obj_path, tex_path, face_dir, out = argv[:5]
    spec = json.load(open(spec_path, encoding="utf-8"))
    os.makedirs(os.path.join(out, "motions"), exist_ok=True)
    sc = bpy.context.scene
    if obj_path.endswith(".blend"):
        # 手組みの形(m00_prims で作った部品の集まり)。部品を 1 つにまとめる(材質は部品ごとに残る)
        bpy.ops.wm.open_mainfile(filepath=obj_path)
        sc = bpy.context.scene
        parts = [o for o in sc.objects if o.type == "MESH"]
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        if len(parts) > 1:
            bpy.ops.object.join()
        body = bpy.context.view_layer.objects.active
        built = True
    else:
        raise SystemExit("手組みの .blend だけを受けます(m00_prims で組んだ builder の出力)")
    sc.render.fps = 30
    body.name = "Body"
    # 読み込みは物の向きを 180° 回して入れる。重みも顔の面も絵のとおりの座標で測るので、物の回転は 0 に戻す
    # (これを戻さないと、Blender の中の変形が骨とずれて、腕が細長く伸びる)
    body.rotation_euler = (0, 0, 0)
    body.scale = (1, 1, 1)
    body.location = (0, 0, 0)
    bpy.context.view_layer.update()
    # 高さをキャラの実寸にそろえる
    vs = [v.co.copy() for v in body.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    k = spec["height_m"] / (mx.z - mn.z)
    for v in body.data.vertices:
        v.co = (v.co - Vector((0.5 * (mn.x + mx.x), 0.5 * (mn.y + mx.y), mn.z))) * k
    body.data.update()
    vs = [v.co.copy() for v in body.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    size = mx - mn

    def frac(p):
        return Vector((mn.x + p[0] * size.x, mn.y + p[1] * size.y, mn.z + p[2] * size.z))

    # --- 材質(色の絵) ---
    if not built:
        mat = bpy.data.materials.new("BodyMat")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(tex_path)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.7)
        body.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth()

    # --- 骨 ---
    arm_data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", arm_data)
    sc.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    blen = spec.get("bone_len", 0.06) * spec["height_m"]
    for b in spec["bones"]:
        eb = arm_data.edit_bones.new(b["name"])
        eb.head = frac(b["at"])
        eb.tail = eb.head + Vector((0, 0, blen))
        eb.roll = 0
    for b in spec["bones"]:
        if b.get("parent"):
            arm_data.edit_bones[b["name"]].parent = arm_data.edit_bones[b["parent"]]
    bpy.ops.object.mode_set(mode="OBJECT")

    # --- 重み ---
    for b in spec["bones"]:
        body.vertex_groups.new(name=b["name"])
    stats = {}
    for v in body.data.vertices:
        p = v.co
        rem, ws = 1.0, {}
        for r in spec["rules"]:
            t = 1.0
            for ax, i in (("x", 0), ("y", 1), ("z", 2)):
                if ax in r:
                    lo, hi = r[ax]
                    lo = None if lo is None else mn[i] + lo * size[i]
                    hi = None if hi is None else mn[i] + hi * size[i]
                    t *= soft_box(p[i], lo, hi, r.get("blend", 0.04) * size[i])
            w = t * rem
            if w > 1e-4:
                ws[r["bone"]] = w
                rem -= w
        ws[spec["base_bone"]] = ws.get(spec["base_bone"], 0) + rem
        for name, w in ws.items():
            body.vertex_groups[name].add([v.index], w, "REPLACE")
        top = max(ws, key=ws.get)
        stats[top] = stats.get(top, 0) + 1
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm

    # --- 顔の面 ---
    face_obj = None
    if spec.get("face"):
        f = spec["face"]
        bm0 = bmesh.new()
        bm0.from_mesh(body.data)
        bm0.faces.ensure_lookup_table()
        tree = BVHTree.FromBMesh(bm0)
        gx, gz = f["grid"]
        verts, faces, uvs, miss = [], [], [], 0
        cx = mn.x + f["center"][0] * size.x
        cz = mn.z + f["center"][1] * size.z
        w, h = f["size"][0] * size.x, f["size"][1] * size.z
        ys, nrm = {}, {}
        missed = set()
        for j in range(gz + 1):
            for i in range(gx + 1):
                x = cx + (i / gx - 0.5) * w
                z = cz + (0.5 - j / gz) * h
                hit = tree.ray_cast(Vector((x, mn.y - 1.0, z)), Vector((0, 1, 0)))
                if hit[0] is None:
                    miss += 1
                    missed.add((i, j))
                    ys[i, j] = None
                else:
                    ys[i, j] = hit[0].y
                    if abs(hit[1].y) < f.get("min_facing", 0.55):   # 面の向きが正面からそれすぎ(丸い縁)
                        missed.add((i, j))
                uvs.append((i / gx, 1 - j / gz))
        # 光線が体に当たらなかった点(丸い角の外)は、いちばん近い当たった点の奥行きにそろえる
        # (体の最前面に置くと、角が空中に浮いて、横から見ると飛び出して見える)
        if miss:
            hits = [(i, j) for (i, j), y in ys.items() if y is not None]
            for (i, j), y in list(ys.items()):
                if y is None:
                    bi, bj = min(hits, key=lambda q: (q[0] - i) ** 2 + (q[1] - j) ** 2)
                    ys[i, j] = ys[bi, bj]
        # 表面の細かい凹凸(提灯の骨など)を拾わないよう、奥行きをなめらかにならして浮かせる
        for _ in range(f.get("smooth_iter", 0)):
            ys = {(i, j): sum(ys[min(max(i + di, 0), gx), min(max(j + dj, 0), gz)]
                              for di in (-1, 0, 1) for dj in (-1, 0, 1)) / 9.0
                  for i in range(gx + 1) for j in range(gz + 1)}
        for j in range(gz + 1):
            for i in range(gx + 1):
                x = cx + (i / gx - 0.5) * w
                z = cz + (0.5 - j / gz) * h
                verts.append(Vector((x, ys[i, j] - f.get("lift", 0.003), z)))
        for j in range(gz):
            for i in range(gx):
                if {(i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)} & missed:
                    continue   # 体に当たらない角(空中)の四角は作らない
                a = j * (gx + 1) + i
                faces.append((a, a + 1, a + gx + 2, a + gx + 1))
        me = bpy.data.meshes.new("FaceMesh")
        me.from_pydata([tuple(v) for v in verts], [], faces)
        me.update()
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uvs[me.loops[li].vertex_index]
        face_obj = bpy.data.objects.new("Face", me)
        face_obj.visible_shadow = False   # 貼った面は影を落とさない(影の解像度の粗い四角いにじみが出る)
        sc.collection.objects.link(face_obj)
        fmat = bpy.data.materials.new("FaceMat")
        fmat.use_nodes = True
        fn = fmat.node_tree
        fb = next(n for n in fn.nodes if n.type == "BSDF_PRINCIPLED")
        ft = fn.nodes.new("ShaderNodeTexImage")
        ft.image = bpy.data.images.load(os.path.join(face_dir, "face_atlas.png"))
        ft.extension = "EXTEND"   # 表の端で反対側の絵を拾わない(角に別の行のにじみが出る)
        if f.get("mode") == "paint":
            # 紙に描いた顔: 色と透明さをそのまま使う(光らせない)
            fn.links.new(ft.outputs["Color"], fb.inputs["Base Color"])
            fn.links.new(ft.outputs["Alpha"], fb.inputs["Alpha"])
            fb.inputs["Roughness"].default_value = 0.9
            try:
                fmat.surface_render_method = "BLENDED"
            except Exception:
                fmat.blend_method = "BLEND"
        else:
            fn.links.new(ft.outputs["Color"], fb.inputs["Emission Color"])
            fb.inputs["Emission Strength"].default_value = f.get("emission", 1.0)
            fb.inputs["Base Color"].default_value = (0, 0, 0, 1)
            fb.inputs["Roughness"].default_value = 0.4
            if f.get("alpha"):
                # 縁をなめらかに消す(横から見ても、貼った板に見えない)
                fn.links.new(ft.outputs["Alpha"], fb.inputs["Alpha"])
                try:
                    fmat.surface_render_method = "BLENDED"
                except Exception:
                    fmat.blend_method = "BLEND"
        face_obj.data.materials.append(fmat)
        vg = face_obj.vertex_groups.new(name=f.get("bone", spec["base_bone"]))
        vg.add(list(range(len(verts))), 1.0, "REPLACE")
        face_obj.parent = arm
        m2 = face_obj.modifiers.new("Armature", "ARMATURE")
        m2.object = arm
        bm0.free()
        stats["_face_ray_miss"] = miss

    # --- model.glb ---
    def export(path, objs, anim):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        kw = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                  export_apply=False)
        if anim:
            kw.update(export_animations=True, export_animation_mode="ACTIVE_ACTIONS", export_force_sampling=True,
                      export_frame_range=True, export_optimize_animation_size=False)
        else:
            kw.update(export_animations=False)
        bpy.ops.export_scene.gltf(**kw)

    objs = [arm, body] + ([face_obj] if face_obj else [])
    export(os.path.join(out, "model.glb"), objs, False)

    # --- 動き ---
    arm.rotation_mode = "XYZ"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    rest_q = {pb.name: pb.bone.matrix_local.to_quaternion() for pb in arm.pose.bones}
    motions = b04_motions.build_all(spec)
    report = {"weights_top_bone_counts": stats, "bbox_m": [list(mn), list(mx)], "motions": {}}
    for name, m in motions.items():
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data_create()
        arm.animation_data.action = act
        n = int(round(m["duration"] * 30))
        for fr in range(n + 1 if not m["loop"] else n):
            t = fr / 30.0
            pose = m["fn"](t)
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
                    s = p["scale"]
                    # 世界の軸の拡大率を、骨の局所の軸へ(骨は上向きなので y ↔ z が入れ替わる)
                    loc = (R.inverted() @ Vector(s))
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
    print("B03", json.dumps(report, ensure_ascii=False)[:800])


main()
