"""三脚の固定撮影の保険: LED の 12 の隅の画素から、カメラの位置・向き・焦点距離を解き、記録と同じ形にする。

12 点の json: {"width": 1920, "height": 1080, "A": {"tl": [u, v], "tr": [...], "br": [...], "bl": [...]}, "B": {...}, "C": {...}}
使い方: python solve_tripod.py <動画か写真> <12 点の json> --out <撮影フォルダ> [--seconds 秒] [--lens lens_a7.json]

--lens があれば、校正した K と歪みを渡して位置と向きだけを解く(歪みのある画素のまま)。
無ければ、焦点距離は再投影の誤差が一番小さくなる値を探す。出力は import_shoot.py でそのまま読める。
世界は UE の座標を y が上の右手系に並べ替えた物(m)。alignment_<面>.json も同じ世界で書く。
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import minimize_scalar

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "ue")]

from lens import camera_matrix, load_lens  # noqa: E402
from shoot_track import FACE_ENDS, face_size_m, model_corners  # noqa: E402

CORNER_ORDER = ["tl", "tr", "br", "bl"]
FOCAL_RANGE = (0.3, 3.0)  # 画像の幅に対する焦点距離の探す範囲
FPS = 30


def ue_to_world(points_cm):
    """UE (x, y, z) cm → 世界 (x, z, y) m(右手系、y が上)。"""
    return np.atleast_2d(points_cm)[:, [0, 2, 1]] / 100.0


def gather_points(picked):
    world, pixels, owners = [], [], []
    for face in FACE_ENDS:
        if face not in picked:
            continue
        for corner_id, corner in zip(CORNER_ORDER, model_corners(face)):
            world.append(ue_to_world(corner)[0])
            pixels.append(picked[face][corner_id])
            owners.append(face)
    return np.array(world, dtype=np.float64), np.array(pixels, dtype=np.float64), owners


def cv_camera(fx, width, height):
    return np.array([[fx, 0.0, width / 2.0], [0.0, fx, height / 2.0], [0.0, 0.0, 1.0]])


def solve_at(world, pixels, fx, width, height):
    done, rvec, tvec = cv2.solvePnP(world, pixels, cv_camera(fx, width, height), None, flags=cv2.SOLVEPNP_SQPNP)
    if not done:
        return None, None, np.inf
    rvec, tvec = cv2.solvePnPRefineLM(world, pixels, cv_camera(fx, width, height), None, rvec, tvec)
    projected, _ = cv2.projectPoints(world, rvec, tvec, cv_camera(fx, width, height), None)
    errors = np.linalg.norm(projected[:, 0, :] - pixels, axis=1)
    return rvec, tvec, errors


def camera_to_world(rvec, tvec):
    """OpenCV のカメラ(+x 右、+y 下、+z 前)を、記録のカメラ(+x 右、+y 上、-z 前)の 4x4 に直す。"""
    rotation, _ = cv2.Rodrigues(rvec)
    matrix = np.eye(4)
    matrix[:3, :3] = rotation.T @ np.diag([1.0, -1.0, -1.0])
    matrix[:3, 3] = (-rotation.T @ tvec)[:, 0]
    return matrix


def solve_with_lens(world, pixels, lens):
    """校正した K と歪みで解く。戻り: 焦点距離、4x4、点ごとの誤差。"""
    matrix_k, dist = camera_matrix(lens), np.array(lens["dist"], dtype=np.float64)
    done, rvec, tvec = cv2.solvePnP(world, pixels, matrix_k, dist, flags=cv2.SOLVEPNP_SQPNP)
    if not done:
        raise RuntimeError("解けない")
    rvec, tvec = cv2.solvePnPRefineLM(world, pixels, matrix_k, dist, rvec, tvec)
    projected, _ = cv2.projectPoints(world, rvec, tvec, matrix_k, dist)
    return lens["K"][0], camera_to_world(rvec, tvec), np.linalg.norm(projected[:, 0, :] - pixels, axis=1)


def solve(world, pixels, width, height):
    """焦点距離を探して解く。戻り: 焦点距離(画素)、カメラ→世界の 4x4(+x 右、+y 上、-z 前)、点ごとの誤差。"""
    def cost(ratio):
        _, _, errors = solve_at(world, pixels, ratio * width, width, height)
        return float(np.mean(np.square(errors)))

    best = minimize_scalar(cost, bounds=FOCAL_RANGE, method="bounded", options={"xatol": 1e-4})
    fx = float(best.x * width)
    rvec, tvec, errors = solve_at(world, pixels, fx, width, height)
    return fx, camera_to_world(rvec, tvec), errors


def video_seconds(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, stdin=subprocess.DEVNULL)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def write_shoot(out, source, fx, matrix, width, height, seconds, picked):
    out.mkdir(parents=True, exist_ok=True)
    flat = [float(v) for v in matrix.T.reshape(-1)]
    count = max(int(round(seconds * FPS)), 2)
    with open(out / "frames.jsonl", "w", encoding="utf-8") as f:
        for index in range(count):
            f.write(json.dumps({"i": index, "t": index / FPS, "pts": index / FPS, "T": flat,
                                "K": [fx, fx, width / 2.0, height / 2.0], "track": "normal", "ok": True}) + "\n")
    meta = {"videoFile": Path(source).name, "framesFile": "frames.jsonl",
            "stats": {"frames": count, "width": width, "height": height}, "events": [],
            "calibration": {"corners": []}, "solvedFromPixels": True}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    for face in picked:
        if face not in FACE_ENDS:
            continue
        led_width, led_height = face_size_m(face)
        corners = ue_to_world(model_corners(face))
        origin = corners[3]  # 左下
        x_axis = (corners[2] - corners[3]) / led_width
        y_axis = np.array([0.0, 1.0, 0.0])
        z_axis = np.cross(x_axis, y_axis)
        world_from_led = np.eye(4)
        world_from_led[:3, 0], world_from_led[:3, 1], world_from_led[:3, 2], world_from_led[:3, 3] = (
            x_axis, y_axis, z_axis, origin)
        (out / f"alignment_{face}.json").write_text(json.dumps({
            "face": face, "led_size_m": [led_width, led_height], "T_world_from_led": world_from_led.tolist(),
            "T_led_from_world": np.linalg.inv(world_from_led).tolist()}, indent=1), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("points", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seconds", type=float)
    parser.add_argument("--lens", type=Path, help="calibrate_lens.py の結果")
    args = parser.parse_args()
    picked = json.loads(args.points.read_text(encoding="utf-8"))
    width, height = int(picked["width"]), int(picked["height"])
    world, pixels, owners = gather_points(picked)
    if len(world) < 6:
        raise SystemExit("点が足りない(焦点距離も解くので 6 点以上)")
    if args.lens:
        fx, matrix, errors = solve_with_lens(world, pixels, load_lens(args.lens, width))
    else:
        fx, matrix, errors = solve(world, pixels, width, height)
    seconds = args.seconds if args.seconds else video_seconds(args.source)
    write_shoot(args.out, args.source, fx, matrix, width, height, seconds or 1.0, picked)
    by_face = {f: round(float(np.mean([e for e, o in zip(errors, owners) if o == f])), 2) for f in sorted(set(owners))}
    print(json.dumps({"fx_px": round(fx, 2), "mm35": round(fx * 36.0 / width, 2),
                      "camera_ue_cm": [round(float(v), 1) for v in (matrix[0, 3] * 100, matrix[2, 3] * 100, matrix[1, 3] * 100)],
                      "error_px_mean": round(float(errors.mean()), 3), "error_px_max": round(float(errors.max()), 3),
                      "error_px_by_face": by_face}, ensure_ascii=False))


if __name__ == "__main__":
    main()
