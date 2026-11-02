"""シミュレーターと合成で共通の、レベルとシーケンスの部品。"""
import unreal

import build_level
from build_level import StageBuilder, to_color
from build_materials import build_file_source
from build_sequences import add_camera_cut, reset_sequence
from sim_layout import FPS, LEAD_FRAMES, MEDIA_LATENCY_FRAMES, SIM_CAMERAS, real_focal
from ue_helpers import (MATERIAL_DIR, MEDIA_DIR, RENDER_CONFIG_DIR, SEQUENCE_DIR, SHOW_ROOT,
                        assets, get_or_create, save, vec)

SIM_LEVEL = SHOW_ROOT + "/L_Sim"
SOUND_NAME = "SW_Sim"
WARMUP_FRAMES = 45
# 面の前の面光源: (名前, 位置, 向きのずらし, 幅)
GLOW_PLATES = [("SimGlow_A", (-494, 6, 346), 0.0, 512), ("SimGlow_B", (0, -134, 346), 0.0, 704),
               ("SimGlow_C", (486, 6, 346), 0.0, 500), ("SimGlow_C1", (925, 62, 346), 45.0, 200),
               ("SimGlow_C2", (1029, 250, 346), 90.0, 260)]


def load_required(path):
    asset = unreal.load_asset(path)
    if asset is None:
        raise RuntimeError(f"資産が無い(先に build_stage.py を動かす): {path}")
    return asset


def open_sim_level(level=SIM_LEVEL):
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    done = levels.load_level(level) if assets.does_asset_exist(level) else levels.new_level(level)
    if not done:
        raise RuntimeError(f"レベルを開けない: {level}")
    return levels


def remove_stage_lights(builder, body_material):
    """吊り物の形は周りの埋まりとして残し、光だけを消す。LED だけが光る箱にする。"""
    for actor in builder.actors.get_all_level_actors():
        if isinstance(actor, unreal.SpotLight):
            builder.actors.destroy_actor(actor)
        elif actor.get_actor_label().endswith("_Lens"):
            actor.static_mesh_component.set_material(0, body_material)


def add_floor_glow(builder, config):
    """LED の光が床に落ちる分の面光源。強さはシーケンスで映像の明るさに合わせる。強さ 0 なら置かない。"""
    placed = []
    candela = float(config.get("glow_candela", 0.0))
    if candela <= 0:
        return placed
    for label, pos, yaw_offset, width in GLOW_PLATES:
        light = builder.actors.spawn_actor_from_class(unreal.RectLight, vec(*pos),
                                                      unreal.Rotator(0, 0, 90.0 + yaw_offset))
        light.set_actor_label(label)
        light.set_folder_path("Lights")
        comp = light.rect_light_component
        comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
        comp.set_editor_property("intensity", 0.0)
        comp.set_editor_property("source_width", float(width))
        comp.set_editor_property("source_height", 496.0)
        comp.set_editor_property("attenuation_radius", 1400.0)
        comp.set_editor_property("light_color", to_color(config.get("glow_color", (0.5, 0.2, 0.6))))
        comp.set_editor_property("cast_shadows", False)
        comp.set_editor_property("volumetric_scattering_intensity", 0.0)
        placed.append((light, candela * width / 500.0))
    return placed


def add_glow_keys(sequence, glows, keys, media_frames):
    """面光源の強さを、映像の明るさの変化に合わせる。LED が黒い間は床も暗いままにする。"""
    for light, candela in glows:
        sequence.add_possessable(light)
        binding = sequence.add_possessable(light.rect_light_component)
        track = binding.add_track(unreal.MovieSceneFloatTrack)
        track.set_property_name_and_path("Intensity", "Intensity")
        section = track.add_section()
        section.set_range(0, LEAD_FRAMES + media_frames)
        channel = section.get_all_channels()[0]
        channel.set_default(0.0)
        for seconds, scale in keys:
            channel.add_key(unreal.FrameNumber(LEAD_FRAMES + int(round(seconds * FPS))), float(candela * scale))


def set_floor(builder, label, name, color, roughness):
    material = builder.surface(name, color, roughness)
    for actor in builder.actors.get_all_level_actors():
        if actor.get_actor_label() == label:
            actor.static_mesh_component.set_material(0, material)
            return
    raise RuntimeError(f"床が無い: {label}")


def tune_post_process(config, report):
    """露出は build_atmosphere の固定のまま。反射の質だけを足す。"""
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    volume = next(a for a in actors.get_all_level_actors() if isinstance(a, unreal.PostProcessVolume))
    settings = volume.settings
    for key, value in [("lumen_reflection_quality", float(config.get("reflection_quality", 2.0))),
                       ("lumen_max_roughness_to_trace_reflections", float(config.get("max_trace_roughness", 0.5)))]:
        try:
            settings.set_editor_property("override_" + key, True)
            settings.set_editor_property(key, value)
            report.append(f"post process {key} = {value}")
        except Exception as error:  # 名前が版で違う項目は、撮って効きを見るので止めない
            report.append(f"post process {key} not set: {error}")
    volume.set_editor_property("settings", settings)


