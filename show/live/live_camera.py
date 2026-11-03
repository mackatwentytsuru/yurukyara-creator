"""UE の中で動く受け手: UDP の 1 行 JSON で Cine Camera を動かし、LED に映像を流す。

-game の起動で -ExecCmds="py このファイル" として動かす。設定は環境変数 LIVE_CONFIG の JSON ファイル。
受ける形: {"t":秒,"T":[16],"K":[fx,fy,cx,cy],"w":幅,"h":高さ,"ok":真偽} 試しのときだけ "m":印の番号。ほかの項目は読まない。
設定の auto_recenter {"pos":[x,y,z],"yaw":度} があれば、最初の 1 コマがその位置になるように合わせる(4 隅の校正が要らない)。
命令: {"cmd":"recenter","pos":[x,y,z],"yaw":度} / {"cmd":"align","rotation":[[3x3]],"translation_cm":[3]}
      {"cmd":"media","seconds":秒}(LED の映像をその秒へ。本物の LED の再生に合わせるとき)
"""
import json
import os
import socket
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

from live_math import IDENTITY, axes_to_rotator, camera_from_K, marker_color, pose_axes, recenter  # noqa: E402
from stage_path import ar_at, on_led  # noqa: E402

LEVEL_OBJECT = "/Game/Show/L_Live.L_Live"
LED_TEXTURE = "/Game/Show/Media/MT_LED"
SYNC_EVERY_SEC = 1.0
SYNC_TOLERANCE_SEC = 0.15
MARKER_DISTANCE_CM = 30.0
MARKER_CENTER = (0.05, 0.90)  # 画面の左下寄り(横, 縦の割合)。受け側の player.html と同じ値
MARKER_SIZE = 0.05  # 画面の幅に対して
MARKER_TIMEOUT_SEC = 2.0
RECV_BYTES = 8192


