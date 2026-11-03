"""LED の絵を UE で描くときの計算(UE に依存しない)。カメラの式と、秒から作るキーの全部。

秒は全部 timeline と show_stage から読む。曲が替わってもここは変えない。
絵の座標は 5680x1240(横に伸ばした後)。「sq」は伸ばす前の、正方形の画素の座標。
"""
import math

PLATE_OFF = {"preroll", "calib", "sync_head", "tail", "sync_tail", "black_end"}  # ブラウザ版と同じ、会場が消える区間
BROWSER_FOV_DEG = 14.0  # show_page.mjs のカメラ。奥行きの効きをブラウザ版と同じにする
REF_HEIGHT_PX = 500.0  # show_page.mjs の下調べの高さ
FLASH_LENGTH_SEC = {"out": 1.2, "back": 0.9}
BACK_LEAD_SEC = 0.45
OPEN_SEC = 0.28
CLOSE_SEC = 0.2
SHOTS = {"face": {"frame": 44.0, "aim_up": 5.0, "push": 0.06}, "bust": {"frame": 92.0, "aim_up": -16.0, "push": 0.05}}
CLOSE_FOV_V_DEG = 20.0
SIDE_ANGLE = 0.16
FOLLOW = 0.12
LIGHT_KEYS_PER_SEC = 20
BEAT_DECAY_SEC = 0.22
LIT_ENERGY = 0.75  # この energy を超える小節頭で、横の粒を出す
SIDE_FIRE_EVERY_DOWNBEATS = 4


class Camera:
    """ブラウザ版の射影行列と同じ写り方の、正方形の画素のカメラ。単位 cm、足元の原点が世界の原点。"""

    def __init__(self, stage, body_height_cm, canvas=(5680, 1240), stretch=1.48, center_x=None):
        self.canvas_w, self.h = canvas
        self.w = int(round(self.canvas_w / stretch / 2.0)) * 2
        self.to_canvas = self.canvas_w / self.w
        life = stage["life_size"]
        center = float(center_x if center_x is not None else stage["plate"]["center_x"])
        self.k = life["height_px"] / REF_HEIGHT_PX
        fy = 1.0 / math.tan(math.radians(BROWSER_FOV_DEG / 2.0))
        self.distance = fy * body_height_cm * self.h / 2.0 / REF_HEIGHT_PX
        self.f_px = fy * self.k * self.h / 2.0
        self.height = body_height_cm / 2.0  # カメラの高さ。ブラウザ版は体の真ん中の高さで水平に見る
        self.cx = center / self.to_canvas
        self.cy = life["foot_y"] - self.k * REF_HEIGHT_PX / 2.0
        self.sensor_w = 36.0
        self.sensor_h = 36.0 * self.h / self.w
        self.focal_mm = self.f_px * self.sensor_w / self.w
        # 正なら、絵の中心(消失点)が左・下へ動く(5.8 の CalculateProjectionMatrix と CineCameraComponent の式)
        self.offset_x_mm = (self.w / 2.0 - self.cx) / (self.w / 2.0) * self.sensor_w / 2.0
        self.offset_y_mm = (self.cy - self.h / 2.0) / (self.h / 2.0) * self.sensor_h / 2.0

    def position(self):
        return (0.0, self.distance, self.height)

    def world_at(self, px, py, y_world):
        """絵の座標(伸ばした後)の点が、奥行き y_world の面のどこに写るか。(x, z) を返す。"""
        dist = self.distance - y_world
        return (px / self.to_canvas - self.cx) * dist / self.f_px, self.height + (self.cy - py) * dist / self.f_px

    def project(self, x, y, z):
        """世界の点を絵の座標(伸ばした後)へ。"""
        dist = self.distance - y
        return (self.cx + x * self.f_px / dist) * self.to_canvas, self.cy - (z - self.height) * self.f_px / dist

    def px_to_cm_at_foot(self):
        return self.distance / self.f_px

    def summary(self):
        return {"render": [self.w, self.h], "distance_cm": round(self.distance, 2), "f_px": round(self.f_px, 2),
                "height_cm": self.height, "focal_mm": round(self.focal_mm, 3), "cx": round(self.cx, 2),
                "cy": round(self.cy, 2), "offset_mm": [round(self.offset_x_mm, 3), round(self.offset_y_mm, 3)]}


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def show_range(stage):
    """描く範囲(秒)。LED にキャラがいる最初から最後まで。待ちと同期の区間は入らない。"""
    spans = stage["led_character"]
    return float(spans[0][0]), float(spans[-1][1])


