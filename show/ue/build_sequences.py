"""カットごとの Level Sequence と、撮影の設定を作る。"""
import unreal

from build_materials import build_file_source
from stage_layout import STAGE_Z
from ue_helpers import RENDER_CONFIG_DIR, SEQUENCE_DIR, get_or_create, save

FPS = 30
CUT_FRAMES = 3
WARMUP_FRAMES = 45
MEDIA_MARGIN_FRAMES = 60  # 準備のコマの間もメディアが流れるように、前後に余らせる
RENDER_DIR = "work/ue_show/render"
MEDIA_ROOT = "work/ue_show/media"
DOOR_TRAVEL_CM = 200.0
BEHIND_DOOR = (0.0, -300.0, STAGE_Z)
UNDER_FLOOR_Z = -3000.0  # 隠す物の置き場。Visibility のトラックが効かないので床下へ動かす
OPEN_START_SECONDS = 0.5
OPEN_END_SECONDS = 3.5
CAMERA_PUSH_END = (0.0, 1060.0, 215.0)

CUTS = [
    {"name": "Cut1_StandWide", "media": "a_title", "camera": "wide"},
    {"name": "Cut2_StandClose", "media": "a_title", "camera": "close"},
    {"name": "Cut3_LedCharacter", "media": "b_character", "camera": "wide", "hide_character": True},
    {"name": "Cut4_DoorOpen", "media": "a_title", "camera": "wide", "open_doors": True},
    {"name": "Check_Grid", "media": "grid", "camera": "wide", "hide_character": True},
    # 測定用: ③と比べて絵のキャラの縦横を、①と比べて立体のキャラの位置を測る
    {"name": "Check_Background", "media": "c_background", "camera": "wide", "hide_character": True},
    {"name": "Check_NoCharacter", "media": "a_title", "camera": "wide", "hide_character": True},
    # 動きの試し: 5 秒。扉が開き、カメラが少しずつ寄る
    {"name": "Move_DoorOpens", "media": "a_title", "camera": "wide", "frames": 150, "animate_doors": True},
]


def reset_sequence(sequence):
    for track in list(sequence.get_tracks()):
        sequence.remove_track(track)
    for binding in list(sequence.get_bindings()):
        binding.remove()


def add_media(sequence, source, media_texture, frames):
    track = sequence.add_track(unreal.MovieSceneMediaTrack)
    section = track.add_section()
    section.set_range(-MEDIA_MARGIN_FRAMES, frames + MEDIA_MARGIN_FRAMES)
    section.set_editor_property("media_source", source)
    section.set_editor_property("media_texture", media_texture)
    section.set_editor_property("looping", True)


def add_camera_cut(sequence, camera_actor, frames):
    binding = sequence.add_possessable(camera_actor)
    track = sequence.add_track(unreal.MovieSceneCameraCutTrack)
    section = track.add_section()
    section.set_range(0, frames)
    section.set_camera_binding_id(sequence.get_binding_id(binding))
    return binding


def transform_channels(binding, actor, location, frames):
    """位置のトラックを足し、9 本全部に今の回転・大きさと location を入れて返す。"""
    track = binding.add_track(unreal.MovieScene3DTransformTrack)
    section = track.add_section()
    section.set_range(0, frames)
    rotation = actor.get_actor_rotation()
    scale = actor.get_actor_scale3d()
    values = [location[0], location[1], location[2], rotation.roll, rotation.pitch, rotation.yaw,
              scale.x, scale.y, scale.z]
    channels = section.get_all_channels()
    if len(channels) != len(values):
        raise RuntimeError(f"位置の通り道の数が違う: {len(channels)}")
    for channel, value in zip(channels, values):
        channel.set_default(float(value))
    return channels


def pin_transform(sequence, actor, location, frames):
    """actor を、カットの間 location に置く。回転と大きさは今のまま。"""
    transform_channels(sequence.add_possessable(actor), actor, location, frames)


def key_location(channels, frame, location):
    for channel, value in zip(channels[:3], location):
        channel.add_key(unreal.FrameNumber(frame), float(value))


def smooth(t):
    """0-1 を、始めと終わりがなめらかになるように写す。"""
    t = min(1.0, max(0.0, t))
    return t * t * t * (t * (6.0 * t - 15.0) + 10.0)