class Receiver:
    def __init__(self, config):
        self.config = config
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((config.get("udp_bind", "127.0.0.1"), int(config.get("udp_port", 9000))))
        self.sock.setblocking(False)
        self.rotation = IDENTITY
        self.translation = (0.0, 0.0, 0.0)
        if config.get("align"):
            self.rotation = config["align"]["rotation"]
            self.translation = config["align"]["translation_cm"]
        self.pending_recenter = config.get("auto_recenter")
        self.world = self.camera = self.marker = self.marker_material = None
        self.ready = False
        self.last_T = None
        self.last_m = None
        self.last_m_time = 0.0
        self.marker_shown = None
        self.filmback = None
        self.keep = []  # GC から守る
        self.media_player = None
        self.character_component = None
        self.character_actor = None
        self.character_hidden = False
        self.start_sec = config.get("start_sec")
        self.last_sync = 0.0
        self.stats_path = config.get("stats_path")
        self.window_start = time.time()
        self.window_ticks = 0
        self.window_packets = 0
        self.window_poses = 0
        self.window_max_dt = 0.0
        self.window_tick_ms = 0.0
        self.applied = []

    def setup(self):
        self.world = unreal.find_object(None, LEVEL_OBJECT)
        if self.world is None:
            return False
        statics = unreal.GameplayStatics
        cameras = statics.get_all_actors_with_tag(self.world, "LiveCam")
        controller = statics.get_player_controller(self.world, 0)
        if not cameras or controller is None:
            return False
        self.camera = cameras[0]
        controller.set_view_target_with_blend(self.camera, 0.0)
        self.marker = statics.get_all_actors_with_tag(self.world, "LiveMarker")[0]
        rule = unreal.AttachmentRule.KEEP_WORLD
        self.marker.attach_to_actor(self.camera, "", rule, rule, rule, False)
        self.marker_material = self.marker.static_mesh_component.create_dynamic_material_instance(0)
        self.marker.set_actor_hidden_in_game(True)
        self.start_media()
        self.start_character(statics)
        self.ready = True
        unreal.log(f"LIVE_READY camera={self.camera.get_name()} udp={self.config.get('udp_port', 9000)}")
        return True

    def character_motion(self):
        name = self.config["character"]
        return unreal.load_asset(f"/Game/Show/Character/{name}/{name}/SkeletalMeshes/{name}_Anim")

    def start_media(self):
        path = self.config.get("media")
        if not path:
            return
        player = unreal.new_object(unreal.MediaPlayer)
        texture = unreal.load_asset(LED_TEXTURE)
        texture.set_media_player(player)
        texture.update_resource()
        player.set_looping(True)
        player.set_editor_property("play_on_open", True)
        opened = player.open_file(path)
        unreal.log(f"LIVE_MEDIA {path} open={opened}")
        self.media_player = player
        self.keep += [player, texture]

    def start_character(self, statics):
        motion = self.character_motion()
        for actor in statics.get_all_actors_with_tag(self.world, "LiveChar"):
            component = actor.skeletal_mesh_component
            component.set_animation_mode(unreal.AnimationMode.ANIMATION_SINGLE_NODE)
            component.play_animation(motion, True)
            self.character_component = component
            self.character_actor = actor
            self.base_yaw = actor.get_actor_rotation().yaw
            self.floor_z = actor.get_actor_location().z
        self.keep.append(motion)

    def place_on_stage(self):
        """舞台の上にいる間は ar_path のとおりに動く。LED の中にいる間は隠す(本番の合成と同じ)。"""
        stage = self.config.get("stage")
        if not stage or self.character_actor is None:
            return
        t = self.character_component.get_position()
        hidden = on_led(stage, t)
        if hidden != self.character_hidden:
            self.character_actor.set_actor_hidden_in_game(hidden)
            self.character_hidden = hidden
        if not hidden:
            x, y, yaw = ar_at(stage["ar_path"], t)
            self.character_actor.set_actor_location_and_rotation(unreal.Vector(x, y, self.floor_z), unreal.Rotator(0.0, 0.0, self.base_yaw + yaw), False, False)

    def sync_show(self, now):
        """キャラの動きを LED の映像の時刻にそろえる(映像の読み込みの待ち・巻き戻し・命令のあと)。"""
        player = self.media_player
        if player is None or self.character_component is None or not player.is_playing():
            return
        if self.start_sec is not None:
            player.seek(unreal.MathLibrary.from_seconds(self.start_sec))
            self.start_sec = None
            return
        if now - self.last_sync < SYNC_EVERY_SEC:
            return
        self.last_sync = now
        media_sec = unreal.MathLibrary.get_total_seconds(player.get_time())
        if abs(self.character_component.get_position() - media_sec) > SYNC_TOLERANCE_SEC:
            self.character_component.set_position(media_sec, False)
            unreal.log(f"LIVE_SYNC {media_sec:.2f}")

    def apply_lens(self, width, height, K):
        focal, sensor_w, sensor_h = camera_from_K(K, width, height)
        component = self.camera.get_cine_camera_component()
        wanted = (round(sensor_w, 3), round(sensor_h, 3))
        if self.filmback != wanted:
            component.set_editor_property("filmback", unreal.CameraFilmbackSettings(sensor_w, sensor_h))
            self.filmback = wanted
        component.set_editor_property("current_focal_length", focal)
        return focal, sensor_w, sensor_h

    def place_marker(self, focal, sensor_w, sensor_h):
        half_w = MARKER_DISTANCE_CM * sensor_w / 2.0 / focal
        half_h = half_w * sensor_h / sensor_w
        y = (MARKER_CENTER[0] * 2.0 - 1.0) * half_w
        z = (1.0 - MARKER_CENTER[1] * 2.0) * half_h
        size = MARKER_SIZE * half_w * 2.0 / 100.0
        self.marker.set_actor_relative_location(unreal.Vector(MARKER_DISTANCE_CM, y, z), False, False)
        self.marker.set_actor_relative_scale3d(unreal.Vector(0.001, size, size))

    def show_marker(self, code):
        if self.marker_shown != code:
            self.marker.set_actor_hidden_in_game(code is None)
            if code is not None:
                r, g, b = marker_color(code)
                self.marker_material.set_vector_parameter_value("Code", unreal.LinearColor(r, g, b, 1.0))
            self.marker_shown = code

    def handle(self, data):
        message = json.loads(data.decode("utf-8"))
        if "cmd" in message:
            if message["cmd"] == "recenter" and self.last_T is not None:
                self.rotation, self.translation = recenter(self.last_T, message["pos"], message["yaw"])
            elif message["cmd"] == "align":
                self.rotation, self.translation = message["rotation"], message["translation_cm"]
            elif message["cmd"] == "media" and self.media_player is not None:
                self.media_player.seek(unreal.MathLibrary.from_seconds(float(message["seconds"])))
            unreal.log(f"LIVE_CMD {message['cmd']}")
            return None
        if message.get("ok", True) is False:
            return None
        return message

    def apply_pose(self, message, now):
        T = message["T"]
        self.last_T = T
        if self.pending_recenter:
            self.rotation, self.translation = recenter(T, self.pending_recenter["pos"], self.pending_recenter["yaw"])
            self.pending_recenter = None
            unreal.log("LIVE_AUTO_RECENTER")
        position, forward, right, up = pose_axes(T, self.rotation, self.translation)
        pitch, yaw, roll = axes_to_rotator(forward, right, up)
        self.camera.set_actor_location_and_rotation(unreal.Vector(*position), unreal.Rotator(roll, pitch, yaw),
                                                    False, False)
        focal, sensor_w, sensor_h = self.apply_lens(message["w"], message["h"], message["K"])
        if "m" in message:
            self.place_marker(focal, sensor_w, sensor_h)
            self.last_m_time = now
            if message["m"] != self.last_m:
                self.last_m = message["m"]
                self.applied.append([message["m"], round(now * 1000.0, 1)])
        fresh = self.last_m is not None and now - self.last_m_time < MARKER_TIMEOUT_SEC
        self.show_marker(self.last_m % 7 + 1 if fresh else None)

    def tick(self, delta):
        started = time.time()
        if not self.ready and not self.setup():
            return
        newest = None
        while True:
            try:
                data, _ = self.sock.recvfrom(RECV_BYTES)
            except (BlockingIOError, ConnectionResetError):
                break
            self.window_packets += 1
            try:
                newest = self.handle(data) or newest
            except ValueError:
                unreal.log_warning("LIVE_BAD_PACKET")
        if newest is not None:
            self.apply_pose(newest, started)
            self.window_poses += 1
        self.sync_show(started)
        self.place_on_stage()
        self.window_ticks += 1
        self.window_max_dt = max(self.window_max_dt, delta)
        self.window_tick_ms += (time.time() - started) * 1000.0
        if started - self.window_start >= 1.0:
            self.write_stats(started)

    def write_stats(self, now):
        seconds = now - self.window_start
        row = {"wall": round(now, 3), "fps": round(self.window_ticks / seconds, 2),
               "max_dt_ms": round(self.window_max_dt * 1000.0, 1), "packets": self.window_packets,
               "poses": self.window_poses, "tick_ms": round(self.window_tick_ms / max(self.window_ticks, 1), 3),
               "applied": self.applied}
        if self.stats_path:
            with open(self.stats_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(row) + "\n")
        self.window_start, self.window_ticks, self.window_packets, self.window_poses = now, 0, 0, 0
        self.window_max_dt, self.window_tick_ms, self.applied = 0.0, 0.0, []


def main():
    with open(os.environ["LIVE_CONFIG"], encoding="utf-8") as f:
        receiver = Receiver(json.load(f))
    failures = {"count": 0}

    def on_tick(delta):
        try:
            receiver.tick(delta)
        except Exception:
            failures["count"] += 1
            if failures["count"] <= 3:
                unreal.log_error("LIVE_TICK_ERROR " + traceback.format_exc())

    unreal.live_tick_handle = unreal.register_slate_post_tick_callback(on_tick)
    unreal.live_receiver = receiver
    unreal.log("LIVE_SCRIPT_STARTED")


main()
