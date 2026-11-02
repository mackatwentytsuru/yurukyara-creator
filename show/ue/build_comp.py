"""合成の素材を撮るためのレベルとシーケンスを作る。

3 つのレベル(/Game/Show の新しいステージとキャラだけ):
  L_Comp       ステージとキャラ。LED だけが光る。実写の代わりと、キャラの色を撮る
  L_CompMatte  真っ黒の中のキャラと目印。透明の出し方と、足の位置の測定に使う
  L_CompShadow 灰色の床と、LED の位置の面光源。床の影を比で取り出す

-run=pythonscript -script=このファイル で動かす。設定は環境変数 COMP_CONFIG の JSON。
"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

import build_level  # noqa: E402
from build_level import StageBuilder  # noqa: E402
from build_materials import scalar  # noqa: E402
from build_sequences import add_camera_cut, reset_sequence, smooth  # noqa: E402
from comp_keys import key_camera, make_camera  # noqa: E402
from sim_layout import FPS, LEAD_FRAMES, MEDIA_LATENCY_FRAMES  # noqa: E402
from sim_parts import (MATERIAL_DIR, add_glow_keys, build_file_source, build_level_for_sim,  # noqa: E402
                       build_render_config, describe, load_required, open_sim_level, outside_show_dependencies,
                       set_floor)
from ue_helpers import (MEDIA_DIR, MOTION_CHARACTER_DIR, SEQUENCE_DIR, SHOW_ROOT, assets, get_or_create, save,  # noqa: E402
                        vec, write_report)

REPORT_PATH = "work/ue_show/logs/build_comp_report.txt"
L_COMP, L_MATTE, L_SHADOW = (f"{SHOW_ROOT}/{n}" for n in ("L_Comp", "L_CompMatte", "L_CompShadow"))
UNDER_Z = -3000.0
FILL_CANDELA = 900.0
SHADOW_LIGHT_CANDELA = 400.0
MATTE_EMISSIVE = 50.0
MARKER_DIAMETER_CM = 12.0
STAGE_Z = 90.0
mel = unreal.MaterialEditingLibrary


def character_assets():
    path = f"{MOTION_CHARACTER_DIR}/f_led_motion/SkeletalMeshes"
    return load_required(f"{path}/f_led_motion"), load_required(f"{path}/f_led_motionwave")


def place_character(builder, config, report):
    mesh, _ = character_assets()
    face = load_required(f"{MATERIAL_DIR}/M_FaceCell")
    return build_level.place_character(builder, [mesh], face, report)[0]


def add_fill(builder, character):
    """キャラだけに当たる正面の弱い明かり。LED を背にすると真っ暗に見えるため。"""
    channels = unreal.LightingChannels(True, True, False)
    character.skeletal_mesh_component.set_editor_property("lighting_channels", channels)
    light = builder.actors.spawn_actor_from_class(unreal.SpotLight, vec(0, 900, 500),
                                                  unreal.MathLibrary.make_rot_from_x(vec(0, -720, -340).normal()))
    light.set_actor_label("CharacterFill")
    comp = light.spot_light_component
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    comp.set_editor_property("intensity", FILL_CANDELA)
    comp.set_editor_property("outer_cone_angle", 25.0)
    comp.set_editor_property("attenuation_radius", 2000.0)
    comp.set_editor_property("cast_shadows", False)
    comp.set_editor_property("lighting_channels", unreal.LightingChannels(False, True, False))
    comp.set_editor_property("volumetric_scattering_intensity", 0.0)


def build_comp_level(config, report):
    glow = {"glow_candela": config["glow_candela"], "glow_color": config["glow_color"],
            "stage_roughness": 0.08, "hall_roughness": 0.2}
    _, glows = build_level_for_sim(glow, report, L_COMP)
    builder = StageBuilder(load_required(f"{MATERIAL_DIR}/M_Surface"))
    character = place_character(builder, config, report)
    add_fill(builder, character)
    return character, glows


def matte_material():
    material, _ = get_or_create("M_CompMatte", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    mel.delete_all_material_expressions(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("used_with_skeletal_mesh", True)
    glow = scalar(material, "Glow", MATTE_EMISSIVE, -300, 0)
    if not mel.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
        raise RuntimeError("目印の材質をつなげない")
    mel.recompile_material(material)
    save(material)
    return material


def clear_and_open(level):
    levels = open_sim_level(level)
    builder = StageBuilder(load_required(f"{MATERIAL_DIR}/M_Surface"))
    build_level.clear_level(builder.actors)
    return levels, builder


def fixed_exposure_only(builder):
    build_level.build_atmosphere(builder)
    for actor in builder.actors.get_all_level_actors():
        if isinstance(actor, unreal.ExponentialHeightFog):
            builder.actors.destroy_actor(actor)
        elif isinstance(actor, unreal.PostProcessVolume):
            # 透明と影の比は値そのものを使うので、光のにじみを切る(にじむと透明が周りへ広がる)
            settings = actor.settings
            settings.set_editor_property("bloom_intensity", 0.0)
            actor.set_editor_property("settings", settings)


def build_matte_level(config, report):
    levels, builder = clear_and_open(L_MATTE)
    fixed_exposure_only(builder)
    matte = matte_material()
    character = place_character(builder, config, report)
    component = character.skeletal_mesh_component
    for index in range(component.get_num_materials()):
        component.set_material(index, matte)
    sphere = unreal.load_asset("/Engine/BasicShapes/Sphere")
    markers = []
    for i, (x, y) in enumerate(config["markers_xy"]):
        marker = builder.actors.spawn_actor_from_class(unreal.StaticMeshActor,
                                                       vec(x, y, STAGE_Z + MARKER_DIAMETER_CM / 2.0))
        marker.set_actor_label(f"Marker{i}")
        marker.set_mobility(unreal.ComponentMobility.MOVABLE)
        marker.set_actor_scale3d(vec(*[MARKER_DIAMETER_CM / 100.0] * 3))
        marker.static_mesh_component.set_static_mesh(sphere)
        marker.static_mesh_component.set_material(0, matte)
        markers.append(marker)
    return levels, character, markers


def build_shadow_level(config, report):
    levels, builder = clear_and_open(L_SHADOW)
    fixed_exposure_only(builder)
    build_level.build_hall(builder)
    for label in ("Hall_Ceiling", "Hall_Wall_Back", "Hall_Wall_Front", "Hall_Wall_Left", "Hall_Wall_Right"):
        for actor in builder.actors.get_all_level_actors():
            if actor.get_actor_label() == label:
                builder.actors.destroy_actor(actor)
    set_floor(builder, "Stage_Floor", "ShadowCatcher", (0.5, 0.5, 0.5), 0.9)
    character = place_character(builder, config, report)
    light = builder.actors.spawn_actor_from_class(unreal.RectLight, vec(0, -20, 346), unreal.Rotator(0, 0, 90.0))
    light.set_actor_label("LedAsLight")
    comp = light.rect_light_component
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    comp.set_editor_property("intensity", SHADOW_LIGHT_CANDELA)
    comp.set_editor_property("source_width", 1400.0)
    comp.set_editor_property("source_height", 496.0)
    comp.set_editor_property("attenuation_radius", 2500.0)
    comp.set_editor_property("cast_shadows", True)
    return levels, character


def new_sequence(name, count):
    sequence, _ = get_or_create(name, SEQUENCE_DIR, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    reset_sequence(sequence)
    sequence.set_display_rate(unreal.FrameRate(FPS, 1))
    sequence.set_tick_resolution(unreal.FrameRate(24000, 1))
    sequence.set_playback_start(LEAD_FRAMES)
    sequence.set_playback_end(LEAD_FRAMES + count)
    return sequence


def add_media(sequence, name, path, show_start, count):
    section = sequence.add_track(unreal.MovieSceneMediaTrack).add_section()
    section.set_range(LEAD_FRAMES - MEDIA_LATENCY_FRAMES - int(round(show_start * FPS)), LEAD_FRAMES + count)
    section.set_editor_property("media_source", build_file_source(f"comp_{name}", path))
    section.set_editor_property("media_texture", load_required(f"{MEDIA_DIR}/MT_LED"))
    section.set_editor_property("looping", False)


def set_transform_defaults(actor, binding, count, location):
    section = binding.add_track(unreal.MovieScene3DTransformTrack).add_section()
    section.set_range(0, LEAD_FRAMES + count)
    channels = section.get_all_channels()
    rotation, scale = actor.get_actor_rotation(), actor.get_actor_scale3d()
    values = [*location, rotation.roll, rotation.pitch, rotation.yaw, scale.x, scale.y, scale.z]
    for channel, value in zip(channels, values):
        channel.set_default(float(value))
    return channels


def add_character(sequence, character, count, state, config, moves=True):
    """state: floor(舞台に立つ)、under(床下)、emerge(LED の奥から舞台へ出てくる)。"""
    at = character.get_actor_location()
    binding = sequence.add_possessable(character)
    place = (at.x, at.y, UNDER_Z if state == "under" else at.z)
    channels = set_transform_defaults(character, binding, count, place)
    if state == "emerge":
        start, end = (float(v) * FPS for v in config["emerge_sec"])
        behind = float(config["emerge_from_y"])
        for frame in range(count + 1):
            y = behind + (at.y - behind) * smooth((frame - start) / (end - start))
            channels[1].add_key(unreal.FrameNumber(LEAD_FRAMES + frame), float(y))
    if moves:
        section = binding.add_track(unreal.MovieSceneSkeletalAnimationTrack).add_section()
        section.set_range(0, LEAD_FRAMES + count)
        params = section.get_editor_property("params")
        params.set_editor_property("animation", character_assets()[1])
        section.set_editor_property("params", params)


def shifted_keys(keys, show_start, count):
    """全編の秒のキーを、シーケンスの秒に直す。"""
    return [[t - show_start, v] for t, v in keys if -1.0 <= t - show_start <= count / FPS + 1.0]


def comp_passes(config, truth_rows, track_rows, sensor, character, glows, report):
    show_start = config["show_start"]
    count = len(track_rows)
    track_cam = make_camera("Track_Cam", track_rows, sensor)
    passes = []
    if truth_rows:
        truth_cam = make_camera("Truth_Cam", truth_rows, sensor)
        passes += [("Comp_PlateWith", truth_cam, truth_rows, "with", "under"),
                   ("Comp_PlateWithout", truth_cam, truth_rows, "without", "under")]
    passes += [("Comp_UeEmerge", track_cam, track_rows, "fade", "emerge"),
              ("Comp_BeautyWith", track_cam, track_rows, "without", "floor"),
              ("Comp_BeautyWithout", track_cam, track_rows, "without", "under")]
    for name, camera, rows, media, state in passes:
        sequence = new_sequence(name, count)
        add_media(sequence, media, config["media"][media], show_start, count)
        binding = add_camera_cut(sequence, camera, LEAD_FRAMES + count)
        key_camera(sequence, binding, camera, rows)
        add_character(sequence, character, count, state, config)
        add_glow_keys(sequence, glows, shifted_keys(config["glow_keys"][media], show_start, count), count)
        save(sequence)
        report.append(describe(sequence))


def plain_pass(name, track_rows, sensor, actors_state, config, report, camera):
    count = len(track_rows)
    sequence = new_sequence(name, count)
    binding = add_camera_cut(sequence, camera, LEAD_FRAMES + count)
    key_camera(sequence, binding, camera, track_rows)
    for character, state in actors_state["characters"]:
        add_character(sequence, character, count, state, config)
    for marker, down in actors_state.get("markers", []):
        if down:
            at = marker.get_actor_location()
            set_transform_defaults(marker, sequence.add_possessable(marker), count, (at.x, at.y, UNDER_Z))
    save(sequence)
    report.append(describe(sequence))


def main():
    with open(os.environ["COMP_CONFIG"], encoding="utf-8") as f:
        config = json.load(f)
    with open(config["track"], encoding="utf-8") as f:
        track = json.load(f)
    truth = {"rows": None}
    if config.get("truth"):
        with open(config["truth"], encoding="utf-8") as f:
            truth = json.load(f)
    report = [f"residuals {track['residuals']}", f"gaps {track['tracking_gaps_sec']}"]
    sensor = (track["sensor_w_mm"], track["sensor_h_mm"])
    truth_rows = truth["rows"]
    rows = track["rows"][:len(truth_rows)] if truth_rows else track["rows"]
    truth_rows = truth_rows[:len(rows)] if truth_rows else None
    levels_sub = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

    character, glows = build_comp_level(config, report)
    comp_passes(config, truth_rows, rows, sensor, character, glows, report)
    if not levels_sub.save_current_level():
        raise RuntimeError("L_Comp を保存できない")

    levels, character, markers = build_matte_level(config, report)
    camera = make_camera("Track_Cam", rows, sensor)
    plain_pass("Comp_MatteChar", rows, sensor, {"characters": [(character, "floor")],
                                                "markers": [(m, True) for m in markers]}, config, report, camera)
    plain_pass("Comp_MatteMarks", rows, sensor, {"characters": [(character, "under")],
                                                 "markers": [(m, False) for m in markers]}, config, report, camera)
    roll_rows = [{**rows[0], "f": i, "roll": config["roll_test_deg"]} for i in range(config["roll_test_frames"])]
    roll_cam = make_camera("Roll_Cam", roll_rows, sensor)
    plain_pass("Comp_RollTest", roll_rows, sensor, {"characters": [(character, "under")],
                                                    "markers": [(m, False) for m in markers]}, config, report, roll_cam)
    if not levels.save_current_level():
        raise RuntimeError("L_CompMatte を保存できない")

    levels, character = build_shadow_level(config, report)
    camera = make_camera("Track_Cam", rows, sensor)
    plain_pass("Comp_ShadowWith", rows, sensor, {"characters": [(character, "floor")]}, config, report, camera)
    plain_pass("Comp_ShadowWithout", rows, sensor, {"characters": [(character, "under")]}, config, report, camera)
    if not levels.save_current_level():
        raise RuntimeError("L_CompShadow を保存できない")

    resolution = tuple(config.get("resolution", (1920, 1080)))
    build_render_config(config["frames_dir"], "Cfg_Comp", 4, resolution)
    build_render_config(config["frames_dir"], "Cfg_CompMatte", 16, resolution)
    for level in (L_COMP, L_MATTE, L_SHADOW):
        count, outside = outside_show_dependencies(level)
        report.append(f"{level} uses {count} packages under /Game; outside /Game/Show: {outside}")
        if outside:
            raise RuntimeError(f"新しいステージの外の資産を使っている: {outside}")
    report.append("BUILD_OK")
    write_report(REPORT_PATH, report)


try:
    main()
except Exception:
    write_report(REPORT_PATH, ["BUILD_FAILED", traceback.format_exc()])
    raise
