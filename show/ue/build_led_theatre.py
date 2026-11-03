"""LED に流す絵を UE で描くためのレベルとシーケンスを組む。-run=pythonscript -script=このファイル で動かす。

設定は環境変数 LED_CONFIG の JSON(render_led_ue.py が作る)。作る物は全部 /Game/Show/LedTheatre の下と、
/Game/Show/Materials の名前が LT_ で始まる材質だけ。既存のレベルは開かず、保存しない。
  L_LedTheatre  会場、キャラ、照明、霞、粒、左右のスクリーン
  L_LedMatte    真っ黒の中のキャラだけ。位置と大きさの測定用
"""
import json
import math
import os
import sys
import traceback
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

import led_plan  # noqa: E402
from build_level import StageBuilder, clear_level, to_color  # noqa: E402
from build_materials import scalar  # noqa: E402
from build_sequences import add_camera_cut, reset_sequence  # noqa: E402
from character_materials import character_slots  # noqa: E402
from led_venue import build_venue  # noqa: E402
from ue_helpers import MATERIAL_DIR, RENDER_CONFIG_DIR, SHOW_ROOT, assets, get_or_create, save, vec, write_report  # noqa: E402

ROOT = f"{SHOW_ROOT}/LedTheatre"
L_MAIN, L_MATTE = f"{ROOT}/L_LedTheatre", f"{ROOT}/L_LedMatte"
REPORT_PATH = "work/ue_show/logs/build_led_report.txt"
TICKS = 24000
UNDER_Z = -3000.0
STUDIO_X = -30000.0  # 顔のアップを撮る物は、カメラの視野から遠い所に置く
TEAL, PINK = (0.04, 0.85, 0.78), (1.0, 0.10, 0.45)
BEAM_CANDELA = 1100.0
HOUSE_CANDELA = 160.0
FLASH_CANDELA = 2500.0
FOG_DENSITY = 0.02
SCREEN_RT_SCALE = 1  # スクリーンの絵の大きさ = monitor_rects × これ
FLASH_PLANE_PX = 6400.0  # 光の板の 1 辺(正方形の画素)
FIRE_SEC = 3.0
FIRE_PLACES = {"center": [(0.0, 120.0, 40.0)], "sides": [(-430.0, -200.0, 60.0), (430.0, -200.0, 60.0)]}
WARMUP = 45
FPS_FOR_TICKS = 60  # main で config の fps に置き換える
mel = unreal.MaterialEditingLibrary


def load_required(path):
    asset = unreal.load_asset(path)
    if asset is None:
        raise RuntimeError(f"資産が無い: {path}")
    return asset


def open_level(path):
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    done = levels.load_level(path) if assets.does_asset_exist(path) else levels.new_level(path)
    if not done:
        raise RuntimeError(f"レベルを開けない: {path}")
    return levels


def clear_graph(material):
    mel.delete_all_material_expressions(material)


def character_assets(name):
    folder = f"{SHOW_ROOT}/Character/{name}/{name}/SkeletalMeshes"
    return load_required(f"{folder}/{name}"), load_required(f"{folder}/{name}_Anim")


def custom_node(material, code, names, output, x, y):
    node = mel.create_material_expression(material, unreal.MaterialExpressionCustom, x, y)
    node.set_editor_property("code", code)
    node.set_editor_property("output_type", output)
    inputs = []
    for name in names:
        entry = unreal.CustomInput()
        entry.set_editor_property("input_name", name)
        inputs.append(entry)
    node.set_editor_property("inputs", inputs)
    return node


def attach(material, source, node, pin):
    if not mel.connect_material_expressions(source, "", node, pin):
        raise RuntimeError(f"つなげない: {pin}")


FLASH_HLSL = """
float2 p = (UV - 0.5) * PlanePx;
float r = length(p);
float e = (r - Radius) / max(Width, 1.0);
float wave = exp(-e * e) * RingGain;
float pillar = exp(-(p.x / 170.0) * (p.x / 170.0)) * smoothstep(900.0, 0.0, p.y) * step(p.y, 0.0) * PillarGain;
float core = exp(-(r / 300.0) * (r / 300.0)) * CoreGain;
return Tint * wave + float3(0.7, 1.0, 0.97) * pillar + float3(1.0, 0.8, 0.92) * core;
"""

