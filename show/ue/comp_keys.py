"""カメラの動きを Level Sequence のキーにする部品。"""
import unreal

from sim_layout import LEAD_FRAMES


def _keys(channel, frames, values):
    channel.set_default(float(values[0]))
    for frame, value in zip(frames, values):
        channel.add_key(unreal.FrameNumber(LEAD_FRAMES + frame), float(value))


def set_filmback(camera_actor, width_mm, height_mm):
    component = camera_actor.get_cine_camera_component()
    component.set_editor_property("filmback", unreal.CameraFilmbackSettings(float(width_mm), float(height_mm)))


def make_camera(label, rows, sensor_mm):
    """同じ名前のカメラを置き直す。"""
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in actors.get_all_level_actors():
        if actor.get_actor_label() == label:
            actors.destroy_actor(actor)
    first = rows[0]
    camera = actors.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(first["x"], first["y"], first["z"]))
    camera.set_actor_label(label)
    camera.set_folder_path("Cameras")
    component = camera.get_cine_camera_component()
    focus = component.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
    component.set_editor_property("focus_settings", focus)
    set_filmback(camera, sensor_mm[0], sensor_mm[1])
    return camera


def key_camera(sequence, binding, camera_actor, rows):
    """rows(f, x, y, z, pitch, yaw, roll, focal)を位置・向き・焦点距離のキーにする。"""
    last = LEAD_FRAMES + rows[-1]["f"] + 1
    section = binding.add_track(unreal.MovieScene3DTransformTrack).add_section()
    section.set_range(0, last)
    channels = section.get_all_channels()
    frames = [row["f"] for row in rows]
    names = ["x", "y", "z", "roll", "pitch", "yaw"]  # UE の変換のトラックの並び
    for channel, name in zip(channels[:6], names):
        _keys(channel, frames, [row[name] for row in rows])
    for channel in channels[6:9]:
        channel.set_default(1.0)
    component_binding = sequence.add_possessable(camera_actor.get_cine_camera_component())
    focal_track = component_binding.add_track(unreal.MovieSceneFloatTrack)
    focal_track.set_property_name_and_path("CurrentFocalLength", "CurrentFocalLength")
    focal_section = focal_track.add_section()
    focal_section.set_range(0, last)
    _keys(focal_section.get_all_channels()[0], frames, [row["focal"] for row in rows])
