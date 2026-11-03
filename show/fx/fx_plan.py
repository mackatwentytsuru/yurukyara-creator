"""計算の効果の層の「秒の計画」。コマごとの数字の表を、ファイルから作る(GPU を使わない)。

入力は timeline・show_stage・打点・任意の cues だけ。秒をコードに書かない。
表は全編ぶんを先に作るので、どのコマからでも同じ絵が描ける(状態を持たない)。

cues.json(任意。無い物は曲の構成から代用する):
  intro_bulbs: [始め, 終わり]   前奏で電球が灯る区間
  intro_hits:  [秒, ...]       電球が 1 つ灯る音(オルゴールの打点)。無ければ区間の中の拍
  call_runs:   [[秒 x 4], ...] コールの打点。電球が A → C へ走る。無ければ舞台にいる間の小節頭の 4 拍
  finale:      秒               最後の決め。無ければ最後の song の最後の小節頭
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ue"))
import led_plan  # noqa: E402  秒から作るキーはブラウザ版・UE 版と同じ式を使う

CANVAS = (5680, 1240)
ATTACK_FRAMES = 3  # iPhone は 30p。60p の 1 コマの光は写らない
STRONG_RANK = 0.7  # この順位から上だけを強く動かす
CRASH_STRONG_RANK = 0.85
WEAK_AMP = 0.1  # ふだんの音は少し動く程度
DECAY_SEC = {"kick": 0.30, "snare": 0.22, "crash": 0.9}
FALL_LEAD_SEC = 0.9  # 「出る」で電球の光が下へ落ち始める、出る秒の手前
EXIT_SEC = 0.45  # 「出る」の秒の手前、舞台のキャラが足から現れる長さ
LED_FADE_BEFORE = 0.25  # LED のキャラは奥に残り、出る秒のこの手前から薄れる
LED_FADE_AFTER = 0.25  # 出る秒のこの後に消える。層が無いコマは最後のコマを保つ
LAND_MIN_AFTER = 0.3  # 着地は「出る」のこの後の最初の拍
CLOSED_FX = 0.14  # 緞帳が閉じている間の、光の面と柱の残り(開くと 1)
OPEN_FX_SEC = 0.8
FINALE_DECAY_SEC = 2.2
BULB_IDLE = 0.14
RUN_DECAY_SEC = 0.35
RUN_STAGGER_SEC = 0.12
RUN_EVERY_DOWNBEATS = 2
ARCH = {"half_w": 830.0, "top": 135.0, "foot": 1170.0}  # B 単独の推奨の範囲に収める
ROW_Y = 120.0
ROW_STEP = 110.0
ARCH_STEP = 95.0
SEAM_MARGIN = 60.0


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def impulse(frames, hit_frame, decay_frames):
    """3 コマで立ち上がり(真ん中が打点)、指数で落ちる形。"""
    age = frames - hit_frame
    rise = smoothstep((age + ATTACK_FRAMES / 2.0) / ATTACK_FRAMES)
    return rise * np.exp(-np.maximum(age - ATTACK_FRAMES / 2.0, 0.0) / decay_frames)


def hit_amount(band, rank):
    """強さの順位から反応の大きさへ。弱い音はほとんど動かない。"""
    strong = CRASH_STRONG_RANK if band == "crash" else STRONG_RANK
    if rank < strong:
        return WEAK_AMP * rank / strong if band != "crash" else 0.0
    return 0.25 + 0.75 * ((rank - strong) / (1.0 - strong)) ** 1.5


def default_bulbs(center_x):
    """額縁の仮の電球。A 面の上の列、B 面のアーチ、C 面の上の列。背景の額縁が決まったら --bulbs で置きかえる。"""
    bulbs = []
    for x in np.arange(70.0, 1279.0 - SEAM_MARGIN, ROW_STEP):
        bulbs.append({"x": float(x), "y": ROW_Y})
    radius_y = ARCH["foot"] - ARCH["top"]
    steps = np.linspace(-math.pi / 2, math.pi / 2, 400)
    arc_x = center_x + ARCH["half_w"] * np.sin(steps)
    arc_y = ARCH["foot"] - radius_y * np.cos(steps)
    lengths = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(arc_x), np.diff(arc_y)))])
    for s in np.arange(0.0, lengths[-1] + 1.0, ARCH_STEP):
        bulbs.append({"x": float(np.interp(s, lengths, arc_x)), "y": float(np.interp(s, lengths, arc_y))})
    for x in np.arange(3039.0 + SEAM_MARGIN + 20.0, CANVAS[0] - 40.0, ROW_STEP):
        bulbs.append({"x": float(x), "y": ROW_Y})
    return sorted(bulbs, key=lambda b: b["x"])


def flow_order(bulbs, center_x):
    """光が流れる順(0 が先)。アーチの頂点から足へ、列は中央側から外へ。測った電球は flow を持つ。"""
    out = np.zeros(len(bulbs))
    for index, bulb in enumerate(bulbs):
        if "flow" in bulb:
            out[index] = bulb["flow"]
        elif bulb["y"] <= ROW_Y + 1.0:
            out[index] = min(1.0, abs(bulb["x"] - center_x) / (CANVAS[0] - center_x))
        else:
            out[index] = (bulb["y"] - ARCH["top"]) / (ARCH["foot"] - ARCH["top"])
    return out


class FxPlan:
    def __init__(self, timeline, stage, hits, cues=None, bulbs=None):
        self.timeline = timeline
        self.stage = stage
        self.cues = cues or {}
        self.fps = int(timeline["fps"])
        self.frames = int(timeline["frames"])
        self.center_x = float(stage["plate"]["center_x"])
        self.foot_y = float(stage["life_size"]["foot_y"])
        self.hits = hits
        self.bulbs = bulbs or default_bulbs(self.center_x)
        self.flow = flow_order(self.bulbs, self.center_x)
        self.measured_bulbs = bool(bulbs) and "flow" in bulbs[0]
        self.index = np.arange(self.frames, dtype=np.float64)
        self._build_scene()
        self._build_hit_tracks()
        self._build_flash()
        self._build_finale()
        self._build_bulbs()

    def _build_scene(self):
        timeline, stage = self.timeline, self.stage
        times = self.index / self.fps
        self.gain = np.array([led_plan.venue_gain(timeline, stage, t) for t in times], dtype=np.float32)
        spans = led_plan.character_spans(timeline, stage)
        on_led = np.zeros(self.frames, dtype=np.float32)
        for a, b in spans:
            on_led = np.maximum(on_led, smoothstep((times - a) / 0.4) * smoothstep((b - times) / 0.4))
        self.on_stage = (1.0 - on_led) * self.gain
        downbeats = np.array(timeline.get("downbeats", []), dtype=np.float64)
        self.breath = np.zeros(self.frames, dtype=np.float32)
        if downbeats.size >= 2:
            position = np.interp(times, downbeats, np.arange(downbeats.size))
            inside = (times >= downbeats[0]) & (times <= downbeats[-1])
            self.breath = (0.5 + 0.5 * np.cos(2.0 * np.pi * position)).astype(np.float32) * inside

    def _build_hit_tracks(self):
        self.track = {name: np.zeros(self.frames, dtype=np.float32) for name in DECAY_SEC}
        self.pressed = []
        for hit in self.hits:
            band = hit["band"]
            if band not in self.track:
                continue
            amount = hit_amount(band, hit["strength"])
            if amount <= 0.0:
                continue
            frame = hit["t"] * self.fps
            if not 0 <= frame < self.frames:
                continue
            first, last = max(0, int(frame) - 3), min(self.frames, int(frame + DECAY_SEC[band] * self.fps * 6))
            span = np.arange(first, last, dtype=np.float64)
            shape = amount * impulse(span, frame, DECAY_SEC[band] * self.fps)
            self.track[band][first:last] = np.maximum(self.track[band][first:last], shape)
            self.pressed.append({**hit, "amount": round(float(amount), 3)})

    def _build_flash(self):
        """出る・戻るの光。led_plan.flash_keys と同じ式で、立ち上がりだけ 3 コマにならす。"""
        names = ("light", "radius", "width", "ring", "pillar", "core")
        self.flash = {kind: {n: np.zeros(self.frames, dtype=np.float32) for n in names} for kind in ("out", "back")}
        rows = led_plan.flash_keys(self.stage, 0.0, self.frames / self.fps, self.fps)
        for kind, keys in rows.items():
            first_key = None
            for key in keys:
                frame = key["frame"]
                if not 0 <= frame < self.frames:
                    continue
                if key["ring"] == 0.0 and key["light"] == 0.0:
                    first_key = None  # 前後に置かれた 0 のキー
                    continue
                first_key = frame if first_key is None else first_key
                fade = float(smoothstep((frame - first_key + 1.0) / ATTACK_FRAMES))
                for name in names:
                    scale = 1.0 if name in ("radius", "width") else fade
                    self.flash[kind][name][frame] = key[name] * scale
        self.out_times = [float(c["t"]) for c in self.stage["flashes"] if c["kind"] == "out"]
        self.back_times = [float(c["t"]) for c in self.stage["flashes"] if c["kind"] == "back"]
        self.all_flash = sorted(self.out_times + self.back_times)
        self.land_times = self._landings()
        self._build_opened()

    def _build_opened(self):
        """緞帳の開き具合(0 閉じ、1 開き)。出るで開き、戻るで閉じる。"""
        times = self.index / self.fps
        self.opened = np.zeros(self.frames, dtype=np.float32)
        for at in self.out_times:
            back = [b for b in self.back_times if b > at]
            until = back[0] if back else self.frames / self.fps + 10.0
            rise = smoothstep((times - at) / OPEN_FX_SEC) * smoothstep((until - times) / OPEN_FX_SEC + 1.0)
            self.opened = np.maximum(self.opened, rise.astype(np.float32))

    def _landings(self):
        """着地の秒。cues の landings、無ければ「出る」の後の最初の拍。"""
        if "landings" in self.cues:
            return [float(t) for t in self.cues["landings"]]
        beats = np.array(self.timeline.get("beats", []), dtype=np.float64)
        out = []
        for at in self.out_times:
            later = beats[beats >= at + LAND_MIN_AFTER]
            out.append(float(later[0]) if later.size else at + LAND_MIN_AFTER)
        return out

    def led_character_fade(self, t):
        """LED のキャラの濃さ(1 そのまま、0 消えた)。出る前後だけ下がる。"""
        for at in self.out_times:
            if at - LED_FADE_BEFORE <= t <= at + LED_FADE_AFTER + 1.0:
                return 1.0 - float(smoothstep((t - (at - LED_FADE_BEFORE)) / (LED_FADE_BEFORE + LED_FADE_AFTER)))
        return 1.0

    def held_frame(self, frame):
        """「出る」の後で薄れている間に見せるコマ。層は出る秒で終わるので、最後のコマを保つ。"""
        t = frame / self.fps
        for at in self.out_times:
            if at <= t <= at + LED_FADE_AFTER + 1.0:
                return int(round(at * self.fps)) - 1
        return frame

    def exit_progress(self, t):
        """足から順に舞台へ移る進み。0 まだ、1 全部出た。出る秒の手前 EXIT_SEC から。"""
        for at in self.out_times:
            if at - EXIT_SEC <= t <= at + 1.0:
                return round(float(np.clip((t - (at - EXIT_SEC)) / EXIT_SEC, 0.0, 1.0)), 6)
        return 0.0

    def exit_age(self, t):
        """出始めからの秒。無ければ None。"""
        for at in self.out_times:
            if at - EXIT_SEC <= t <= at + 2.5:
                return t - (at - EXIT_SEC)
        return None

    def _build_finale(self):
        self.finale_t = self._finale_time()
        self.finale = np.zeros(self.frames, dtype=np.float32)
        if self.finale_t is not None:
            self.finale = impulse(self.index, self.finale_t * self.fps, FINALE_DECAY_SEC * self.fps).astype(np.float32)

    def _finale_time(self):
        if "finale" in self.cues:
            return float(self.cues["finale"])
        songs = [s for s in self.timeline["sections"] if s["id"] == "song"]
        if not songs:
            return None
        before = [d for d in self.timeline.get("downbeats", []) if d < songs[-1]["end"]]
        return float(before[-1]) if before else None

    def intro_events(self):
        """前奏で灯る秒(電球ごと)。音 1 つで 1 つ灯るのが本来の形。音が足りないときは順にまとめて灯す。"""
        span = self.cues.get("intro_bulbs")
        if not span:
            by_id = {s["id"]: s for s in self.timeline["sections"]}
            lines = [s["start"] for s in self.timeline["sections"] if s["id"] == "line"]
            if "enter" not in by_id:
                return None
            span = [by_id["enter"]["start"], lines[0] if lines else by_id["enter"]["end"]]
        hits = self.cues.get("intro_hits") or [b for b in self.timeline.get("beats", []) if span[0] <= b < span[1]]
        if not hits:
            hits = [span[0]]
        order = np.argsort(np.abs(np.array([b["x"] for b in self.bulbs]) - self.center_x))
        lit = np.zeros(len(self.bulbs))
        for rank, bulb in enumerate(order):
            lit[bulb] = hits[min(len(hits) - 1, rank * len(hits) // len(order))]
        return lit

    def call_runs(self):
        """電球が走る打点。無ければ舞台にいる間の 2 小節ごとの頭から 4 拍(見本の代用)。"""
        if "call_runs" in self.cues:
            return [list(map(float, run)) for run in self.cues["call_runs"]]
        runs, count = [], 0
        beats = list(self.timeline.get("beats", []))
        for downbeat in self.timeline.get("downbeats", []):
            frame = int(downbeat * self.fps)
            if not (0 <= frame < self.frames and self.on_stage[frame] > 0.9):
                continue
            if count % RUN_EVERY_DOWNBEATS == 0 and downbeat in beats:
                at = beats.index(downbeat)
                if at + 4 <= len(beats):
                    runs.append(beats[at:at + 4])
            count += 1
        return runs

    def _add_bulb_event(self, bulb, t, amount, decay_sec):
        frame = t * self.fps
        first, last = max(0, int(frame) - 3), min(self.frames, int(frame + decay_sec * self.fps * 6))
        if first >= last:
            return
        span = np.arange(first, last, dtype=np.float64)
        shape = amount * impulse(span, frame, decay_sec * self.fps)
        self.bulb_table[first:last, bulb] = np.maximum(self.bulb_table[first:last, bulb], shape)

    def _build_bulbs(self):
        count = len(self.bulbs)
        self.bulb_table = np.zeros((self.frames, count), dtype=np.float32)
        lit = self.intro_events()
        times = self.index / self.fps
        for bulb in range(count):
            turned_on = np.ones(self.frames) if lit is None else smoothstep((times - lit[bulb]) * self.fps / ATTACK_FRAMES + 0.5)
            self.bulb_table[:, bulb] = BULB_IDLE * turned_on * np.minimum(1.0, self.gain * 4.0)
            if lit is not None:
                self._add_bulb_event(bulb, lit[bulb], 0.8, 0.5)
        for at in self.out_times:
            for bulb in range(count):
                self._add_bulb_event(bulb, at - FALL_LEAD_SEC + FALL_LEAD_SEC * 0.75 * self.flow[bulb], 1.0, 0.45)
        for at in self.back_times:
            for bulb in range(count):
                self._add_bulb_event(bulb, at - led_plan.BACK_LEAD_SEC * self.flow[bulb], 0.8, 0.3)
        self._build_runs()
        if self.finale_t is not None:
            for bulb in range(count):
                self._add_bulb_event(bulb, self.finale_t, 1.0, FINALE_DECAY_SEC)

    def _build_runs(self):
        order = np.argsort([b["x"] for b in self.bulbs])
        groups = np.array_split(order, 4)
        for run in self.call_runs():
            for at, group in zip(run, groups):
                for position, bulb in enumerate(group):
                    self._add_bulb_event(int(bulb), at + RUN_STAGGER_SEC * position / max(1, len(group) - 1), 1.0, RUN_DECAY_SEC)

    def last_flash_age(self, t, times):
        """いちばん近い過去の秒からの経過。無ければ None。"""
        past = [x for x in times if x <= t]
        return t - past[-1] if past else None


def load_plan(timeline_path, stage_path, hits, cues_path=None, bulbs_path=None):
    timeline = json.loads(Path(timeline_path).read_text(encoding="utf-8"))
    stage = json.loads(Path(stage_path).read_text(encoding="utf-8"))
    cues = json.loads(Path(cues_path).read_text(encoding="utf-8")) if cues_path else None
    bulbs = json.loads(Path(bulbs_path).read_text(encoding="utf-8")) if bulbs_path else None
    return FxPlan(timeline, stage, hits, cues, bulbs)
