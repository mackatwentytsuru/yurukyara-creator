"""撮影の記録を UE のカメラの動きにする(UE に依存しない計算)。

LED の面の 4 隅で、記録の世界(y が上、右手系、m)→ UE(Z が上、左手系、cm)の変換を 1 つ求める。
面ごとの残差で、本物と UE の配置の違いが分かる。切れたコマは補間で埋め、30p に直す。
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation, Slerp

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "place" / "shootlog"), str(ROOT / "show" / "ue"), str(Path(__file__).resolve().parent)]

from align_led import align  # noqa: E402
from shootlib import CORNER_IDS, led_corners, load_shoot, mat4  # noqa: E402
from stage_layout import (A_X0, A_X1, B_X_HALF, B_Y, C_CURVE_MEASURED, C_FLAT_X0, LED_HEIGHT,  # noqa: E402
                          LED_Z_BOTTOM)
from ue_axes import axes_to_rotator, focal_from_fx  # noqa: E402

FPS = 30
# 面の左端と右端の UE の位置(x, y)cm。C は曲がるので、4 隅は端と端を結ぶ平らな板とみなす
FACE_ENDS = {
    "A": ((A_X0, 0.0), (A_X1, 0.0)),
    "B": ((-B_X_HALF, B_Y), (B_X_HALF, B_Y)),
    "C": ((C_FLAT_X0, 0.0), C_CURVE_MEASURED[-1]),
}


def face_size_m(face):
    (x0, y0), (x1, y1) = FACE_ENDS[face]
    return float(np.hypot(x1 - x0, y1 - y0) / 100.0), LED_HEIGHT / 100.0


def model_corners(face):
    """面の 4 隅(tl, tr, br, bl の順)の UE の位置 cm。"""
    (x0, y0), (x1, y1) = FACE_ENDS[face]
    top, bottom = LED_Z_BOTTOM + LED_HEIGHT, LED_Z_BOTTOM
    return np.array([[x0, y0, top], [x1, y1, top], [x1, y1, bottom], [x0, y0, bottom]])


def load_alignment(shoot_dir, face):
    """alignment_<面>.json があれば読む。無ければ記録の 4 隅から解いて書く。"""
    path = Path(shoot_dir) / f"alignment_{face}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    width, height = face_size_m(face)
    result = align(shoot_dir, width, height, face=face)
    path.write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    return result


def world_corners(alignment, face="A"):
    width, height = alignment.get("led_size_m") or face_size_m(face)
    corners = led_corners(width, height)
    matrix = np.array(alignment["T_world_from_led"])
    points = np.array([corners[i] for i in CORNER_IDS])
    return (matrix[:3, :3] @ points.T).T + matrix[:3, 3]


def fit_world_to_ue(world_points, ue_points):
    """重力は合っているので、未知数は水平の回転と平行移動だけ。戻り値は (3x3 の回転の行列, 平行移動 cm)。

    世界の (x, y, z) は UE の (x, z, y) の並びになる(この入れ替えで右手系が左手系に変わる)。
    """
    swapped = world_points[:, [0, 2, 1]] * 100.0
    source = swapped[:, :2] - swapped[:, :2].mean(axis=0)
    target = ue_points[:, :2] - ue_points[:, :2].mean(axis=0)
    cross = (source[:, 0] * target[:, 1] - source[:, 1] * target[:, 0]).sum()
    dot = (source * target).sum()
    angle = np.arctan2(cross, dot)
    c, s = np.cos(angle), np.sin(angle)
    rotation = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
    translation = ue_points.mean(axis=0) - rotation @ swapped.mean(axis=0)
    return rotation, translation


def to_ue_points(points, rotation, translation):
    return (rotation @ (np.atleast_2d(points)[:, [0, 2, 1]] * 100.0).T).T + translation


def align_stage(shoot_dir, faces):
    """面ごとの残差つきで、世界 → UE の変換を求める。"""
    world, model, owners = [], [], []
    for face in faces:
        world.append(world_corners(load_alignment(shoot_dir, face), face))
        model.append(model_corners(face))
        owners += [face] * 4
    world, model = np.vstack(world), np.vstack(model)
    rotation, translation = fit_world_to_ue(world, model)
    errors = to_ue_points(world, rotation, translation) - model
    owners = np.array(owners)
    report = {}
    for face in faces:
        part = errors[owners == face]
        report[face] = {"mean_cm": round(float(np.linalg.norm(part, axis=1).mean()), 2),
                        "max_cm": round(float(np.linalg.norm(part, axis=1).max()), 2),
                        "shift_cm": [round(float(v), 2) for v in part.mean(axis=0)]}
    return rotation, translation, report


def frame_pose(frame, rotation, translation):
    """1 コマ → UE の位置と、前・右・上を列に並べた行列。"""
    matrix = mat4(frame["T"])

    def swap(vector):
        return rotation @ vector[[0, 2, 1]]

    return (to_ue_points(matrix[:3, 3], rotation, translation)[0],
            np.column_stack([swap(-matrix[:3, 2]), swap(matrix[:3, 0]), swap(matrix[:3, 1])]))


def tracking_gaps(frames):
    """ok:false の続く区間を (始め秒, 終わり秒) で返す。"""
    gaps, start = [], None
    for frame in frames:
        if not frame["ok"] and start is None:
            start = frame["pts"]
        elif frame["ok"] and start is not None:
            gaps.append([round(start, 3), round(frame["pts"], 3)])
            start = None
    if start is not None:
        gaps.append([round(start, 3), round(frames[-1]["pts"], 3)])
    return gaps


def resample(frames, rotation, translation, width, fixed_focal=None):
    """ok のコマだけから、30p の位置・向き・焦点距離を作る(切れた所は前後の補間で埋まる)。

    fixed_focal(mm)があれば、記録の K でなくこの値を使う(記録の端末と撮るカメラのレンズが違うとき)。
    """
    good = [f for f in frames if f["ok"]]
    if len(good) < 2:
        raise RuntimeError("追跡できたコマが 2 つより少ない")
    pts = np.array([f["pts"] for f in good])
    poses = [frame_pose(f, rotation, translation) for f in good]
    positions = np.array([p for p, _ in poses])
    slerp = Slerp(pts, Rotation.from_matrix(np.array([m for _, m in poses])))
    fx = np.array([f["K"][0] for f in good])
    times = np.arange(0.0, frames[-1]["pts"] + 1e-6, 1.0 / FPS)
    clipped = np.clip(times, pts[0], pts[-1])
    matrices = slerp(clipped).as_matrix()
    interpolated = np.column_stack([np.interp(clipped, pts, positions[:, k]) for k in range(3)])
    rotators = np.array([axes_to_rotator(m[:, 0], m[:, 1], m[:, 2]) for m in matrices])
    rotators[:, 1] = np.degrees(np.unwrap(np.radians(rotators[:, 1])))
    return [{"f": i, "x": float(p[0]), "y": float(p[1]), "z": float(p[2]), "pitch": float(r[0]), "yaw": float(r[1]),
             "roll": float(r[2]), "focal": float(fixed_focal if fixed_focal else focal_from_fx(np.interp(t, pts, fx), width))}
            for i, (p, r, t) in enumerate(zip(interpolated, rotators, clipped))]


def assemble_camera_shoot(out, frames_jsonl, phone_shoot, alignment_board, image_size):
    """別のカメラの動き(記録と同じ形の jsonl)を、読み込める撮影フォルダにする。

    世界は記録の端末と同じ。A 面は盤の位置合わせ、ほかの面は端末で記録した 4 隅を使う。
    """
    out, phone_shoot = Path(out), Path(phone_shoot)
    out.mkdir(parents=True, exist_ok=True)
    (out / "frames.jsonl").write_text(Path(frames_jsonl).read_text(encoding="utf-8"), encoding="utf-8")
    meta = json.loads((phone_shoot / "meta.json").read_text(encoding="utf-8"))
    corners = [c for c in meta.get("calibration", {}).get("corners", []) if c.get("face", "A") != "A"]
    meta = {**meta, "stats": {**meta.get("stats", {}), "width": image_size[0], "height": image_size[1]},
            "calibration": {**meta.get("calibration", {}), "corners": corners}}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "alignment_A.json").write_text(Path(alignment_board).read_text(encoding="utf-8"), encoding="utf-8")
    return out


def build_track(shoot_dir, faces=None, ue_camera=None):
    """撮影フォルダ → UE に渡すカメラの動きの dict。

    ue_camera は make_stmap.py の stmap.json の中身。あれば、レンズの校正の焦点距離と、広げたセンサーを使う。
    """
    shoot = load_shoot(shoot_dir)
    corners = shoot.meta.get("calibration", {}).get("corners", [])
    found = [f for f in "ABC" if any(c.get("face", "A") == f for c in corners)
             or (Path(shoot_dir) / f"alignment_{f}.json").exists()]
    faces = faces or found
    if not faces:
        raise RuntimeError("LED の 4 隅の記録も alignment のファイルも無い")
    rotation, translation, residuals = align_stage(shoot_dir, faces)
    width, height = shoot.width, shoot.height
    first_k = shoot.frames[0]["K"]
    sensor = (ue_camera["sensor_w_mm"], ue_camera["sensor_h_mm"]) if ue_camera else (36.0, 36.0 * height / width)
    fixed_focal = ue_camera["focal_mm"] if ue_camera else None
    return {
        "width": width, "height": height,
        "sensor_w_mm": sensor[0], "sensor_h_mm": sensor[1],
        "principal_offset_px": [float(first_k[2] - width / 2.0), float(first_k[3] - height / 2.0)],
        "faces": faces, "residuals": residuals, "tracking_gaps_sec": tracking_gaps(shoot.frames),
        "world_to_ue": {"rotation": rotation.tolist(), "translation_cm": translation.tolist()},
        "rows": resample(shoot.frames, rotation, translation, width, fixed_focal),
    }