def sections_at(timeline, t):
    return [s for s in timeline["sections"] if s["start"] <= t < s["end"]]


def song_amount(timeline, t, ramp=0.6):
    amount = 0.0
    for s in timeline["sections"]:
        if s["id"] == "song":
            amount = max(amount, min(smoothstep((t - s["start"]) / ramp), smoothstep((s["end"] - t) / ramp)))
    return amount


def venue_gain(timeline, stage, t):
    """会場の明るさ(0〜1)。ブラウザ版の setPlate と同じ考え方。歌で明るく、暗転と同期で消える。"""
    now = sections_at(timeline, t)
    quiet = stage["plate"]["quiet_gain"] / stage["plate"]["song_gain"]
    gain = quiet + (1.0 - quiet) * song_amount(timeline, t)
    for s in now:
        if s["id"] in PLATE_OFF:
            return 0.0
        if s["id"] == "dark":
            gain = quiet * (t - s["start"]) / (s["end"] - s["start"])
        elif s["id"] == "outro":
            gain *= max(0.0, 1.0 - (t - s["start"]) / (s["end"] - s["start"]))
    return gain


def energy_at(timeline, t):
    values = timeline["energy"]
    frame = int(t * timeline["fps"])
    return max(0.0, min(1.0, float(values[frame]))) if 0 <= frame < len(values) else 0.0


def beat_pulse(beats, t):
    """いちばん近い過去の拍からの減衰。"""
    low, high = 0, len(beats)
    while low < high:
        mid = (low + high) // 2
        if beats[mid] <= t:
            low = mid + 1
        else:
            high = mid
    return (low - 1, math.exp(-(t - beats[low - 1]) / BEAT_DECAY_SEC)) if low > 0 else (-1, 0.0)


def light_keys(timeline, stage, start, end):
    """照明と霞の強さ(0〜1)のキー。青緑とピンクは拍ごとに交互に強くなる。"""
    beats = timeline.get("beats", [])
    times = {round(start + i / LIGHT_KEYS_PER_SEC, 4) for i in range(int((end - start) * LIGHT_KEYS_PER_SEC) + 1)}
    times |= {round(b, 4) for b in beats if start <= b < end}
    teal, pink, house, haze = [], [], [], []
    for t in sorted(times):
        gain = venue_gain(timeline, stage, t)
        energy = energy_at(timeline, t)
        index, pulse = beat_pulse(beats, t)
        strong = gain * (0.25 + 0.75 * energy)
        teal.append([t, strong * (0.3 + 0.7 * (pulse if index % 2 == 0 else 0.0))])
        pink.append([t, strong * (0.3 + 0.7 * (pulse if index % 2 == 1 else 0.0))])
        house.append([t, gain])
        haze.append([t, gain * (0.5 + 0.5 * energy)])
    return {"teal": teal, "pink": pink, "house": house, "haze": haze}


