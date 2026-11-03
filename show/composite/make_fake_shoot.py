"""数字が正解として分かる合成の記録を作る(実機の記録と同じ形)。

UE の座標で決めた「正解のカメラ」を、乱数で回した仮の世界(y が上、右手系、m)の記録に直す。
レベルで撮る絵は正解のカメラのキーで撮り、合成は記録から読んだカメラで撮るので、2 つの差で道具の誤差が測れる。

使い方: python make_fake_shoot.py <出力フォルダ> [--seconds 20] [--still]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "ue")]

from shoot_track import FACE_ENDS, FPS, face_size_m, model_corners  # noqa: E402
from sim_layout import SIM_CAMERAS  # noqa: E402
from ue_axes import axes_to_rotator, rotator_axes  # noqa: E402

WIDTH, HEIGHT = 1920, 1080
WORLD_YAW_DEG = 37.0  # 仮の世界と UE の間の水平の回転
WORLD_SHIFT_CM = np.array([123.0, -45.0, 67.0])
AIM_ERROR_DEG = 0.1  # 4 隅に十字を合わせるときの狙いのずれ
TRACK_LOST = (500.0, 500.3)  # 追跡が切れたことにする秒(今は切らない)
SWAY = {"x": (7.0, 0.13), "y": (4.0, 0.09), "z": (2.5, 0.21), "yaw": (0.5, 0.11), "pitch": (0.35, 0.17),
        "roll": (0.8, 0.07)}  # 片振幅(cm か度)と周波数(Hz)。1 人で持つ、ゆっくりした揺れ
SEED = 20261103


def world_rotation():
    angle = np.radians(WORLD_YAW_DEG)
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def ue_vector_to_world(vector):
    """UE の向き → 仮の世界の向き。"""
    return (world_rotation().T @ vector)[[0, 2, 1]]


def ue_point_to_world(point):
    return ue_vector_to_world(np.asarray(point, dtype=float) - WORLD_SHIFT_CM) / 100.0


def flat_matrix(position_cm, forward, right, up):
    """カメラ→世界の 4x4 を列順の 16 個にする(+x 右、+y 上、-z 前)。"""
    matrix = np.eye(4)
    matrix[:3, 0] = ue_vector_to_world(right)
    matrix[:3, 1] = ue_vector_to_world(up)
    matrix[:3, 2] = -ue_vector_to_world(forward)
    matrix[:3, 3] = ue_point_to_world(position_cm)
    return [float(v) for v in matrix.T.reshape(-1)]


def base_pose(mm35=None):
    spec = SIM_CAMERAS["Sim_Cam1"]
    position = np.array(spec["pos"], dtype=float)
    aim = np.array(spec["target"], dtype=float) - position
    aim /= np.linalg.norm(aim)
    pitch = float(np.degrees(np.arcsin(aim[2])))
    yaw = float(np.degrees(np.arctan2(aim[1], aim[0])))
    return position, pitch, yaw, (mm35 or spec["mm35"]) / 36.0 * WIDTH


def path_offset(path, t):
    """[秒, 横 cm, 奥 cm, 高さ cm, ヨー度, ピッチ度] の並びから、その秒のずれ。"""
    if not path:
        return np.zeros(5)
    keys = np.array(path, dtype=float)
    if t <= keys[0, 0]:
        return keys[0, 1:]
    for a, b in zip(keys, keys[1:]):
        if t < b[0]:
            k = (t - a[0]) / (b[0] - a[0])
            return a[1:] + (b[1:] - a[1:]) * (k * k * (3 - 2 * k))
    return keys[-1, 1:]


def truth_rows(seconds, still, mm35=None, path=None):
    base_position, pitch0, yaw0, fx = base_pose(mm35)
    rows = []
    for index in range(int(seconds * FPS)):
        t = index / FPS
        dx, dy, dz, dyaw, dpitch = path_offset(path, t)
        position = base_position + np.array([dx, dy, dz])
        pitch, yaw = pitch0 + dpitch, yaw0 + dyaw
        wave = {k: 0.0 if still else a * np.sin(2 * np.pi * f * t + i) for i, (k, (a, f)) in enumerate(SWAY.items())}
        rows.append({"f": index, "x": float(position[0] + wave["x"]), "y": float(position[1] + wave["y"]),
                     "z": float(position[2] + wave["z"]), "pitch": pitch + wave["pitch"], "yaw": yaw + wave["yaw"],
                     "roll": float(wave["roll"]), "focal": fx * 36.0 / WIDTH})
    return rows, fx


def make_frames(rows, fx, rng):
    frames = []
    k = [fx, fx, WIDTH / 2.0, HEIGHT / 2.0]
    for row in rows:
        t = row["f"] / FPS
        forward, right, up = rotator_axes(row["pitch"], row["yaw"], row["roll"])
        transform = flat_matrix((row["x"], row["y"], row["z"]), forward, right, up)
        lost = TRACK_LOST[0] <= t < TRACK_LOST[1]
        if lost:  # 切れたコマの値は信用できない。わざとでたらめにする
            transform = [v + float(rng.normal(0, 0.3)) for v in transform]
        frames.append({"i": row["f"], "t": 1000.0 + t, "pts": t, "T": transform, "K": k,
                       "track": "limited:excessiveMotion" if lost else "normal", "ok": not lost, "exp": 0.00833})
    return frames


def corner_records(fx, rng):
    """面ごとに 4 隅へ十字を向けた記録。客席の 3 か所から狙い、狙いは少しずれる。"""
    records = []
    k = [fx, fx, WIDTH / 2.0, HEIGHT / 2.0]
    for face in FACE_ENDS:
        for index, (cid, corner) in enumerate(zip(["tl", "tr", "br", "bl"], model_corners(face))):
            eye = np.array([-300.0 + 300.0 * index, 900.0 + 150.0 * index, 140.0])
            aim = corner - eye
            aim /= np.linalg.norm(aim)
            pitch = float(np.degrees(np.arcsin(aim[2]))) + float(rng.normal(0, AIM_ERROR_DEG))
            yaw = float(np.degrees(np.arctan2(aim[1], aim[0]))) + float(rng.normal(0, AIM_ERROR_DEG))
            forward, right, up = rotator_axes(pitch, yaw, 0.0)
            records.append({"id": cid, "face": face, "label": f"面{face} {cid}", "sessionTime": 990.0, "videoFrame": None,
                            "camera": {"T": flat_matrix(eye, forward, right, up), "K": k, "w": WIDTH, "h": HEIGHT},
                            "rayOrigin": ue_point_to_world(eye).tolist(),
                            "rayDirection": ue_vector_to_world(forward).tolist(), "hit": None, "hitKind": None})
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument("--still", action="store_true", help="三脚の固定カメラ")
    parser.add_argument("--mm35", type=float, help="焦点距離(35mm 判)。無ければ案 1 の値")
    parser.add_argument("--path", type=Path, help="カメラの動きの json: [[秒, 横 cm, 奥 cm, 高さ cm, ヨー度, ピッチ度], ...]")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    path = json.loads(args.path.read_text(encoding="utf-8")) if args.path else None
    rows, fx = truth_rows(args.seconds, args.still, args.mm35, path)
    frames = make_frames(rows, fx, rng)
    (args.out / "frames.jsonl").write_text("\n".join(json.dumps(f) for f in frames) + "\n", encoding="utf-8")
    meta = {"videoFile": "video.mov", "framesFile": "frames.jsonl",
            "stats": {"frames": len(frames), "width": WIDTH, "height": HEIGHT},
            "events": [{"t": 1000.0 + TRACK_LOST[0], "kind": "tracking:limited:excessiveMotion"}],
            "calibration": {"floor": {"planeY": float(ue_point_to_world((0.0, 0.0, 90.0))[1]), "planes": []},
                            "corners": corner_records(fx, rng)}}
    (args.out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "truth.json").write_text(json.dumps({"rows": rows, "fx": fx, "width": WIDTH, "height": HEIGHT,
                                                     "sizes_m": {f: face_size_m(f) for f in FACE_ENDS}}), encoding="utf-8")
    print("wrote", args.out, len(frames), "コマ")


if __name__ == "__main__":
    main()
