"""仮想 iPad の共通の部品(UE なしで動く計算)。

座標の約束:
  ページ(page) … 点の校正と ARKit の記録が使う右手系。x 右・y 上・z 客席側(m)。カメラは ARKit 流(+x 右、+y 上、-z 前)。
  UE … 舞台の座標(cm、Z 上、左手系)。page_point の逆: (X, Y, Z) = (x·100 + A_X0, z·100, y·100 + LED_Z_BOTTOM)。
  カメラの 4x4 T は「カメラ → 世界」。ARKit の世界は、ページに水平の回転と平行移動を足した物(ARKit のまね、sim_arkit.py)。

実測と仮定(結果の文書にも同じ分け方で書く):
  実測 … 手持ちの揺れの形(手で持った iPad の 39 秒の記録)、ARKit の向きのずれの形(固定の iPad の 10 分の記録)、位置のずれ(0.35 cm 以内)。
  仮定 … 歩きの揺れ、手持ちのときの向きのずれの大きさ、10 分より先のずれ、ローリングシャッターの読み出し時間(11 ms)、絵の雑音、露出の揺れ。
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, filtfilt
from scipy.spatial.transform import Rotation as R

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path[:0] = [str(REPO / "show" / "ue"), str(REPO / "show" / "composite"), str(REPO / "place" / "shootlog")]
from stage_layout import A_X0, LED_Z_BOTTOM  # noqa: E402
from ue_axes import axes_to_rotator, rotator_axes  # noqa: E402

OUT = Path("work/仮想iPad")
DATA = OUT / "data"
DRIFT_DIR = Path("work/_stream/drift")
FPS = 30
W, H = 1920, 1080
W4K = 3840
FX4K = {"wide": 3065.0, "ultra": 1478.0}           # iPad の実測(4K の画素)。寄り 2 倍は広角の中央の切り出し
READOUT_MS = 11.0                                   # ローリングシャッターの読み出し時間(timecode_selftest の値。仮定)
STAGE = json.loads((REPO / "show" / "show_stage.json").read_text(encoding="utf-8"))


def fx_video(lens: str) -> float:
    """映像(1920 幅)の画素での fx。zoom は広角の中央 1920×1080 の切り出しなので 4K の fx のまま。"""
    return FX4K["wide"] if lens == "zoom" else FX4K[lens] * W / W4K


# ---- ページ ↔ UE ---------------------------------------------------------------------------

def stage_to_page(p):
    X, Y, Z = p
    return np.array([(X - A_X0) / 100.0, (Z - LED_Z_BOTTOM) / 100.0, Y / 100.0])


def page_to_stage(q):
    x, y, z = q
    return np.array([x * 100.0 + A_X0, z * 100.0, y * 100.0 + LED_Z_BOTTOM])


def swap(v):
    """ページのベクトル (x, y, z) → UE (X, Y, Z) = (x, z, y)。右手系 → 左手系。"""
    return np.array([v[0], v[2], v[1]])


def page_pose_to_ue_row(T, f):
    """T(ページ、カメラ → ページ、4x4)→ truth.json / track.json の 1 行(UE の位置 cm と pitch/yaw/roll 度)。focal は呼び出し側で足す。"""
    pos = page_to_stage(T[:3, 3])
    fwd, right, up = swap(-T[:3, 2]), swap(T[:3, 0]), swap(T[:3, 1])
    pitch, yaw, roll = axes_to_rotator(fwd, right, up)
    return {"f": f, "x": float(pos[0]), "y": float(pos[1]), "z": float(pos[2]), "pitch": pitch, "yaw": yaw, "roll": roll}


def ue_row_to_page_pose(row):
    """逆変換(試験用)。"""
    fwd, right, up = rotator_axes(row["pitch"], row["yaw"], row["roll"])
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2] = swap(right), swap(up), -swap(fwd)       # swap は自分の逆
    T[:3, 3] = stage_to_page((row["x"], row["y"], row["z"]))
    return T


def look_at_page(pos_page, target_page):
    """ARKit 流のカメラ(水平、ロール 0)が target を向く 4x4(ページ)。"""
    fwd = np.asarray(target_page, float) - np.asarray(pos_page, float)
    fwd /= np.linalg.norm(fwd)
    z = -fwd
    x = np.cross([0.0, 1.0, 0.0], z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = x, y, z, pos_page
    return T


def flat(T):
    """4x4 → 列順の 16 個(ARKit の記録の形)。"""
    return [float(v) for v in np.asarray(T).T.reshape(-1)]


def unflat(v):
    return np.array(v, float).reshape(4, 4).T


def angle_between(Ra, Rb):
    """2 つの回転行列の間の角(度)。"""
    c = (np.trace(Ra.T @ Rb) - 1) / 2
    return math.degrees(math.acos(float(np.clip(c, -1, 1))))


# ---- 実測の記録の読み込み ---------------------------------------------------------------------

def load_index(path):
    rows = [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    t = np.array([r["ar_ts"] for r in rows])
    T = np.array([r["T"] for r in rows]).reshape(-1, 4, 4).transpose(0, 2, 1)
    return rows, t - t[0], T


class Shake:
    """手持ちの揺れ(実測)。手で持った iPad の記録から、意図した動き(1 Hz 未満)を引いた高い周波数の部分。
    カメラの座標で、回転(rotvec、ラジアン)と位置(m)の 2 つ。記録は 39 秒。長いカットでは前から順に使い回す。"""

    def __init__(self, path=DATA / "mcal_index.jsonl", cutoff_hz=1.0, scale=1.0, offset_s=0.0):
        _, t, T = load_index(path)
        grid = np.arange(0, t[-1], 1 / FPS)
        pos = np.stack([np.interp(grid, t, T[:, k, 3]) for k in range(3)], 1)
        rot = R.from_matrix(T[:, :3, :3])
        rv = np.stack([np.interp(grid, t, (rot[0].inv() * rot).as_rotvec()[:, k]) for k in range(3)], 1)
        b, a = butter(2, cutoff_hz / (FPS / 2), "high")
        rot_world = R.from_rotvec(rv)        # 最初のコマの座標での回転
        hp_rv = filtfilt(b, a, rv, axis=0)
        hp_pos = filtfilt(b, a, pos, axis=0)
        # カメラの座標へ: 位置は各コマの回転の逆で戻す
        Rt = R.from_matrix(np.stack([(R.from_matrix(T[0, :3, :3]) * rot_world[i]).as_matrix() for i in range(len(grid))]))
        self.pos_cam = Rt.inv().apply(hp_pos)
        self.rot_cam = hp_rv                # 小さい回転なので、座標の違いは無視してよい(最初のコマの座標のまま、カメラの座標として使う)
        self.scale, self.offset = scale, int(offset_s * FPS)
        self.n = len(grid)

    def at(self, i):
        j = (i + self.offset) % self.n
        return self.pos_cam[j] * self.scale, self.rot_cam[j] * self.scale

    def stats(self):
        return {"pos_cm_std": [round(float(v) * 100, 3) for v in self.pos_cam.std(0)], "rot_deg_std": [round(float(v), 3) for v in np.degrees(self.rot_cam).std(0)]}


def apply_shake(T, shake: Shake, i):
    """T(カメラ → ページ)に i コマ目の揺れを足す。位置はカメラの座標のずれ、向きはカメラの座標の小さな回転。"""
    dp, dr = shake.at(i)
    out = np.array(T, float)
    out[:3, :3] = T[:3, :3] @ R.from_rotvec(dr).as_matrix()
    out[:3, 3] = T[:3, 3] + T[:3, :3] @ dp
    return out


# ---- ARKit の向きのずれ(実測の形) --------------------------------------------------------------

class Drift:
    """固定の iPad で測った、ARKit の向きのずれの形。校正からの経過(分)→ 世界の座標の回転(rotvec、ラジアン)。
    記録の最初のコマの座標でのずれ(rotvec)を測り、使うときは「テイクの最初のカメラの座標」へ移す(上下のずれは上下のまま)。
    10 分(実測の終わり)より先は、5〜10 分の傾きでまっすぐ伸ばす(仮定。実測は無い)。"""

    def __init__(self, path=DRIFT_DIR / "long_index.jsonl"):
        _, t, T = load_index(path)
        R0 = R.from_matrix(T[0, :3, :3])
        rel = R0.inv() * R.from_matrix(T[:, :3, :3])      # 最初のカメラの座標での回転
        self.t_min = t / 60.0
        self.rv = rel.as_rotvec()
        # 雑音を減らすため 5 秒おきに取り直して 25 秒の窓で平均(分の軸)
        grid = np.arange(0, self.t_min[-1], 1 / 12.0)
        self.grid = grid
        self.curve = np.stack([np.interp(grid, self.t_min, self.rv[:, i]) for i in range(3)], 1)
        from scipy.ndimage import uniform_filter1d
        self.smooth = uniform_filter1d(self.curve, size=5, axis=0, mode="nearest")
        self.end_min = float(grid[-1])
        at = lambda m: np.array([np.interp(m, grid, self.smooth[:, i]) for i in range(3)])      # noqa: E731
        self.slope = (at(self.end_min) - at(self.end_min - 5.0)) / 5.0           # rad/分(最後の 5 分の傾き)

    def rotvec_cam0(self, minutes):
        if minutes <= 0:
            return np.zeros(3)
        if minutes <= self.end_min:
            return np.array([np.interp(minutes, self.grid, self.smooth[:, i]) for i in range(3)])
        base = np.array([self.smooth[-1, i] for i in range(3)])
        return base + self.slope * (minutes - self.end_min)

    def is_measured(self, minutes):
        return minutes <= self.end_min

    def degrees(self, minutes):
        return float(np.degrees(np.linalg.norm(self.rotvec_cam0(minutes))))

    def world_rotation(self, minutes, T_take_first):
        """テイクの最初のコマ(カメラ → 世界)の座標へ移した、世界の回転(ARKit の報告 = この回転 × 正解)。"""
        d = R.from_rotvec(self.rotvec_cam0(minutes))
        R_first = R.from_matrix(np.asarray(T_take_first)[:3, :3])
        return R_first * d * R_first.inv()


def stage_seconds(kind: str, index: int, offset: float) -> float:
    """ショーの秒は show_stage.json の flashes から読む(値を写さない)。"""
    return [f["t"] for f in STAGE["flashes"] if f["kind"] == kind][index] + offset