SCREEN_HLSL = """
float3 c = Map * (0.94 + 0.06 * sin(UV.y * 1012.0));
c += float3(0.35, 0.8, 0.8) * Flash;
float d = min(min(UV.x, 1.0 - UV.x) * 900.0, min(UV.y, 1.0 - UV.y) * 506.0);
return lerp(float3(0.75, 1.2, 1.17), c, smoothstep(0.0, 5.0, d));
"""


def flash_material():
    """足元から広がる輪と光の柱。絵に足す。深さを見ないので床やキャラの前に出る。"""
    material, _ = get_or_create("M_LT_Flash", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    clear_graph(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    material.set_editor_property("disable_depth_test", True)
    material.set_editor_property("two_sided", True)
    names = ["UV", "PlanePx", "Radius", "Width", "RingGain", "PillarGain", "CoreGain", "Tint"]
    node = custom_node(material, FLASH_HLSL, names, unreal.CustomMaterialOutputType.CMOT_FLOAT3, -300, 0)
    attach(material, mel.create_material_expression(material, unreal.MaterialExpressionTextureCoordinate, -900, 0), node, "UV")
    attach(material, scalar(material, "PlanePx", FLASH_PLANE_PX, -900, 100), node, "PlanePx")
    for i, (name, default) in enumerate((("Radius", 0.0), ("Width", 30.0), ("RingGain", 0.0), ("PillarGain", 0.0), ("CoreGain", 0.0))):
        attach(material, scalar(material, name, default, -900, 200 + i * 100), node, name)
    tint = mel.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -900, 800)
    tint.set_editor_property("parameter_name", "Tint")
    attach(material, tint, node, "Tint")
    if not mel.connect_material_property(node, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
        raise RuntimeError("光の材質をつなげない")
    mel.recompile_material(material)
    save(material)
    return material


def screen_material(default_target):
    """スクリーン: シーンキャプチャの絵。細い横の筋と縁はブラウザ版の MONITOR_FRAGMENT と同じ。"""
    material, _ = get_or_create("M_LT_Screen", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    clear_graph(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSampleParameter2D, -900, 0)
    sample.set_editor_property("parameter_name", "Map")
    sample.set_editor_property("texture", default_target)
    sample.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    node = custom_node(material, SCREEN_HLSL, ["UV", "Map", "Flash"], unreal.CustomMaterialOutputType.CMOT_FLOAT3, -300, 0)
    attach(material, mel.create_material_expression(material, unreal.MaterialExpressionTextureCoordinate, -900, 300), node, "UV")
    attach(material, sample, node, "Map")
    attach(material, scalar(material, "Flash", 0.0, -900, 400), node, "Flash")
    if not mel.connect_material_property(node, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
        raise RuntimeError("スクリーンの材質をつなげない")
    mel.recompile_material(material)
    save(material)
    return material


def material_instance(name, parent, vectors=None, texture=None):
    instance, _ = get_or_create(name, MATERIAL_DIR, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(instance, parent)
    for key, value in (vectors or {}).items():
        mel.set_material_instance_vector_parameter_value(instance, key, unreal.LinearColor(*value, 1.0))
    if texture is not None:
        mel.set_material_instance_texture_parameter_value(instance, "Map", texture)
    mel.update_material_instance(instance)
    save(instance)
    return instance


def render_target(name, width, height):
    target, _ = get_or_create(name, ROOT, unreal.TextureRenderTarget2D, unreal.TextureRenderTargetFactoryNew())
    target.set_editor_property("size_x", width)
    target.set_editor_property("size_y", height)
    target.set_editor_property("render_target_format", unreal.TextureRenderTargetFormat.RTF_RGBA16F)
    target.set_editor_property("clear_color", unreal.LinearColor(0, 0, 0, 1))
    save(target)
    return target


def place_camera(builder, cam):
    actor = builder.actors.spawn_actor_from_class(unreal.CineCameraActor, vec(*cam.position()), unreal.Rotator(0, 0, -90.0))
    actor.set_actor_label("LedCamera")
    comp = actor.get_cine_camera_component()
    filmback = unreal.CameraFilmbackSettings(cam.sensor_w, cam.sensor_h)
    filmback.set_editor_property("sensor_horizontal_offset", cam.offset_x_mm)
    filmback.set_editor_property("sensor_vertical_offset", cam.offset_y_mm)
    comp.set_editor_property("filmback", filmback)
    comp.set_editor_property("current_focal_length", cam.focal_mm)
    focus = comp.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
    comp.set_editor_property("focus_settings", focus)
    return actor


def place_character(builder, mesh, label, location, materials=None):
    actor = builder.actors.spawn_actor_from_class(unreal.SkeletalMeshActor, vec(*location), unreal.Rotator(0, 0, 0))
    actor.set_actor_label(label)
    comp = actor.skeletal_mesh_component
    comp.set_skinned_asset_and_update(mesh)
    comp.set_editor_property("visibility_based_anim_tick_option", unreal.VisibilityBasedAnimTickOption.ALWAYS_TICK_POSE_AND_REFRESH_BONES)
    comp.set_editor_property("bounds_scale", 2.0)
    for index, material in enumerate(materials or []):
        comp.set_material(index, material)
    return actor


def fixed_exposure(builder, bloom):
    volume = builder.actors.spawn_actor_from_class(unreal.PostProcessVolume, vec(0, 0, 300))
    volume.set_actor_label("FixedExposure")
    volume.set_editor_property("unbound", True)
    settings = volume.settings
    apply_exposure(settings, bloom)
    volume.set_editor_property("settings", settings)


def apply_exposure(settings, bloom):
    for key, value in (("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
                       ("auto_exposure_apply_physical_camera_exposure", False), ("auto_exposure_bias", 0.0),
                       ("bloom_intensity", bloom), ("vignette_intensity", 0.0), ("motion_blur_amount", 0.0)):
        settings.set_editor_property("override_" + key, True)
        settings.set_editor_property(key, value)


def build_haze(builder):
    fog = builder.actors.spawn_actor_from_class(unreal.ExponentialHeightFog, vec(0, 0, 0))
    fog.set_actor_label("Haze")
    comp = fog.component
    comp.set_editor_property("fog_density", FOG_DENSITY)
    comp.set_editor_property("fog_height_falloff", 0.02)
    comp.set_editor_property("fog_inscattering_luminance", unreal.LinearColor(0, 0, 0, 1))
    comp.set_editor_property("enable_volumetric_fog", True)
    comp.set_editor_property("volumetric_fog_albedo", unreal.Color(r=255, g=255, b=255, a=255))
    comp.set_editor_property("volumetric_fog_extinction_scale", 0.2)
    comp.set_editor_property("volumetric_fog_distance", 5000.0)
    return fog


def place_spot(builder, label, location, target, color, cone, shadow, scatter):
    direction = vec(target[0] - location[0], target[1] - location[1], target[2] - location[2]).normal()
    light = builder.actors.spawn_actor_from_class(unreal.SpotLight, vec(*location), unreal.MathLibrary.make_rot_from_x(direction))
    light.set_actor_label(label)
    comp = light.spot_light_component
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    comp.set_editor_property("intensity", 0.0)
    comp.set_editor_property("light_color", to_color(color))
    comp.set_editor_property("outer_cone_angle", cone)
    comp.set_editor_property("inner_cone_angle", cone * 0.6)
    comp.set_editor_property("attenuation_radius", 3500.0)
    comp.set_editor_property("cast_shadows", shadow)
    comp.set_editor_property("volumetric_scattering_intensity", scatter)
    return light


def build_lights(builder):
    """吊りのライト。青緑とピンクを左右対称に。キーで動かすのは強さだけ。"""
    teal, pink, house = [], [], []
    xs = (-1150.0, -760.0, -400.0, -140.0, 140.0, 400.0, 760.0, 1150.0)
    for i, x in enumerate(xs):
        color, group = (TEAL, teal) if i % 2 == 0 else (PINK, pink)
        tilt = -x * 0.25 + (-120.0 if i % 2 else 120.0)
        group.append(place_spot(builder, f"Beam{i}", (x, -140.0, 690.0), (x + tilt, -300.0, 0.0), color, 13.0, True, 30.0))
    for i, (x, y) in enumerate(((-900.0, 100.0), (0.0, 100.0), (900.0, 100.0), (-500.0, -700.0), (500.0, -700.0))):
        house.append(place_spot(builder, f"House{i}", (x, y, 680.0), (x, y - 300.0, 0.0), (1.0, 0.72, 0.5), 70.0, False, 0.0))
    return teal, pink, house


def build_flash_plane(builder, cam, material, label):
    size_cm = FLASH_PLANE_PX * cam.px_to_cm_at_foot()
    t, n = vec(1, 0, 0), vec(0, 1, 0)
    rotation = unreal.MathLibrary.make_rotation_from_axes(t, n.cross(t), n)
    return builder.shape(label, "Plane", (0.0, 40.0, 0.0), (size_cm / 100.0, size_cm / 100.0, 1.0), material, rotation, shadow=False)


def place_niagara(builder, label, location, system, scale):
    actor = builder.actors.spawn_actor_from_class(unreal.NiagaraActor, vec(*location))
    actor.set_actor_label(label)
    actor.set_actor_scale3d(vec(scale, scale, scale))
    comp = actor.niagara_component
    comp.set_asset(system)
    comp.set_editor_property("auto_activate", False)
    return actor


def build_screens(builder, cam, stage, venue):
    """左右のスクリーン。絵の上で monitor_rects にぴったり写る大きさを、カメラの式で決める。"""
    y = venue["screen_y"]
    parent, screens = None, []
    for i, (px, py, pw, ph) in enumerate(stage["monitor_rects"]):
        target = render_target(f"RT_LedScreen{i}", int(pw) * SCREEN_RT_SCALE, int(ph) * SCREEN_RT_SCALE)
        parent = parent or screen_material(target)
        instance = material_instance(f"MI_LT_Screen{i}", parent, texture=target)
        x0, z1 = cam.world_at(px, py, y)
        x1, z0 = cam.world_at(px + pw, py + ph, y)
        t, n = vec(1, 0, 0), vec(0, 1, 0)
        rotation = unreal.MathLibrary.make_rotation_from_axes(t, n.cross(t), n)
        center = ((x0 + x1) / 2.0, y, (z0 + z1) / 2.0)
        actor = builder.shape(f"Screen{i}", "Plane", center, ((x1 - x0) / 100.0, (z1 - z0) / 100.0, 1.0), instance, rotation, shadow=False)
        capture = builder.actors.spawn_actor_from_class(unreal.SceneCapture2D, vec(STUDIO_X, 200.0, 150.0), unreal.Rotator(0, 0, -90.0))
        capture.set_actor_label(f"ScreenCapture{i}")
        comp = capture.capture_component2d
        comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        comp.set_editor_property("texture_target", target)
        comp.set_editor_property("fov_angle", led_plan.horizontal_fov(pw / ph))
        comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_HDR)
        comp.set_editor_property("capture_every_frame", True)
        comp.set_editor_property("capture_on_movement", False)
        settings = comp.get_editor_property("post_process_settings")
        apply_exposure(settings, 0.0)
        comp.set_editor_property("post_process_settings", settings)
        comp.set_editor_property("post_process_blend_weight", 1.0)
        comp.set_editor_property("show_flag_settings", [
            unreal.EngineShowFlagsSetting(show_flag_name=name, enabled=False)
            for name in ("Fog", "VolumetricFog", "LumenGlobalIllumination", "LumenReflections", "Bloom")])
        screens.append({"actor": actor, "capture": capture, "scale": ((x1 - x0) / 100.0, (z1 - z0) / 100.0, 1.0), "center": center,
                        "rotation": rotation, "instance": instance})
    return screens


def build_studio(builder, mesh, materials):
    """顔のアップの撮影所。キャラの複製と、ぼんやりした背景。舞台のキャラが消えている間も撮れる。"""
    character = place_character(builder, mesh, "StudioCharacter", (STUDIO_X, 0.0, 0.0), materials)
    t, n = vec(1, 0, 0), vec(0, 1, 0)
    rotation = unreal.MathLibrary.make_rotation_from_axes(t, n.cross(t), n)
    glow = builder.surface("LT_StudioBack", (0, 0, 0), 0.9, glow=(0.012, 0.06, 0.075))
    builder.shape("StudioBack", "Plane", (STUDIO_X, -400.0, 150.0), (30.0, 12.0, 1.0), glow, rotation, shadow=False)
    return character


def new_sequence(name, total):
    sequence, _ = get_or_create(name, ROOT, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    reset_sequence(sequence)
    return sequence


def setup_range(sequence, fps, first, last):
    sequence.set_display_rate(unreal.FrameRate(fps, 1))
    sequence.set_tick_resolution(unreal.FrameRate(TICKS, 1))
    sequence.set_playback_start(first)
    sequence.set_playback_end(last)


def add_animation(sequence, binding, anim, total):
    section = binding.add_track(unreal.MovieSceneSkeletalAnimationTrack).add_section()
    section.set_range(0, total)
    params = section.get_editor_property("params")
    params.set_editor_property("animation", anim)
    section.set_editor_property("params", params)


def transform_channels(actor, binding, total, location=None, scale=None):
    section = binding.add_track(unreal.MovieScene3DTransformTrack).add_section()
    section.set_range(0, total)
    channels = section.get_all_channels()
    at = actor.get_actor_location()
    rotation = actor.get_actor_rotation()
    size = scale or actor.get_actor_scale3d()
    place = location or (at.x, at.y, at.z)
    sizes = (size[0], size[1], size[2]) if isinstance(size, tuple) else (size.x, size.y, size.z)
    for channel, value in zip(channels, (*place, rotation.roll, rotation.pitch, rotation.yaw, *sizes)):
        channel.set_default(float(value))
    return channels


def key_visibility(channels, changes):
    channels[2].set_default(UNDER_Z)
    for frame, shown in changes:
        channels[2].add_key(unreal.FrameNumber(frame), 0.0 if shown else UNDER_Z,
                            interpolation=unreal.MovieSceneKeyInterpolation.CONSTANT)


def key_intensity(sequence, actor, component, keys, peak, total, fps, prop="Intensity"):
    sequence.add_possessable(actor)
    binding = sequence.add_possessable(component)
    track = binding.add_track(unreal.MovieSceneFloatTrack)
    track.set_property_name_and_path(prop, prop)
    section = track.add_section()
    section.set_range(0, total)
    channel = section.get_all_channels()[0]
    channel.set_default(0.0)
    for t, value in keys:
        channel.add_key(unreal.FrameNumber(int(round(t * fps))), float(value * peak),
                        interpolation=unreal.MovieSceneKeyInterpolation.LINEAR)
    return channel


def add_scalar(section, name, frame, value):
    """材質のパラメータに 1 つキーを打つ。5.8 の材質トラックは名前でなく MaterialParameterInfo で受ける。
    時刻はコマではなく tick(チャンネルの add_key と違う)。コマのまま渡すと全部のキーが頭に固まる。"""
    info = unreal.MaterialParameterInfo()
    info.set_editor_property("name", name)
    section.add_scalar_parameter_key(info, unreal.FrameNumber(int(frame) * TICKS // FPS_FOR_TICKS), float(value), "", "",
                                     unreal.MovieSceneKeyInterpolation.LINEAR)


def key_flash(sequence, plane, rows, tint, total, light=None):
    binding = sequence.add_possessable(plane)
    comp_binding = sequence.add_possessable(plane.static_mesh_component)
    track = comp_binding.add_track(unreal.MovieSceneComponentMaterialTrack)
    track.set_material_index(0)
    section = track.add_section()
    section.set_range(0, total)
    for name, field in (("Radius", "radius"), ("Width", "width"), ("RingGain", "ring"), ("PillarGain", "pillar"), ("CoreGain", "core")):
        if not rows:
            add_scalar(section, name, 0, 0.0)
        for row in rows:
            add_scalar(section, name, row["frame"], float(row[field]))
    if light is not None and rows:
        key_intensity(sequence, light, light.point_light_component, [[r["frame"], r["light"]] for r in rows], FLASH_CANDELA, total, 1)
    return binding


def add_fire(sequence, actor, t, fps):
    sequence.add_possessable(actor)
    binding = sequence.add_possessable(actor.niagara_component)
    section = binding.add_track(unreal.MovieSceneNiagaraSystemTrack).add_section()
    first = int(round(t * fps))
    section.set_range(first, first + int(FIRE_SEC * fps))
    section.set_editor_property("section_start_behavior", unreal.NiagaraSystemSpawnSectionStartBehavior.ACTIVATE)
    section.set_editor_property("section_end_behavior", unreal.NiagaraSystemSpawnSectionEndBehavior.DEACTIVATE)
    section.set_editor_property("age_update_mode", unreal.NiagaraAgeUpdateMode.TICK_DELTA_TIME)


def head_positions(anim, rows, fps):
    options = unreal.AnimPoseEvaluationOptions()
    heads = {}
    for row in rows:
        pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(anim, row["frame"] / fps, options)
        at = unreal.AnimPoseExtensions.get_bone_pose(pose, "head", unreal.AnimPoseSpaces.WORLD).translation
        heads[row["frame"]] = (at.x, at.y, at.z)
    return heads


def key_screens(sequence, screens, rows, anim, total, fps):
    heads = head_positions(anim, rows, fps)
    for i, screen in enumerate(screens):
        side = 1.0 if i == 0 else -1.0
        binding = sequence.add_possessable(screen["actor"])
        center = screen["center"]
        channels = transform_channels(screen["actor"], binding, total, (center[0], center[1], UNDER_Z), screen["scale"])
        cap_binding = sequence.add_possessable(screen["capture"])
        cap_channels = transform_channels(screen["capture"], cap_binding, total)
        follow, previous = None, None
        for row in rows:
            frame = unreal.FrameNumber(row["frame"])
            if row["first"] or previous != row["frame"] - 1:
                channels[2].add_key(frame, center[2], interpolation=unreal.MovieSceneKeyInterpolation.CONSTANT)
                follow = heads[row["frame"]]
            channels[7].add_key(frame, max(screen["scale"][1] * row["open"], 0.001), interpolation=unreal.MovieSceneKeyInterpolation.LINEAR)
            head = heads[row["frame"]]
            follow = tuple(a + (b - a) * led_plan.FOLLOW for a, b in zip(follow, head))
            at, target = led_plan.close_camera(row["shot"], row["shot_age"], follow, side)
            place = (STUDIO_X + at[0], at[1], at[2])
            rot = unreal.MathLibrary.find_look_at_rotation(vec(*at), vec(*target))
            for channel, value in zip(cap_channels[:6], (*place, rot.roll, rot.pitch, rot.yaw)):
                channel.add_key(frame, float(value), interpolation=unreal.MovieSceneKeyInterpolation.LINEAR)
            previous = row["frame"]
            # 閉じたら隠す
            if row["frame"] + 1 not in heads:
                channels[2].add_key(unreal.FrameNumber(row["frame"] + 1), UNDER_Z, interpolation=unreal.MovieSceneKeyInterpolation.CONSTANT)
                channels[7].add_key(unreal.FrameNumber(row["frame"] + 1), 0.001, interpolation=unreal.MovieSceneKeyInterpolation.LINEAR)
    # スクリーンの開く光
    for screen in screens:
        comp_binding = sequence.add_possessable(screen["actor"].static_mesh_component)
        track = comp_binding.add_track(unreal.MovieSceneComponentMaterialTrack)
        track.set_material_index(0)
        section = track.add_section()
        section.set_range(0, total)
        for row in rows:
            add_scalar(section, "Flash", row["frame"], float(row["flash"]))


def build_main(config, cam, report):
    levels = open_level(L_MAIN)
    builder = StageBuilder(load_required(f"{MATERIAL_DIR}/M_Surface"))
    clear_level(builder.actors)
    builder.meshes["Sphere"] = unreal.load_asset("/Engine/BasicShapes/Sphere")
    fixed_exposure(builder, 0.35)
    fog = build_haze(builder)
    venue = build_venue(builder, config["venue"])
    mesh, anim = character_assets(config["character"])
    materials = character_slots(mesh)
    character = place_character(builder, mesh, "LedCharacter", (0.0, 0.0, 0.0), materials)
    camera = place_camera(builder, cam)
    teal, pink, house = build_lights(builder)
    flash_parent = flash_material()
    planes = {"out": build_flash_plane(builder, cam, material_instance("MI_LT_FlashOut", flash_parent, {"Tint": (0.25, 1.0, 0.92)}), "FlashOut"),
              "back": build_flash_plane(builder, cam, material_instance("MI_LT_FlashBack", flash_parent, {"Tint": (1.0, 0.3, 0.68)}), "FlashBack")}
    flash_lights = {}
    for kind, color in (("out", TEAL), ("back", PINK)):
        light = builder.actors.spawn_actor_from_class(unreal.PointLight, vec(0.0, 220.0, 150.0))
        light.set_actor_label(f"FlashLight_{kind}")
        comp = light.point_light_component
        comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
        comp.set_editor_property("intensity", 0.0)
        comp.set_editor_property("light_color", to_color(color))
        comp.set_editor_property("attenuation_radius", 3000.0)
        comp.set_editor_property("cast_shadows", False)
        flash_lights[kind] = light
    system = load_required(config["niagara_system"])
    screens = build_screens(builder, cam, config["stage"], venue)
    studio = build_studio(builder, mesh, materials)

    plan = config["plan"]
    fps, total = config["fps"], config["total_frames"]
    sequence = new_sequence("Seq_LedMain", total)
    setup_range(sequence, fps, plan["first_frame"], plan["last_frame"])
    add_camera_cut(sequence, camera, total)
    binding = sequence.add_possessable(character)
    key_visibility(transform_channels(character, binding, total), plan["visibility"])
    add_animation(sequence, binding, anim, total)
    add_animation(sequence, sequence.add_possessable(studio), anim, total)
    keys = plan["lights"]
    for light in teal:
        key_intensity(sequence, light, light.spot_light_component, keys["teal"], BEAM_CANDELA, total, fps)
    for light in pink:
        key_intensity(sequence, light, light.spot_light_component, keys["pink"], BEAM_CANDELA, total, fps)
    for light in house:
        key_intensity(sequence, light, light.spot_light_component, keys["house"], HOUSE_CANDELA, total, fps)
    key_intensity(sequence, fog, fog.component, keys["haze"], FOG_DENSITY * 2.0, total, fps, prop="FogDensity")
    for kind, plane in planes.items():
        key_flash(sequence, plane, plan["flashes"][kind], None, total, flash_lights[kind])
    # 1 回の発火に 1 体ずつ。同じ部品のトラックに区間を並べると、最初の区間しか発火しない(測定)
    for number, fire in enumerate(plan["fires"]):
        for side, location in enumerate(FIRE_PLACES[fire["where"]]):
            actor = place_niagara(builder, f"Fire{number:02d}_{side}", location, system, config["niagara_scale"])
            add_fire(sequence, actor, fire["t"], fps)
    key_screens(sequence, screens, plan["monitors"], anim, total, fps)
    save(sequence)
    report.append(f"Seq_LedMain tracks={len(sequence.get_bindings())} fires={len(plan['fires'])} monitors={len(plan['monitors'])}")
    if not levels.save_current_level():
        raise RuntimeError("L_LedTheatre を保存できない")


def build_matte(config, cam, report):
    levels = open_level(L_MATTE)
    builder = StageBuilder(load_required(f"{MATERIAL_DIR}/M_Surface"))
    clear_level(builder.actors)
    fixed_exposure(builder, 0.0)
    mesh, anim = character_assets(config["character"])
    character = place_character(builder, mesh, "LedCharacter", (0.0, 0.0, 0.0))
    matte = load_required(f"{MATERIAL_DIR}/M_CompMatte")
    for index in range(character.skeletal_mesh_component.get_num_materials()):
        character.skeletal_mesh_component.set_material(index, matte)
    camera = place_camera(builder, cam)
    plan, fps, total = config["plan"], config["fps"], config["total_frames"]
    sequence = new_sequence("Seq_LedMatte", total)
    setup_range(sequence, fps, plan["first_frame"], plan["last_frame"])
    add_camera_cut(sequence, camera, total)
    binding = sequence.add_possessable(character)
    key_visibility(transform_channels(character, binding, total), plan["visibility"])
    add_animation(sequence, binding, anim, total)
    save(sequence)
    report.append("Seq_LedMatte ok")
    if not levels.save_current_level():
        raise RuntimeError("L_LedMatte を保存できない")


def render_config(config, cam, job):
    name = f"Cfg_Led_{job['name']}"
    asset, _ = get_or_create(name, RENDER_CONFIG_DIR, unreal.MoviePipelinePrimaryConfig, unreal.MoviePipelinePrimaryConfigFactory())
    output = asset.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    output.set_editor_property("output_directory", unreal.DirectoryPath(f"{config['frames_dir']}/{job['name']}"))
    output.set_editor_property("output_resolution", unreal.IntPoint(*job.get("resolution", (cam.w, cam.h))))
    output.set_editor_property("file_name_format", "f.{frame_number}")
    output.set_editor_property("override_existing_output", True)
    output.set_editor_property("use_custom_playback_range", True)
    output.set_editor_property("custom_start_frame", job["first_frame"])
    output.set_editor_property("custom_end_frame", job["last_frame"])
    deferred = asset.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    deferred.set_editor_property("accumulator_includes_alpha", bool(job.get("alpha")))
    asset.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
    samples = asset.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    samples.set_editor_property("temporal_sample_count", 1)
    samples.set_editor_property("spatial_sample_count", job["spatial"])
    samples.set_editor_property("override_anti_aliasing", True)
    samples.set_editor_property("anti_aliasing_method", unreal.AntiAliasingMethod.AAM_NONE)
    samples.set_editor_property("engine_warm_up_count", WARMUP)
    samples.set_editor_property("render_warm_up_count", WARMUP)
    asset.find_or_add_setting_by_class(unreal.MoviePipelineGameOverrideSetting)
    save(asset)


def main():
    with open(os.environ["LED_CONFIG"], encoding="utf-8") as f:
        config = json.load(f)
    global FPS_FOR_TICKS
    FPS_FOR_TICKS = config["fps"]
    mesh, _ = character_assets(config["character"])
    body_height = mesh.get_bounds().box_extent.z * 2.0
    cam = led_plan.Camera(config["stage"], body_height, stretch=config["stretch"])
    report = [f"camera {cam.summary()}", f"body_height_cm {body_height:.2f}"]
    if config.get("layers"):
        import led_layers
        led_layers.build_layers(config, cam, report, types.SimpleNamespace(**globals()))  # -script では __main__ がこのファイルにならない
    else:
        build_main(config, cam, report)
        build_matte(config, cam, report)
    for job in config["jobs"]:
        render_config(config, cam, job)
    report.append("BUILD_OK")
    write_report(REPORT_PATH, report)


try:
    main()
except Exception:
    write_report(REPORT_PATH, ["BUILD_FAILED", traceback.format_exc()])
    raise