def flash_keys(stage, start, end, fps):
    """出る・戻るの光。式はブラウザ版の FLASH_FRAGMENT と同じ。半径と幅は正方形の画素。"""
    rows = {"out": [], "back": []}
    for cue in stage["flashes"]:
        kind, at = cue["kind"], float(cue["t"])
        lead = BACK_LEAD_SEC if kind == "back" else 0.0
        length = FLASH_LENGTH_SEC[kind] * (0.5 if kind == "back" else 1.0)
        first, last = round((at - lead) * fps), round((at + length) * fps)
        if last < start * fps or first > end * fps:
            continue
        # 先頭の前に必ず 0 を置く。無いと最初のキーの値が手前へ伸び、全編が光りっぱなしになる
        rows[kind].append({"frame": first - 1, "light": 0.0, "radius": 0.0, "width": 34.0, "ring": 0.0, "pillar": 0.0, "core": 0.0})
        for frame in range(first, last + 1):
            age = frame / fps - at + lead
            if kind == "out":
                row = {"radius": 40.0 + age * 2600.0, "width": 24.0 + age * 120.0,
                       "ring": 1.3 * math.exp(-age * 2.2), "pillar": 1.5 * math.exp(-age * 7.0), "core": 0.0}
                light = math.exp(-age * 3.0)
            else:
                row = {"radius": max(0.0, 1500.0 * (1.0 - age / BACK_LEAD_SEC)), "width": 34.0,
                       "ring": 1.1 * (1.0 - smoothstep((age - 0.42) / 0.08)), "pillar": 0.0,
                       "core": 1.4 * math.exp(-(((age - BACK_LEAD_SEC) / 0.14) ** 2))}
                light = math.exp(-(((age - BACK_LEAD_SEC) / 0.2) ** 2))
            rows[kind].append({"frame": frame, "light": light, **row})
        # 終わりで必ず 0 に戻す
        rows[kind].append({"frame": last + 1, "light": 0.0, "radius": 0.0, "width": 34.0, "ring": 0.0, "pillar": 0.0, "core": 0.0})
    return rows


def visibility_changes(stage, fps):
    """LED にキャラがいるかの切り替わり [(コマ, いる), ...]。ブラウザ版と同じ t >= a かつ t < b。"""
    changes = []
    for a, b in stage["led_character"]:
        changes.append((int(math.ceil(a * fps - 1e-6)), True))
        changes.append((int(math.ceil(b * fps - 1e-6)), False))
    return changes


def monitor_frames(stage, start, end, fps):
    """モニターが出ているコマの状態。ブラウザ版の monitorState と同じ式。"""
    rows = []
    for cue in stage["monitors"]:
        on, off = float(cue["on"]), float(cue["off"])
        if off <= start or on >= end:
            continue
        for frame in range(int(math.ceil(on * fps)), int(math.ceil(off * fps))):
            t = frame / fps
            amount = max(0.0, min(1.0, (t - on) / OPEN_SEC, (off - t) / CLOSE_SEC))
            shot_start, shot_name = cue["shots"][0]
            for at, name in cue["shots"]:
                if at <= t:
                    shot_start, shot_name = at, name
            rows.append({"frame": frame, "open": amount * amount * (3 - 2 * amount),
                         "flash": max(0.0, 1.0 - (t - on) / OPEN_SEC) * 0.5, "shot": shot_name,
                         "shot_age": t - shot_start, "first": frame == int(math.ceil(on * fps))})
    return rows


def close_camera(shot, shot_age, follow, side_sign):
    """顔のアップのカメラの位置と狙い(follow は頭の位置、キャラの正面は +y)。"""
    spec = SHOTS[shot]
    distance = spec["frame"] / 2.0 / math.tan(math.radians(CLOSE_FOV_V_DEG / 2.0)) * (1.0 - spec["push"] * min(1.0, shot_age / 4.0))
    at = (follow[0] + side_sign * SIDE_ANGLE * distance, follow[1] + distance, follow[2] + spec["aim_up"] - 2.0)
    target = (follow[0], follow[1], follow[2] + spec["aim_up"])
    return at, target


def horizontal_fov(aspect):
    return math.degrees(2.0 * math.atan(math.tan(math.radians(CLOSE_FOV_V_DEG / 2.0)) * aspect))


def niagara_fires(timeline, stage, start, end):
    """粒を出す秒。出る・戻るは足元、歌の盛り上がる小節頭は左右。"""
    fires = [{"t": float(c["t"]), "where": "center"} for c in stage["flashes"] if start <= c["t"] < end]
    count = 0
    for t in timeline.get("downbeats", []):
        if start <= t < end and energy_at(timeline, t) >= LIT_ENERGY and song_amount(timeline, t) > 0.5:
            if count % SIDE_FIRE_EVERY_DOWNBEATS == 0:
                fires.append({"t": float(t), "where": "sides"})
            count += 1
    return sorted(fires, key=lambda f: f["t"])
