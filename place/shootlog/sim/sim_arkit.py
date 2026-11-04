"""ARKit のまね: 正解のカメラ(ページの座標)→ 仮の ARKit の世界 → 位置の雑音・向きのずれ → 本番と同じ frames の形。

ARKit の世界は、ページの座標に「水平の回転(y 回り)+ 平行移動」を足した物(重力は合っている)。校正(dots_align)はこの 2 つを求める。
向きのずれ(sim_common.Drift)は、実測の形(固定の iPad の 10 分)を、カメラの向きだけに掛ける(位置は 0.35 cm しか動かないので動かさない)。
  frames.jsonl の 1 行 = {"ar_ts", "T"(列順 16 個、カメラ → ARKit の世界)、"K"([fx fy cx cy]、4K の画素。受け手が 1920 幅に直す)}。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy.spatial.transform import Rotation as R

from sim_common import FPS, W, Drift, flat, fx_video

# 位置・向きの雑音。実測は固定の iPad の 2 分(1 Hz 以上の成分): 位置 0.003 cm・向き 0.03° 以下。手持ちで動くときは増える(未測定)ので、仮定として大きめを置く
NOISE_POS_CM = 0.3          # 仮定
NOISE_ROT_DEG = 0.02        # 仮定


@dataclass
class ArkitWorld:
    theta: float = math.radians(37.0)
    t: np.ndarray = field(default_factory=lambda: np.array([1.3, -0.4, 2.1]))
    session: str = "SIM-1"

    def matrix(self):
        c, s = math.cos(self.theta), math.sin(self.theta)
        m = np.eye(4)
        m[:3, :3] = [[c, 0, s], [0, 1, 0], [-s, 0, c]]
        m[:3, 3] = self.t
        return m


def k_sent(lens: str, w4k_scale=W / 3840.0):
    """アプリが送る K(4K の画素)。受け手が 1920/3840 倍して映像の画素にする。"""
    fx = fx_video(lens) / w4k_scale
    return [fx, fx, 1920.0, 1080.0]


def to_arkit(Ts_page, world: ArkitWorld, lens: str, rng, minutes=0.0, drift: Drift | None = None, pos_cm=NOISE_POS_CM, rot_deg=NOISE_ROT_DEG, t0=1000.0,
             drift_scale=1.0):
    """正解の T(ページ)の列 → ARKit の記録の行(dict)の列。minutes は校正からの経過(分。テイクの頭)。"""
    M = world.matrix()
    rows = []
    Ts_ark = [M @ T for T in Ts_page]
    Rw = None
    for i, T in enumerate(Ts_ark):
        T = T.copy()
        T[:3, 3] += rng.normal(0, pos_cm / 100.0, 3)
        T[:3, :3] = T[:3, :3] @ R.from_rotvec(np.radians(rng.normal(0, rot_deg, 3))).as_matrix()
        if drift is not None and minutes >= 0:
            if Rw is None or i % 15 == 0:
                d = drift.world_rotation(minutes + i / FPS / 60.0, Ts_ark[0])
                if drift_scale != 1.0:
                    d = R.from_rotvec(d.as_rotvec() * drift_scale)
                Rw = d.as_matrix()
            T[:3, :3] = Rw @ T[:3, :3]
        rows.append({"i": i, "ar_ts": t0 + i / FPS, "T": flat(T), "K": k_sent(lens), "w": 1920, "h": 1080, "flags": 2})
    return rows
