"""カメラ 2 台の流れを通しで試すための、正解の分かる素材を作る(試し専用)。

正解のカメラ(記録の truth.json)から、次を作る:
  camera.mp4      歪んだ実写の代わり。29.97p、白いフラッシュ入り、音なし
  phone/          記録の端末の撮影フォルダ(frames.jsonl・meta.json・video.mov)。動画は先に録り始めた分だけ遅れる
  rig_offset.json 端末とカメラの固定のずれの正解
  alignment_board.json 世界 → A 面の正解

使い方: python make_chain_trial.py <正解の撮影フォルダ> <歪んだ実写の mp4> <歪みのない実写の mp4> <出力フォルダ>
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "ue")]

from make_fake_shoot import FPS, TRACK_LOST, ue_point_to_world, ue_vector_to_world, flat_matrix  # noqa: E402
from shoot_track import model_corners  # noqa: E402
from ue_axes import rotator_axes  # noqa: E402

PHONE_LEAD_SEC = 2.7  # 端末を先に録り始めた秒
FLASHES_SEC = [1.0, 2.5, 3.2, 5.5, 6.0, 8.5, 12.0]
FLASH_LEN_SEC = 0.2
RIG_TRANSLATION_M = (0.02, 0.12, 0.03)  # カメラの位置を、端末のカメラの座標で
RIG_YAW_DEG, RIG_PITCH_DEG = 1.5, -1.0
CAMERA_RATE = "30000/1001"
PHONE_FX = 1500.0


def rig_matrix():
    yaw, pitch = np.radians(RIG_YAW_DEG), np.radians(RIG_PITCH_DEG)
    cy, sy, cp, sp = np.cos(yaw), np.sin(yaw), np.cos(pitch), np.sin(pitch)
    rotation = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]) @ np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    matrix = np.eye(4)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = RIG_TRANSLATION_M
    return matrix


def flash_filter(shift=0.0):
    enable = "+".join(f"between(t,{t + shift:.3f},{t + shift + FLASH_LEN_SEC:.3f})" for t in FLASHES_SEC)
    return f"drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='{enable}'"


def phone_frames(rows):
    """端末の姿勢 = カメラの姿勢 × ずれの逆。時刻は録り始めの分だけ後ろ。"""
    inverse = np.linalg.inv(rig_matrix())
    frames = []
    for row in rows:
        t = row["f"] / FPS
        forward, right, up = rotator_axes(row["pitch"], row["yaw"], row["roll"])
        camera = np.array(flat_matrix((row["x"], row["y"], row["z"]), forward, right, up)).reshape(4, 4).T
        phone = camera @ inverse
        lost = TRACK_LOST[0] <= t < TRACK_LOST[1]
        frames.append({"i": row["f"], "t": 1000.0 + t + PHONE_LEAD_SEC, "pts": t + PHONE_LEAD_SEC,
                       "T": [float(v) for v in phone.T.reshape(-1)], "K": [PHONE_FX, PHONE_FX, 960.0, 540.0],
                       "track": "limited:excessiveMotion" if lost else "normal", "ok": not lost, "exp": 0.0167})
    return frames


def board_alignment():
    """世界 → A 面の座標の正解(x 右、y 上、z 客席側、原点は左下)。"""
    corners = model_corners("A")
    origin = ue_point_to_world(corners[3])
    x_axis = ue_vector_to_world(np.array([1.0, 0.0, 0.0]))
    y_axis = ue_vector_to_world(np.array([0.0, 0.0, 1.0]))
    z_axis = ue_vector_to_world(np.array([0.0, 1.0, 0.0]))
    world_from_led = np.eye(4)
    world_from_led[:3, 0], world_from_led[:3, 1], world_from_led[:3, 2], world_from_led[:3, 3] = x_axis, y_axis, z_axis, origin
    return {"source": "board", "T_led_from_world": np.linalg.inv(world_from_led).tolist(),
            "T_world_from_led": world_from_led.tolist()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("truth_shoot", type=Path)
    parser.add_argument("distorted", type=Path)
    parser.add_argument("clean", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    phone = args.out / "phone"
    phone.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(args.distorted), "-vf", f"{flash_filter()},fps={CAMERA_RATE}",
                    "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-an", str(args.out / "camera.mp4")],
                   check=True, stdin=subprocess.DEVNULL)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(args.clean), "-vf",
                    f"tpad=start_duration={PHONE_LEAD_SEC}:color=black,{flash_filter(PHONE_LEAD_SEC)},fps={FPS}",
                    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(phone / "video.mov")],
                   check=True, stdin=subprocess.DEVNULL)
    truth = json.loads((args.truth_shoot / "truth.json").read_text(encoding="utf-8"))
    frames = phone_frames(truth["rows"])
    lead = [{**frames[0], "i": i, "t": 1000.0 + i / FPS, "pts": i / FPS} for i in range(int(PHONE_LEAD_SEC * FPS))]
    merged = [{**f, "i": i} for i, f in enumerate(lead + frames)]
    (phone / "frames.jsonl").write_text("\n".join(json.dumps(f) for f in merged) + "\n", encoding="utf-8")
    meta = json.loads((args.truth_shoot / "meta.json").read_text(encoding="utf-8"))
    (phone / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "rig_offset.json").write_text(json.dumps({"T_iphone_from_a7": rig_matrix().tolist()}, indent=1), encoding="utf-8")
    (args.out / "alignment_board.json").write_text(json.dumps(board_alignment(), indent=1), encoding="utf-8")
    print("wrote", args.out, "端末の先行", PHONE_LEAD_SEC, "秒")


if __name__ == "__main__":
    main()
