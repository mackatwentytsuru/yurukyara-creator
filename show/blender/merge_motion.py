"""キャラの形と動きを 1 本の GLB にまとめる(元のファイルは読むだけ)。

胴と顔を 1 つのメッシュ(骨は 1 組、材質は 2 つ)に合わせ、動きを NLA のトラックにして書き出す。
使い方:
  blender -b -t 4 --factory-startup -P merge_motion.py -- <model.glb> <出力.glb> <動き.glb> [動き.glb ...]
"""
import sys
from pathlib import Path

import bpy


MOTION_FPS = 30


def import_glb(path):
    """GLB を読み、増えた物を返す。"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path), bone_heuristic="TEMPERANCE")
    return [ob for ob in bpy.data.objects if ob not in before]


def rest_table(armature):
    return {b.name: (tuple(round(v, 4) for v in b.head_local), tuple(round(v, 4) for v in b.tail_local))
            for b in armature.data.bones}


def only_armature(objects):
    found = [ob for ob in objects if ob.type == "ARMATURE"]
    if len(found) != 1:
        raise RuntimeError(f"骨組みが 1 つではない: {[ob.name for ob in found]}")
    return found[0]


def join_meshes(meshes):
    if not meshes:
        raise RuntimeError("メッシュが無い")
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def take_motion(path, target):
    """動きの GLB を読み、形の骨と同じかを確かめて、動きのデータだけを取る。"""
    actions_before = set(bpy.data.actions)
    added = import_glb(path)
    source = only_armature(added)
    if rest_table(source) != rest_table(target):
        raise RuntimeError(f"骨が形と違う: {path}")
    new_actions = [a for a in bpy.data.actions if a not in actions_before]
    if len(new_actions) != 1:
        raise RuntimeError(f"動きが 1 つではない: {path} {[a.name for a in new_actions]}")
    action = new_actions[0]
    action.use_fake_user = True
    slot = source.animation_data.action_slot
    for ob in added:
        bpy.data.objects.remove(ob)
    action.name = Path(path).stem
    return action, slot


def add_to_nla(armature, action, slot, start):
    data = armature.animation_data or armature.animation_data_create()
    track = data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, int(start), action)
    strip.name = action.name
    strip.action_slot = armature_slot(action, slot)
    return strip


def armature_slot(action, slot):
    return slot if slot is not None else action.slots[0]


def export(path):
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    wanted = {
        "filepath": str(path),
        "export_format": "GLB",
        "export_animations": True,
        "export_animation_mode": "NLA_TRACKS",
        "export_skins": True,
        "export_morph": False,
        "export_vertex_color": "ACTIVE",
        "export_all_vertex_colors": True,
        "export_yup": True,
    }
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k == "filepath" or k in props})


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    model, out, motions = args[0], Path(args[1]), args[2:]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = MOTION_FPS  # 初期の 24 のままだと、書き出しで動きが短くなる
    added = import_glb(model)
    armature = only_armature(added)
    body = join_meshes([ob for ob in added if ob.type == "MESH"])
    print("JOINED", body.name, "materials", [m.name for m in body.data.materials],
          "uv", [u.name for u in body.data.uv_layers], "colors", [c.name for c in body.data.color_attributes])
    print("BONES", sorted(rest_table(armature)))
    if armature.animation_data:
        armature.animation_data.action = None
    for path in motions:
        action, slot = take_motion(path, armature)
        print("MOTION", action.name, "frames", tuple(action.frame_range), "slots", [s.name_display for s in action.slots])
        add_to_nla(armature, action, slot, action.frame_range[0])
    out.parent.mkdir(parents=True, exist_ok=True)
    export(out)
    print("EXPORTED", out)


main()
