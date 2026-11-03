"""リアルタイム用のレベル L_Live を作る。写しのプロジェクトの中だけで動かす。

-run=pythonscript -script=このファイル で動かす。L_Comp(ステージ)を複製し、キャラを LIVE_CHARACTER に置きかえ、カメラと遅れの印と光を足す。
"""
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, "..", "ue")]

import unreal  # noqa: E402

from ue_helpers import MATERIAL_DIR, SHOW_ROOT, assets, get_or_create, save, vec, write_report  # noqa: E402

SOURCE_LEVEL = f"{SHOW_ROOT}/L_Comp"
LIVE_LEVEL = f"{SHOW_ROOT}/L_Live"
REPORT_PATH = os.environ.get("LIVE_REPORT", "work/ue_show/live_logs/build_live_report.txt")
CHARACTER = os.environ["LIVE_CHARACTER"]  # import_motion_glb.py で入れた名前
GLOW_CANDELA = 6.0  # 床に落ちる光の一定の強さ(撮影の式の「60 cd × 輝度 0.1」)
mel = unreal.MaterialEditingLibrary


def marker_material():
    material, _ = get_or_create("M_LiveMarker", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    mel.delete_all_material_expressions(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    node = mel.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -300, 0)
    node.set_editor_property("parameter_name", "Code")
    node.set_editor_property("default_value", unreal.LinearColor(0, 0, 0, 1))
    if not mel.connect_material_property(node, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
        raise RuntimeError("印の材質をつなげない")
    mel.recompile_material(material)
    save(material)
    return material


def load_character_mesh():
    path = f"{SHOW_ROOT}/Character/{CHARACTER}/{CHARACTER}/SkeletalMeshes/{CHARACTER}"
    mesh = unreal.load_asset(path)
    if mesh is None:
        raise RuntimeError(f"キャラが無い: {path}")
    return mesh


def main():
    report = []
    if assets.does_asset_exist(LIVE_LEVEL):
        report.append("L_Live あり。作り直さず中身だけ直す")
    elif not assets.duplicate_asset(SOURCE_LEVEL, LIVE_LEVEL):
        raise RuntimeError("L_Comp を複製できない")
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not levels.load_level(LIVE_LEVEL):
        raise RuntimeError("L_Live を開けない")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in actors.get_all_level_actors():
        label = actor.get_actor_label()
        if label in ("Live_Cam", "Live_Marker"):
            actors.destroy_actor(actor)
        elif label.startswith("SimGlow"):
            actor.rect_light_component.set_editor_property("intensity", GLOW_CANDELA)
        elif label.startswith("Character_"):
            standing = (actor.get_actor_location(), actor.get_actor_rotation())
            actors.destroy_actor(actor)
    character = actors.spawn_actor_from_class(unreal.SkeletalMeshActor, *standing)
    character.skeletal_mesh_component.set_skinned_asset_and_update(load_character_mesh())
    character.set_actor_label(f"Character_{CHARACTER}")
    character.tags = [unreal.Name("LiveChar")]
    report.append(f"character {CHARACTER} at {standing[0]}")
    camera = actors.spawn_actor_from_class(unreal.CineCameraActor, vec(130, 1600, 150))
    camera.set_actor_label("Live_Cam")
    camera.tags = [unreal.Name("LiveCam")]
    component = camera.get_cine_camera_component()
    focus = component.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
    component.set_editor_property("focus_settings", focus)
    marker = actors.spawn_actor_from_class(unreal.StaticMeshActor, vec(130, 1600, 150))
    marker.set_actor_label("Live_Marker")
    marker.tags = [unreal.Name("LiveMarker")]
    marker.set_mobility(unreal.ComponentMobility.MOVABLE)
    mesh = marker.static_mesh_component
    mesh.set_static_mesh(unreal.load_asset("/Engine/BasicShapes/Cube"))
    mesh.set_material(0, marker_material())
    mesh.set_editor_property("cast_shadow", False)
    mesh.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    if not levels.save_current_level():
        raise RuntimeError("L_Live を保存できない")
    report.append("actors " + ", ".join(sorted(a.get_actor_label() for a in actors.get_all_level_actors())[:80]))
    report.append("BUILD_OK")
    write_report(REPORT_PATH, report)


try:
    main()
except Exception:
    write_report(REPORT_PATH, ["BUILD_FAILED", traceback.format_exc()])
    raise
