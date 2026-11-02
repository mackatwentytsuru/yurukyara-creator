"""合成のデータで、位置合わせ(align_led)と重ね合わせ(overlay_room)の計算が合っているか確かめる。
実機の撮影なしで動く(座標の約束の取り違えを見つけるためのもの。ARKit 側の約束そのものは実機で確かめる)。

  python place/shootlog/selftest.py [--room <room.json>] [--out <作業フォルダ>]
家の部屋の窓を LED の代わりにして、仮の ARKit の世界(回転・移動つき)で 10 秒のカメラの動きと映像を作り、
アライメントを解いて、元の変換とどれだけ違うかと、重ね合わせの数字を出す。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

from align_led import align
from overlay_room import draw_overlay, led_frame_from_element, pick_element, project_segments, room_segments, run
from shootlib import apply, invert_rigid, rigid, rot_y


def look_at(eye, target, up=(0, 1, 0)):
    """カメラ→部屋の 4x4(+x 右、+y 上、-z 前)。"""
    eye, target, up = map(lambda v: np.asarray(v, float), (eye, target, up))
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = r, u, -f, eye
    return M


def flat(M):
    return [float(v) for v in M.T.reshape(-1)]


def make_shoot(room, out: Path, seed=7):
    rng = np.random.default_rng(seed)
    el = pick_element(room, "window:0")
    T_room_from_led, w, h = led_frame_from_element(room, el)
    T_room_from_world = rigid(rot_y(np.radians(37)), np.array([1.3, -0.2, -0.8]))
    T_world_from_room = invert_rigid(T_room_from_world)

    W, H = 960, 540
    fx = fy = 0.85 * W
    K = [fx, fy, W / 2, H / 2]
    segs = room_segments(room)
    centre = apply(T_room_from_led, np.array([w / 2, h / 2, 0]))[0]
    normal = T_room_from_led[:3, 2]

    out.mkdir(parents=True, exist_ok=True)
    n, fps = 150, 15
    vw = cv2.VideoWriter(str(out / "video.mov"), cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    frames = []
    for i in range(n):
        s = i / (n - 1)
        eye = centre + normal * (2.4 - 0.8 * s) + np.array([0.9 * np.sin(2 * np.pi * s), 0.1 * np.cos(2 * np.pi * s), 0.6 * np.sin(np.pi * s)])
        eye[1] = centre[1] + 0.15 * np.sin(2 * np.pi * s)
        T_room_cam = look_at(eye, centre + np.array([0.3 * np.sin(3 * s), 0, 0]))
        proj = project_segments(segs, np.linalg.inv(T_room_cam), K, (H, W))
        img = np.full((H, W, 3), 70, np.uint8)
        img = draw_overlay(img, proj, 3)
        img = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)  # 線の色をなくして白黒の輪郭にする
        vw.write(img)
        T_world_cam = T_world_from_room @ T_room_cam
        frames.append({"i": i, "t": 1000 + i / fps, "pts": i / fps, "T": flat(T_world_cam), "K": K, "track": "normal", "ok": True, "exp": 0.01})
    vw.release()
    (out / "frames.jsonl").write_text("\n".join(json.dumps(f) for f in frames) + "\n", encoding="utf-8")

    # 校正: 4 隅それぞれに十字を向けた 4 回の記録(狙いは 0.1° ほどずれる)
    corners = []
    led = {"tl": (0, h, 0), "tr": (w, h, 0), "br": (w, 0, 0), "bl": (0, 0, 0)}
    for k, cid in enumerate(["tl", "tr", "br", "bl"]):
        target = apply(T_room_from_led, np.array(led[cid]))[0]
        eye = centre + normal * 2.6 + np.array([0.3 * (k - 1.5), 0.1 * k, 0])
        T_room_cam = look_at(eye, target)
        # 狙いのずれ
        dtheta = np.radians(0.1) * rng.normal(size=2)
        R = rot_y(dtheta[0]) @ T_room_cam[:3, :3]
        T_room_cam[:3, :3] = R
        T_world_cam = T_world_from_room @ T_room_cam
        origin = T_world_cam[:3, 3]
        fwd = -T_world_cam[:3, 2]
        corners.append({"id": cid, "label": cid, "sessionTime": 990 + k, "videoFrame": None,
                        "camera": {"T": flat(T_world_cam), "K": K, "w": W, "h": H},
                        "rayOrigin": origin.tolist(), "rayDirection": fwd.tolist(), "hit": None, "hitKind": None})
    floor_y = float(apply(T_world_from_room, np.array(room["floors"][0]["transform"][12:15]))[0][1])
    meta = {"format": "camera-pose-log/1", "videoFile": "video.mov", "framesFile": "frames.jsonl",
            "stats": {"frames": n, "width": W, "height": H}, "events": [],
            "calibration": {"floor": {"planeY": floor_y, "sessionTime": 990, "point": None, "planes": [], "camera": corners[0]["camera"]},
                            "corners": corners}}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return T_room_from_world, T_room_from_led, w, h


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--room", default=str(here.parents[1] / "places/room_1102/scan/room.json"))
    ap.add_argument("--out", default=str(Path.home() / "AppData/Local/Temp/shootlog_selftest"))
    a = ap.parse_args()
    room = json.loads(Path(a.room).read_text(encoding="utf-8"))
    out = Path(a.out)
    T_room_from_world, T_room_from_led, w, h = make_shoot(room, out)

    al = align(out, w, h)
    T_led_from_world = np.array(al["T_led_from_world"])
    est = T_room_from_led @ T_led_from_world
    d_t = np.linalg.norm(est[:3, 3] - T_room_from_world[:3, 3]) * 100
    yaw_est = np.degrees(np.arctan2(est[0, 2], est[0, 0]))
    yaw_true = np.degrees(np.arctan2(T_room_from_world[0, 2], T_room_from_world[0, 0]))
    print(f"変換のずれ: 位置 {d_t:.2f} cm、向き {abs((yaw_est - yaw_true + 180) % 360 - 180):.3f}°")
    print("角の再投影誤差(画素):", [c["reprojection_error_px"] for c in al["corners"]])

    rep = run(out, a.room, "window:0", 1.0, out / "overlay")
    print("重ね合わせ:", json.dumps(rep["summary"], ensure_ascii=False))
    ok = d_t < 5 and rep["summary"]["edge_median_px"] is not None and rep["summary"]["edge_median_px"] < 3
    print("合格" if ok else "不合格")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
