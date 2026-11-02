"""UE のカメラの向き(Pitch・Yaw・Roll)と軸の変換。UE に依存しない。

軸は UE の FRotationMatrix と同じ式。座標は UE のまま(cm、左手系、Z が上)。
ロールは、UE の Rotator の符号(正で、後ろから見てカメラが時計回りに傾く)。
"""
import math

import numpy as np

FULL_FRAME_W_MM = 36.0


def rotator_axes(pitch, yaw, roll):
    """度 → 前・右・上 の単位ベクトル。"""
    sp, cp = math.sin(math.radians(pitch)), math.cos(math.radians(pitch))
    sy, cy = math.sin(math.radians(yaw)), math.cos(math.radians(yaw))
    sr, cr = math.sin(math.radians(roll)), math.cos(math.radians(roll))
    forward = np.array([cp * cy, cp * sy, sp])
    right = np.array([sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp])
    up = np.array([-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp])
    return forward, right, up


def axes_to_rotator(forward, right, up):
    """前・右・上 → (pitch, yaw, roll) 度。rotator_axes の逆。"""
    pitch = math.degrees(math.asin(float(np.clip(forward[2], -1.0, 1.0))))
    yaw = math.degrees(math.atan2(forward[1], forward[0]))
    roll = math.degrees(math.atan2(-right[2], up[2]))
    return pitch, yaw, roll


def project_ue(points, position, forward, right, up, fx, fy, cx, cy):
    """UE の点 (N,3) → 画素 (N,2) と奥行き(cm)。"""
    relative = np.atleast_2d(points) - np.asarray(position)
    depth = relative @ forward
    u = cx + fx * (relative @ right) / depth
    v = cy - fy * (relative @ up) / depth
    return np.stack([u, v], axis=1), depth


def focal_from_fx(fx, width_px):
    """横 36mm のセンサーでの焦点距離 mm。"""
    return fx * FULL_FRAME_W_MM / width_px