def build_level_for_sim(config, report, level=SIM_LEVEL):
    levels = open_sim_level(level)
    surface = load_required(f"{MATERIAL_DIR}/M_Surface")
    led_parent = load_required(f"{MATERIAL_DIR}/M_LED")
    builder = StageBuilder(surface)
    build_level.clear_level(builder.actors)
    build_level.build_hall(builder)
    build_level.build_led(builder, led_parent, report)
    build_level.build_truss(builder)
    build_level.build_lights(builder)
    remove_stage_lights(builder, builder.surface("FixtureBody", (0.012, 0.012, 0.012), 0.5))
    build_level.build_atmosphere(builder)
    glows = add_floor_glow(builder, config)
    set_floor(builder, "Stage_Floor", "SimStageFloor", (0.045, 0.045, 0.05),
              float(config.get("stage_roughness", 0.22)))
    set_floor(builder, "Hall_Floor", "SimHallFloor", (0.012, 0.012, 0.014),
              float(config.get("hall_roughness", 0.55)))
    tune_post_process(config, report)
    specs = {**SIM_CAMERAS, **config.get("camera_override", {})}  # 焦点距離の案を比べるときに差し替える
    cameras = {
        name: build_level.camera(builder, name, spec["pos"], spec["target"], real_focal(spec["mm35"]))
        for name, spec in specs.items()
    }
    if not levels.save_current_level():
        raise RuntimeError("レベルを保存できない")
    return cameras, glows


def import_sound(wav_path):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", wav_path)
    task.set_editor_property("destination_path", MEDIA_DIR)
    task.set_editor_property("destination_name", SOUND_NAME)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    sound = unreal.load_asset(f"{MEDIA_DIR}/{SOUND_NAME}")
    if not isinstance(sound, unreal.SoundWave):
        raise RuntimeError(f"音を取り込めない: {wav_path}")
    return sound


def add_full_media(sequence, source, media_texture, media_frames):
    track = sequence.add_track(unreal.MovieSceneMediaTrack)
    section = track.add_section()
    section.set_range(LEAD_FRAMES - MEDIA_LATENCY_FRAMES, LEAD_FRAMES + media_frames)
    section.set_editor_property("media_source", source)
    section.set_editor_property("media_texture", media_texture)
    section.set_editor_property("looping", False)


def add_full_audio(sequence, sound, media_frames):
    track = sequence.add_track(unreal.MovieSceneAudioTrack)
    section = track.add_section()
    section.set_range(LEAD_FRAMES, LEAD_FRAMES + media_frames)
    section.set_sound(sound)


def build_sequence(name, camera_actor, source, media_texture, sound, media_frames, first, last, glows, glow_keys):
    sequence, _ = get_or_create(name, SEQUENCE_DIR, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    reset_sequence(sequence)
    sequence.set_display_rate(unreal.FrameRate(FPS, 1))
    sequence.set_tick_resolution(unreal.FrameRate(24000, 1))
    sequence.set_playback_start(LEAD_FRAMES + first)
    sequence.set_playback_end(LEAD_FRAMES + last)
    add_full_media(sequence, source, media_texture, media_frames)
    add_full_audio(sequence, sound, media_frames)
    add_camera_cut(sequence, camera_actor, LEAD_FRAMES + media_frames)
    add_glow_keys(sequence, glows, glow_keys, media_frames)
    save(sequence)
    return sequence


def build_render_config(out_dir, name="Cfg_Sim", spatial=4, resolution=(1920, 1080)):
    config, _ = get_or_create(name, RENDER_CONFIG_DIR, unreal.MoviePipelinePrimaryConfig,
                              unreal.MoviePipelinePrimaryConfigFactory()
                              if hasattr(unreal, "MoviePipelinePrimaryConfigFactory") else None)
    output = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    output.set_editor_property("output_directory", unreal.DirectoryPath(out_dir))
    output.set_editor_property("output_resolution", unreal.IntPoint(*resolution))
    output.set_editor_property("file_name_format", "{sequence_name}/f.{frame_number_rel}")
    output.set_editor_property("override_existing_output", True)
    config.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
    samples = config.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    # 1 コマの中で時間を進めない。時間を進めると、前後のコマのメディアが混ざって 1 コマ分ぼける
    samples.set_editor_property("temporal_sample_count", 1)
    samples.set_editor_property("spatial_sample_count", spatial)
    samples.set_editor_property("override_anti_aliasing", True)
    samples.set_editor_property("anti_aliasing_method", unreal.AntiAliasingMethod.AAM_NONE)
    samples.set_editor_property("engine_warm_up_count", WARMUP_FRAMES)
    samples.set_editor_property("render_warm_up_count", WARMUP_FRAMES)
    config.find_or_add_setting_by_class(unreal.MoviePipelineGameOverrideSetting)
    save(config)


def describe(sequence):
    parts = [f"{track.get_class().get_name()} {section.get_start_frame()}-{section.get_end_frame()}"
             for track in sequence.get_tracks() for section in track.get_sections()]
    return (f"{sequence.get_name()} playback {sequence.get_playback_start()}-{sequence.get_playback_end()}: "
            + "; ".join(parts))


def outside_show_dependencies(level=SIM_LEVEL):
    """レベルがたどる /Game の資産のうち、/Game/Show の外にある物を返す。"""
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    options = unreal.AssetRegistryDependencyOptions(True, True, False, False, False)
    seen, stack = set(), [level]
    while stack:
        for name in registry.get_dependencies(stack.pop(), options) or []:
            path = str(name)
            if path.startswith("/Game") and path not in seen:
                seen.add(path)
                stack.append(path)
    return len(seen), sorted(p for p in seen if not p.startswith(SHOW_ROOT))
