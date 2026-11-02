"""端末の姿勢(ARKit 流)→ UE のカメラ。UE の中でも外でも動くよう、標準の math だけで書く。

T は列順の 16 個(col0=右, col1=上, col2=後ろ, col3=位置 m)。世界は y が上の右手系、m。
世界の (x, y, z) は UE の (x, z, y) の並びで、この入れ替えだけで左手系になる。あとは水平の回転と平行移動。
"""
import math

FULL_FRAME_W_MM = 36.0
IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _swap(v):
    return (v[0], v[2], v[1])


def _mul(rotation, v):
    return tuple(sum(rotation[i][k] * v[k] for k in range(3)) for i in range(3))


def _transpose(rotation):
    return tuple(tuple(rotation[k][i] for k in range(3)) for i in range(3))


def pose_axes(T, rotation=IDENTITY, translation=(0.0, 0.0, 0.0)):
    """T → UE の位置 cm と 前・右・上。"""
    position = _mul(rotation, tuple(c * 100.0 for c in _swap(T[12:15])))
    position = tuple(position[i] + translation[i] for i in range(3))
    forward = _mul(rotation, _swap((-T[8], -T[9], -T[10])))
    right = _mul(rotation, _swap(T[0:3]))
    up = _mul(rotation, _swap(T[4:7]))
    return position, forward, right, up


def axes_to_rotator(forward, right, up):
    """前・右・上 → (pitch, yaw, roll) 度。UE の FRotationMatrix の逆。"""
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, forward[2]))))
    yaw = math.degrees(math.atan2(forward[1], forward[0]))
    roll = math.degrees(math.atan2(-right[2], up[2]))
    return pitch, yaw, roll


def rotator_axes(pitch, yaw, roll):
    sp, cp = math.sin(math.radians(pitch)), math.cos(math.radians(pitch))
    sy, cy = math.sin(math.radians(yaw)), math.cos(math.radians(yaw))
    sr, cr = math.sin(math.radians(roll)), math.cos(math.radians(roll))
    forward = (cp * cy, cp * sy, sp)
    right = (sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp)
    up = (-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp)
    return forward, right, up


def axes_to_T(position, forward, right, up, rotation=IDENTITY, translation=(0.0, 0.0, 0.0)):
    """pose_axes の逆。試しの送り手が使う。"""
    back = _transpose(rotation)
    world = _swap(_mul(back, tuple(position[i] - translation[i] for i in range(3))))
    col0, col1 = _swap(_mul(back, right)), _swap(_mul(back, up))
    col2 = tuple(-c for c in _swap(_mul(back, forward)))
    return (list(col0) + [0.0] + list(col1) + [0.0] + list(col2) + [0.0]
            + [c / 100.0 for c in world] + [1.0])


def camera_from_K(K, width, height):
    """K と画像の大きさ → 焦点距離 mm、センサーの幅と高さ mm(横 36mm に揃える)。"""
    return K[0] * FULL_FRAME_W_MM / width, FULL_FRAME_W_MM, FULL_FRAME_W_MM * height / width


def recenter(T, target_position, target_yaw_deg):
    """今の端末の姿勢が、UE の target_position・水平の向き target_yaw になる (回転, 平行移動) を返す。

    LED の 4 隅の校正が無いときの簡単な合わせ方。高さも target_position に合う。
    """
    forward = _swap((-T[8], -T[9], -T[10]))
    angle = math.radians(target_yaw_deg) - math.atan2(forward[1], forward[0])
    c, s = math.cos(angle), math.sin(angle)
    rotation = ((c, -s, 0.0), (s, c, 0.0), (0.0, 0.0, 1.0))
    moved = _mul(rotation, tuple(v * 100.0 for v in _swap(T[12:15])))
    return rotation, tuple(target_position[i] - moved[i] for i in range(3))


def marker_color(code):
    """印の番号 1〜7 → RGB の 0 か 1。"""
    return (float(code & 1), float((code >> 1) & 1), float((code >> 2) & 1))
