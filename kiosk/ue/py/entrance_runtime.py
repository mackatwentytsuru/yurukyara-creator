"""入口の LED のレベルの、ゲーム中の受け口(UE の Python。毎コマ動く)。
UDP(entrance_config.json の udp)で 1 行の JSON を受け、人型の首・目・顎を、PoseableMesh の骨で直接動かす。
  視線 v1: {"v":1,"present":bool,"az":度(客から見て右が +),"el":度(上が +),"dist":m,...}  ← gaze_bridge.py と同じ形
  口:      {"mouth":0〜1}  ← entrance_talk.py(返事の文字 → 手元の日本語の声の音の大きさ。音は鳴らさない)
骨の向きは、毎コマ「最初の姿勢」(部品の座標)に戻してから、部品の座標で回す(骨の軸の向きに依存しない):
  前 f = 両目の中点 − 頭(水平)、上 = +Z。客の向き = f を上の軸で回し(左右)、右の軸で回す(上下)。
  首と頭で向きの head_share 分(上限つき)、残りを目(上限つき)。顎は右の軸で開く。腕は T の姿勢から下ろす。
記録: 環境変数 ENTRANCE_LOG(1 行の JSON。毎秒の状態と、口の動き始めの時刻)。
"""
import json
import math
import os
import socket
import time

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "..", "entrance_config.json"), encoding="utf-8"))
B = CFG["character"]["bones"]
G = CFG["gaze"]
CS = unreal.BoneSpaces.COMPONENT_SPACE


# ---- 四元数(UE と同じ Hamilton の式。成分は x, y, z, w) ----
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qinv(q):
    return (-q[0], -q[1], -q[2], q[3])


def qaxis(axis, deg):
    h = math.radians(deg) / 2
    s = math.sin(h)
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(h))


def qrot(q, v):
    p = qmul(qmul(q, (v[0], v[1], v[2], 0.0)), qinv(q))
    return p[:3]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / n for c in v)


def to_q(rot):
    q = rot.quaternion()
    return (q.x, q.y, q.z, q.w)


def to_rot(q):
    return unreal.Quat(q[0], q[1], q[2], q[3]).rotator()


def tup(v):
    return (v.x, v.y, v.z)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def smooth(cur, target, dt, tau):
    return target if tau <= 0 else cur + (target - cur) * (1 - math.exp(-dt / tau))