def animate_doors(sequence, level_actors, frames):
    start, end = OPEN_START_SECONDS * FPS, OPEN_END_SECONDS * FPS
    for name, direction in (("LED_B_L", -1.0), ("LED_B_R", 1.0)):
        door = level_actors["led"][name]
        at = door.get_actor_location()
        channels = transform_channels(sequence.add_possessable(door), door, (at.x, at.y, at.z), frames)
        for frame in range(frames + 1):
            travel = DOOR_TRAVEL_CM * smooth((frame - start) / (end - start))
            key_location(channels, frame, (at.x + direction * travel, at.y, at.z))


def push_camera(camera_binding, camera_actor, frames):
    at = camera_actor.get_actor_location()
    begin = (at.x, at.y, at.z)
    channels = transform_channels(camera_binding, camera_actor, begin, frames)
    for frame in range(frames + 1):
        t = smooth(frame / frames)
        key_location(channels, frame, tuple(a + (b - a) * t for a, b in zip(begin, CAMERA_PUSH_END)))


def hide_actor(sequence, actor, frames):
    """床下へ動かして隠す。"""
    at = actor.get_actor_location()
    pin_transform(sequence, actor, (at.x, at.y, UNDER_FLOOR_Z), frames)


def build_sequence(cut, level_actors, media_texture):
    sequence, _ = get_or_create(cut["name"], SEQUENCE_DIR, unreal.LevelSequence,
                                unreal.LevelSequenceFactoryNew())
    reset_sequence(sequence)
    sequence.set_display_rate(unreal.FrameRate(FPS, 1))
    sequence.set_tick_resolution(unreal.FrameRate(24000, 1))
    sequence.set_playback_start(0)
    frames = cut.get("frames", CUT_FRAMES)
    sequence.set_playback_end(frames)
    source = build_file_source(cut["media"], f"{MEDIA_ROOT}/{cut['media']}.mp4")
    add_media(sequence, source, media_texture, frames)
    camera_actor = level_actors["cameras"][cut["camera"]]
    camera_binding = add_camera_cut(sequence, camera_actor, frames)
    if cut.get("hide_character"):
        for actor in level_actors["characters"]:
            hide_actor(sequence, actor, frames)
    if cut.get("open_doors"):
        for name, direction in (("LED_B_L", -1.0), ("LED_B_R", 1.0)):
            door = level_actors["led"][name]
            at = door.get_actor_location()
            pin_transform(sequence, door, (at.x + direction * DOOR_TRAVEL_CM, at.y, at.z), frames)
    if cut.get("animate_doors"):
        animate_doors(sequence, level_actors, frames)
        push_camera(camera_binding, camera_actor, frames)
    if cut.get("open_doors") or cut.get("animate_doors"):
        for actor in level_actors["characters"]:
            pin_transform(sequence, actor, BEHIND_DOOR, frames)
    save(sequence)
    return sequence


def build_render_config():
    config, _ = get_or_create("Cfg_Still", RENDER_CONFIG_DIR, unreal.MoviePipelinePrimaryConfig,
                              unreal.MoviePipelinePrimaryConfigFactory()
                              if hasattr(unreal, "MoviePipelinePrimaryConfigFactory") else None)
    output = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    output.set_editor_property("output_directory", unreal.DirectoryPath(RENDER_DIR))
    output.set_editor_property("output_resolution", unreal.IntPoint(1920, 1080))
    output.set_editor_property("file_name_format", "{sequence_name}/{sequence_name}.{frame_number}")
    output.set_editor_property("override_existing_output", True)
    config.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
    samples = config.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    samples.set_editor_property("temporal_sample_count", 4)
    samples.set_editor_property("spatial_sample_count", 1)
    samples.set_editor_property("engine_warm_up_count", WARMUP_FRAMES)
    samples.set_editor_property("render_warm_up_count", WARMUP_FRAMES)
    config.find_or_add_setting_by_class(unreal.MoviePipelineGameOverrideSetting)
    save(config)
    return config


def build_all(level_actors, media_texture):
    build_render_config()
    return [build_sequence(cut, level_actors, media_texture) for cut in CUTS]
