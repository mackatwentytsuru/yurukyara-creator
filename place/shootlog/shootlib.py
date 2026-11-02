"""撮影記録(iPhone アプリ「撮影記録」)のデータを読んで、カメラの位置・向き・画角を扱う共通の道具。

約束(アプリ place/ios/ShootLog と同じ):
  ARKit の世界 … 重力に合わせた右手系、y が上、m。
  T(カメラ→世界) … 4x4。カメラの座標は +x が画像の右、+y が上、-z が前。
  K = [fx, fy, cx, cy] … 画素。原点は画像の左上、y は下向き。
  画素(u, v) と カメラ座標の点 (X, Y, Z)(Z<0): u = cx + fx*X/(-Z)、v = cy - fy*Y/(-Z)。
LED の座標 … 原点は客席から見て LED の左下の角、x が右、y が上、z が客席側。
  角は tl=(0,H,0) tr=(W,H,0) br=(W,0,0) bl=(0,0,0)。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

CORNER_IDS = ["tl", "tr", "br", "bl"]


def mat4(flat) -> np.ndarray:
    """16 個(列順)→ 4x4。"""
    return np.array(flat, dtype=float).reshape(4, 4).T


def led_corners(w: float, h: float) -> dict[str, np.ndarray]:
    return {
        "tl": np.array([0.0, h, 0.0]),
        "tr": np.array([w, h, 0.0]),
        "br": np.array([w, 0.0, 0.0]),
        "bl": np.array([0.0, 0.0, 0.0]),
    }


@dataclass
class Shoot:
    dir: Path
    meta: dict
    frames: list[dict]

    @property
    def width(self) -> int:
        return int(self.meta["stats"]["width"])

    @property
    def height(self) -> int:
        return int(self.meta["stats"]["height"])

    @property
    def video(self) -> Path:
        return self.dir / self.meta.get("videoFile", "video.mov")

    def T(self, i: int) -> np.ndarray:
        return mat4(self.frames[i]["T"])

    def K(self, i: int) -> np.ndarray:
        fx, fy, cx, cy = self.frames[i]["K"]
        return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])


def load_shoot(path: str | Path) -> Shoot:
    d = Path(path)
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    frames = [json.loads(line) for line in (d / "frames.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    return Shoot(d, meta, frames)


def project(T_cam_to_world: np.ndarray, K4: list[float] | np.ndarray, pts_world: np.ndarray):
    """世界の点(N,3)→ 画素(N,2) と 奥行き(前に正)。カメラの後ろの点は奥行きが負。"""
    fx, fy, cx, cy = K4
    inv = np.linalg.inv(T_cam_to_world)
    p = (inv[:3, :3] @ pts_world.T).T + inv[:3, 3]
    depth = -p[:, 2]
    safe = np.where(np.abs(depth) < 1e-9, 1e-9, depth)
    u = cx + fx * p[:, 0] / safe
    v = cy - fy * p[:, 1] / safe
    return np.stack([u, v], axis=1), depth


def rot_y(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rigid(R: np.ndarray, t: np.ndarray) -> np.ndarray:
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = t
    return M


def apply(M: np.ndarray, pts: np.ndarray) -> np.ndarray:
    pts = np.atleast_2d(pts)
    return (M[:3, :3] @ pts.T).T + M[:3, 3]


def invert_rigid(M: np.ndarray) -> np.ndarray:
    R = M[:3, :3]
    out = np.eye(4)
    out[:3, :3] = R.T
    out[:3, 3] = -R.T @ M[:3, 3]
    return out


def intrinsics_to_fov_deg(K4, width: int, height: int) -> tuple[float, float]:
    fx, fy, _, _ = K4
    return (float(np.degrees(2 * np.arctan(width / (2 * fx)))), float(np.degrees(2 * np.arctan(height / (2 * fy)))))


def focal_mm_35(K4, width: int) -> float:
    """35mm 判換算(横 36mm)の焦点距離。"""
    return float(K4[0] * 36.0 / width)


# ---- UE への書き出し ---------------------------------------------------------------

def led_to_ue_matrix(origin_cm, yaw_deg: float) -> np.ndarray:
    """LED の座標(m)→ UE の座標(cm、左手系、Z が上、X が前)の 4x4。

    origin_cm … LED の左下の角(客席から見て)の UE での位置(cm)。
    yaw_deg … 客席から見た LED の「右」が向く向き(UE の Yaw、+X から +Y へ測る)。
    LED の客席側(z)は、右 R と上 U から  A = U × R(成分の式)で決まる。
    """
    yaw = np.radians(yaw_deg)
    R = np.array([np.cos(yaw), np.sin(yaw), 0.0])
    U = np.array([0.0, 0.0, 1.0])
    A = np.cross(U, R)
    M = np.eye(4)
    M[:3, 0] = R * 100.0
    M[:3, 1] = U * 100.0
    M[:3, 2] = A * 100.0
    M[:3, 3] = np.asarray(origin_cm, dtype=float)
    return M


def ue_camera_row(T_cam_in_led: np.ndarray, K4, width: int, height: int, led_to_ue: np.ndarray) -> dict:
    """LED の座標でのカメラの姿勢(ARKit 流の軸)→ UE のカメラの位置と向き、画角、焦点距離。"""
    pos = apply(led_to_ue, T_cam_in_led[:3, 3])[0]
    lin = led_to_ue[:3, :3] / 100.0   # 向きの変換(長さを 1 に戻す)
    fwd = lin @ (-T_cam_in_led[:3, 2])
    up = lin @ T_cam_in_led[:3, 1]
    right = lin @ T_cam_in_led[:3, 0]
    fwd /= np.linalg.norm(fwd)
    yaw = np.degrees(np.arctan2(fwd[1], fwd[0]))
    pitch = np.degrees(np.arcsin(np.clip(fwd[2], -1, 1)))
    # ロール: 水平な右 h(= Z × f)と、カメラの右とのなす角(f まわり)
    h = np.cross([0.0, 0.0, 1.0], fwd)
    nh = np.linalg.norm(h)
    if nh < 1e-6:
        roll = 0.0
    else:
        h /= nh
        roll = float(np.degrees(np.arctan2(np.dot(np.cross(h, right), fwd), np.dot(h, right))))
    hfov, vfov = intrinsics_to_fov_deg(K4, width, height)
    return {
        "ue_x_cm": pos[0], "ue_y_cm": pos[1], "ue_z_cm": pos[2],
        "ue_pitch_deg": pitch, "ue_yaw_deg": yaw, "ue_roll_deg": roll,
        "hfov_deg": hfov, "vfov_deg": vfov, "focal_mm_35": focal_mm_35(K4, width),
    }
