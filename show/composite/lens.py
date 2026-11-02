"""レンズの歪みの計算(k1, k2, p1, p2, k3 の形)。UE に依存しない。試しの歪みと、正解との比べに使う。

本物の校正と ST マップは place/shootlog の lens_calib.py が作る(lens_render.py で UE の描き方に直す)。

歪みのない UE の絵を、少し広く描いてから実写の歪みへ写す。歪みは直さない。実写のほうに合わせる。
ST マップ: 実写の 1 画素 (u, v) が、UE の絵の何画素目に当たるか(H, W, 2 の float32)。
"""
import json
from pathlib import Path

import cv2
import numpy as np

FULL_FRAME_W_MM = 36.0
OVERSCAN_MARGIN = 1.01  # 必要な広さに足す余り


def load_lens(path, width=None):
    """レンズの json を読む。width を渡すと、その幅の画素に直す。"""
    lens = json.loads(Path(path).read_text(encoding="utf-8"))
    return scale_lens(lens, width) if width else lens


def scale_lens(lens, width):
    scale = width / lens["width"]
    fx, fy, cx, cy = lens["K"]
    return {**lens, "width": int(width), "height": int(round(lens["height"] * scale)),
            "K": [fx * scale, fy * scale, cx * scale, cy * scale]}


def camera_matrix(lens):
    fx, fy, cx, cy = lens["K"]
    return np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]])


def undistort_normalized(lens):
    """実写の全画素 → 歪みのない正規化の座標 (H, W, 2)。"""
    width, height = lens["width"], lens["height"]
    grid = np.stack(np.meshgrid(np.arange(width, dtype=np.float64), np.arange(height, dtype=np.float64)), axis=-1)
    flat = grid.reshape(-1, 1, 2)
    normalized = cv2.undistortPoints(flat, camera_matrix(lens), np.array(lens["dist"], dtype=np.float64),
                                     criteria=(cv2.TERM_CRITERIA_COUNT + cv2.TERM_CRITERIA_EPS, 40, 1e-9))
    return normalized.reshape(height, width, 2)


def distort_normalized(points, dist):
    """歪みのない正規化の座標 (N, 2) → 歪んだ正規化の座標 (N, 2)。"""
    k1, k2, p1, p2, k3 = dist
    x, y = points[:, 0], points[:, 1]
    r2 = x * x + y * y
    radial = 1.0 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2
    return np.stack([x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x),
                     y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y], axis=1)


def distorted_pixels(normalized, lens):
    """歪みのない正規化の座標 → 実写の画素。"""
    fx, fy, cx, cy = lens["K"]
    d = distort_normalized(normalized, lens["dist"])
    return np.stack([cx + fx * d[:, 0], cy + fy * d[:, 1]], axis=1)


def required_overscan(normalized, lens):
    """実写の全画素が UE の絵に入るのに要る、横と縦の広げる割合(中心は UE の絵の真ん中)。"""
    fx, fy = lens["K"][:2]
    half_w = np.abs(normalized[..., 0]).max() * fx
    half_h = np.abs(normalized[..., 1]).max() * fx
    return float(max(half_w / (lens["width"] / 2.0), half_h / (lens["height"] / 2.0)))


def ue_camera(lens, overscan):
    """UE で描く大きさとカメラ。焦点距離はそのままで、センサーと画素を同じ割合で広げる。"""
    width, height = lens["width"], lens["height"]
    render_w = int(np.ceil(width * overscan / 2.0) * 2)
    render_h = int(np.ceil(height * overscan / 2.0) * 2)
    sensor_w = FULL_FRAME_W_MM * render_w / width
    return {"render_w": render_w, "render_h": render_h, "overscan": render_w / width,
            "sensor_w_mm": sensor_w, "sensor_h_mm": sensor_w * render_h / render_w,
            "focal_mm": lens["K"][0] * FULL_FRAME_W_MM / width}


def st_map(lens, camera):
    """実写の画素 → UE の絵の画素の表(H, W, 2)。UE の画素の縦横は同じ大きさなので、縦も fx で掛ける。"""
    normalized = undistort_normalized(lens)
    fx = lens["K"][0]
    mapped = np.empty(normalized.shape, dtype=np.float32)
    mapped[..., 0] = normalized[..., 0] * fx + camera["render_w"] / 2.0 - 0.5
    mapped[..., 1] = normalized[..., 1] * fx + camera["render_h"] / 2.0 - 0.5
    return mapped


def apply_st(image, table):
    """UE の絵に ST マップをかけ、実写と同じ歪みの絵にする。"""
    return cv2.remap(image, table[..., 0], table[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