class Entrance:
    def __init__(self):
        u = CFG["udp"]
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((u["host"], int(os.environ.get("ENTRANCE_UDP_PORT", u["port"]))))  # 同じ機械で 2 つ目を試すときは別の番号
        self.sock.setblocking(False)
        self.log_path = os.environ.get("ENTRANCE_LOG")
        self.comp = None
        self.t0 = time.time()
        self.gaze = {"present": False, "az": 0.0, "el": 0.0}
        self.gaze_at = 0.0
        self.mouth_target = 0.0
        self.mouth_at = 0.0
        self.mouth = 0.0
        self.head = [0.0, 0.0]
        self.eye = [0.0, 0.0]
        self.received = 0
        self.frames = 0
        self.last_status = 0.0
        self.speaking = False
        # 確かめの写真(任意): ENTRANCE_SHOTS="8,20" なら、起動の何秒後に HighResShot(Saved/Screenshots へ)。窓を前に出さずに撮れる
        self.shots = sorted(float(x) for x in os.environ.get("ENTRANCE_SHOTS", "").split(",") if x.strip())
        self.sign = {"yaw": -1.0, "pitch": -1.0, "jaw": float(os.environ.get("ENTRANCE_JAW_SIGN", "1"))}

    def write(self, rec):
        if self.log_path:
            rec["t"] = round(time.time(), 3)
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # ---- 起動のあとの 1 回 ----
    def find_body(self):
        for c in unreal.ObjectIterator(unreal.PoseableMeshComponent):
            owner = c.get_owner()
            if owner is None or "EntranceBody" not in [str(t) for t in c.component_tags]:
                continue
            if c.get_num_bones() > 0:
                return c
        return None

    def setup(self, comp):
        self.comp = comp
        self.t_setup = time.time()
        loc = lambda n: tup(comp.get_bone_location_by_name(n, CS))  # noqa: E731
        head, el, er = loc(B["head"]), loc(B["eye_l"]), loc(B["eye_r"])
        mid = tuple((a + b) / 2 for a, b in zip(el, er))
        f = norm((mid[0] - head[0], mid[1] - head[1], 0.0))
        self.up = (0.0, 0.0, 1.0)
        self.f = f
        self.right = norm(cross(self.up, f))  # キャラの右(部品の座標)
        # 前が世界の +X(カメラの方)を向くように、部品を回す
        yaw = -math.degrees(math.atan2(f[1], f[0]))
        comp.set_relative_rotation(unreal.Rotator(0.0, 0.0, yaw), False, False)
        # 腕を下ろす(T の姿勢 → 体の横)。Auto Setup 版(部品の印 EntranceVariant_autosetup)は autosetup の値
        tags = [str(t) for t in comp.component_tags]
        self.variant = "autosetup" if "EntranceVariant_autosetup" in tags else "glb"
        arm_down = (CFG.get("autosetup", {}) if self.variant == "autosetup" else CFG["character"]).get("arm_down_deg", 0)
        for side in ("l", "r"):
            ua, la = B[f"upperarm_{side}"], B[f"lowerarm_{side}"]
            d = norm(tuple(b - a for a, b in zip(loc(ua), loc(la))))
            best = None
            for s in (1.0, -1.0):
                q = qaxis(f, s * arm_down)
                z = qrot(q, d)[2]
                if best is None or z < best[0]:
                    best = (z, q)
            cur = to_q(comp.get_bone_rotation_by_name(ua, CS))
            comp.set_bone_rotation_by_name(ua, to_rot(qmul(best[1], cur)), CS)
        self.ref = [(k, comp.get_bone_transform_by_name(B[k], CS)) for k in ("neck", "head", "jaw", "eye_l", "eye_r")]  # 親から子の順
        self.eye_mid_h = mid[2]
        self.write({"kind": "setup", "variant": self.variant, "forward": [round(c, 3) for c in f], "yaw": round(yaw, 1), "eye_z_cm": round(mid[2], 1),
                    "bones": comp.get_num_bones()})

    # ---- 毎コマ ----
    def receive(self, now):
        while True:
            try:
                data, _ = self.sock.recvfrom(4096)
            except (BlockingIOError, OSError):
                return
            try:
                m = json.loads(data.decode("utf-8"))
            except ValueError:
                continue
            if not isinstance(m, dict):
                continue
            self.received += 1
            if "mouth" in m and isinstance(m["mouth"], (int, float)):
                self.mouth_target = clamp(float(m["mouth"]), 0.0, 1.0)
                self.mouth_at = now
            elif m.get("v") == 1 and isinstance(m.get("present"), bool):
                if m["present"] and isinstance(m.get("az"), (int, float)) and isinstance(m.get("el"), (int, float)):
                    self.gaze = {"present": True, "az": clamp(float(m["az"]), -90, 90), "el": clamp(float(m["el"]), -60, 60)}
                else:
                    self.gaze = {"present": False, "az": 0.0, "el": 0.0}
                self.gaze_at = now

    def tick(self, dt):
        now = time.time()
        if self.comp is None:
            c = self.find_body()
            if c is None:
                return
            self.setup(c)
        self.receive(now)
        dt = clamp(dt, 0.0, 0.1)
        present = self.gaze["present"] and now - self.gaze_at < G["lost_after_s"]
        az, el = (self.gaze["az"], self.gaze["el"]) if present else (0.0, 0.0)
        # 首と頭の分・目の分
        hy = clamp(az * G["head_share"], -G["head_max_yaw"], G["head_max_yaw"])
        hp = clamp(el * G["head_share"], -G["head_max_pitch"], G["head_max_pitch"])
        idle = now - self.t0
        hy += 1.2 * math.sin(idle * 2 * math.pi * 0.17)
        hp += 0.8 * math.sin(idle * 2 * math.pi * 0.11 + 1.0)
        self.head[0] = smooth(self.head[0], hy, dt, G["head_tau_s"])
        self.head[1] = smooth(self.head[1], hp, dt, G["head_tau_s"])
        ey = clamp(az - self.head[0], -G["eye_max_yaw"], G["eye_max_yaw"])
        ep = clamp(el - self.head[1], -G["eye_max_pitch"], G["eye_max_pitch"])
        self.eye[0] = smooth(self.eye[0], ey, dt, G["eye_tau_s"])
        self.eye[1] = smooth(self.eye[1], ep, dt, G["eye_tau_s"])
        mt = self.mouth_target if now - self.mouth_at < 0.3 else 0.0
        self.mouth = smooth(self.mouth, mt, dt, 0.035 if mt > self.mouth else 0.07)
        if self.mouth > 0.08 and not self.speaking:
            self.speaking = True
            self.write({"kind": "mouth_start"})
        elif self.mouth < 0.02 and self.speaking:
            self.speaking = False
            self.write({"kind": "mouth_end"})
        self.apply()
        if self.shots and now - self.t_setup > self.shots[0]:  # 秒は人型が見つかってから
            self.shots.pop(0)
            unreal.SystemLibrary.execute_console_command(self.comp.get_world(), "HighResShot 1")
            self.write({"kind": "shot"})
        self.frames += 1
        if now - self.last_status > 1.0:
            self.last_status = now
            self.write({"kind": "status", "fps": self.frames, "rx": self.received, "present": present,
                        "az": round(az, 1), "el": round(el, 1), "head": [round(v, 1) for v in self.head],
                        "eye": [round(v, 1) for v in self.eye], "mouth": round(self.mouth, 2)})
            self.frames = 0

    def look(self, yaw, pitch):
        """左右 yaw(客から見て右が +)、上下 pitch(上が +)の回転(部品の座標)"""
        qy = qaxis(self.up, self.sign["yaw"] * yaw)
        r2 = qrot(qy, self.right)
        return qmul(qaxis(r2, self.sign["pitch"] * pitch), qy)

    def apply(self):
        c = self.comp
        for k, t in self.ref:  # 最初の姿勢へ(部品の座標で、親から子の順に戻す)
            c.set_bone_transform_by_name(B[k], t, CS)
        share = G["neck_share_of_head"]
        qn = self.look(self.head[0] * share, self.head[1] * share)
        cur = to_q(c.get_bone_rotation_by_name(B["neck"], CS))
        c.set_bone_rotation_by_name(B["neck"], to_rot(qmul(qn, cur)), CS)
        qh_rest = self.look(self.head[0] * (1 - share), self.head[1] * (1 - share))
        cur = to_q(c.get_bone_rotation_by_name(B["head"], CS))
        c.set_bone_rotation_by_name(B["head"], to_rot(qmul(qh_rest, cur)), CS)
        qh = qmul(qh_rest, qn)  # 頭の全部の回り
        qe = qmul(qmul(qh, self.look(self.eye[0], self.eye[1])), qinv(qh))  # 頭の向きの中での目の回り
        for k in ("eye_l", "eye_r"):
            cur = to_q(c.get_bone_rotation_by_name(B[k], CS))
            c.set_bone_rotation_by_name(B[k], to_rot(qmul(qe, cur)), CS)
        jaw_axis = qrot(qh, self.right)
        qj = qaxis(jaw_axis, self.sign["jaw"] * CFG["character"]["jaw_open_deg"] * self.mouth)
        cur = to_q(c.get_bone_rotation_by_name(B["jaw"], CS))
        c.set_bone_rotation_by_name(B["jaw"], to_rot(qmul(qj, cur)), CS)


_entrance = None
_handle = None


def _tick(dt):
    global _entrance
    try:
        if _entrance is None:
            _entrance = Entrance()
        _entrance.tick(dt)
    except Exception as e:  # 1 回だけ記録して止める(毎コマの例外で記録をあふれさせない)
        import traceback
        unreal.log_error("[Entrance] " + traceback.format_exc())
        if _entrance:
            _entrance.write({"kind": "error", "error": str(e)})
        unreal.unregister_slate_post_tick_callback(_handle)


def start():
    global _handle
    _handle = unreal.register_slate_post_tick_callback(_tick)
    unreal.log("[Entrance] runtime started")
