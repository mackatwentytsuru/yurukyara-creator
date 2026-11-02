"""撮った動画に、場所スキャン(RoomPlan)で撮った部屋の線を重ねて、ずれを測る。

  python place/shootlog/overlay_room.py <撮影フォルダ> --room <room.json> --led-from window:0 [--every 2.0] [--out <出力フォルダ>]

位置合わせ: 撮影の最初に記録した「LED の 4 隅」を、部屋の中の同じ形の物(窓・ドア・テレビなど)の 4 隅に合わせる。
  --led-from window:0 … room.json の窓の 0 番。ほかに door:N、object:television(カテゴリ名)、wall:N。
  部屋の側(客席側)は、床の中心がある側。
出力: overlay_XXXX.png(重ねた絵)、overlay.mp4(縮小版)、report.json(ずれの数字)。
ずれの数字:
  corner_reprojection_px … 4 隅を記録したコマで、解いた角と十字の画素差(位置合わせそのものの誤差)
  edge_median_px         … 重ねた部屋の「骨組みの線」から、いちばん近い映像の輪郭(Canny)までの距離の中央値。コマごと。
  baseline_median_px     … 同じ線を、わざと 60〜120 画素ずらしたときの同じ数字(これより十分小さければ、線は輪郭に乗っている)
家具や遮る物があるので、絶対値より「ずらしたときとの差」と「時間がたっても増えないか」を見る。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from align_led import align
from shootlib import apply, invert_rigid, load_shoot, mat4, project


# ---- 部屋 --------------------------------------------------------------------------

def _rect(w, h):
    return np.array([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]])


def _box(w, h, d):
    x, y, z = w / 2, h / 2, d / 2
    return np.array([[sx * x, sy * y, sz * z] for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)])


BOX_EDGES = [(0, 1), (1, 3), (3, 2), (2, 0), (4, 5), (5, 7), (7, 6), (6, 4), (0, 4), (1, 5), (2, 6), (3, 7)]


def room_segments(room: dict):
    """部屋の線(世界ではなく RoomPlan の座標)。戻り: [(p0, p1, 種類, 骨組みか)]"""
    segs = []

    def add_rect(el, kind):
        M = mat4(el["transform"])
        w, h = el["dimensions"][0], el["dimensions"][1]
        pts = apply(M, _rect(w, h))
        for i in range(4):
            segs.append((pts[i], pts[(i + 1) % 4], kind, kind in ("wall", "floor", "door", "window", "opening")))

    for kind, key in (("wall", "walls"), ("floor", "floors"), ("door", "doors"), ("window", "windows"), ("opening", "openings")):
        for el in room.get(key, []):
            add_rect(el, kind)
    for el in room.get("objects", []):
        M = mat4(el["transform"])
        w, h, d = el["dimensions"]
        pts = apply(M, _box(w, h, max(d, 0.001)))
        for a, b in BOX_EDGES:
            segs.append((pts[a], pts[b], "object", False))
    return segs


def pick_element(room: dict, spec: str):
    kind, _, which = spec.partition(":")
    if kind == "object":
        els = [e for e in room["objects"] if which in e["category"]]
        if not els:
            raise SystemExit(f"object:{which} が room.json に無い")
        el = els[0]
    else:
        key = {"window": "windows", "door": "doors", "wall": "walls", "opening": "openings"}[kind]
        el = room[key][int(which or 0)]
    return el


def led_frame_from_element(room: dict, el: dict) -> tuple[np.ndarray, float, float]:
    """部屋の物の面を LED の座標系にする。戻り: (T_room_from_led, 横 m, 縦 m)"""
    M = mat4(el["transform"])
    w, h = el["dimensions"][0], el["dimensions"][1]
    d = el["dimensions"][2] if len(el["dimensions"]) > 2 else 0.0
    centre = M[:3, 3].copy()
    n = M[:3, 2] / np.linalg.norm(M[:3, 2])
    floor_c = mat4(room["floors"][0]["transform"])[:3, 3]
    if np.dot(n, floor_c - centre) < 0:
        n = -n
    if d > 0:   # 箱(テレビなど)は、客席側の面にする
        centre = centre + n * d / 2
    up = np.array([0.0, 1.0, 0.0])
    f = -n
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    origin = centre - r * (w / 2) - up * (h / 2)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = r, up, n, origin
    return T, float(w), float(h)


# ---- 描く --------------------------------------------------------------------------

def clip_to_front(p0, p1, near=0.05):
    """カメラ座標(Z<0 が前)の線分を、手前の面で切る。"""
    z0, z1 = -p0[2], -p1[2]
    if z0 < near and z1 < near:
        return None
    if z0 < near:
        p0 = p0 + (p1 - p0) * ((near - z0) / (z1 - z0))
    elif z1 < near:
        p1 = p1 + (p0 - p1) * ((near - z1) / (z0 - z1))
    return p0, p1


def project_segments(segs, T_cam_from_room, K4, size):
    fx, fy, cx, cy = K4
    out = []
    for p0, p1, kind, structural in segs:
        a = T_cam_from_room[:3, :3] @ p0 + T_cam_from_room[:3, 3]
        b = T_cam_from_room[:3, :3] @ p1 + T_cam_from_room[:3, 3]
        c = clip_to_front(a, b)
        if c is None:
            continue
        a, b = c
        uv = [(cx + fx * q[0] / -q[2], cy - fy * q[1] / -q[2]) for q in (a, b)]
        out.append((uv[0], uv[1], kind, structural, -a[2], -b[2]))
    return out


COLORS = {"wall": (255, 200, 0), "floor": (0, 220, 120), "door": (0, 180, 255), "window": (255, 90, 255),
          "opening": (0, 180, 255), "object": (120, 120, 255)}


def draw_overlay(img, proj, thickness=3):
    out = img.copy()
    for (u0, v0), (u1, v1), kind, structural, *_ in proj:
        if max(abs(u0), abs(v0), abs(u1), abs(v1)) > 20000:
            continue
        cv2.line(out, (int(u0), int(v0)), (int(u1), int(v1)), COLORS[kind], thickness if structural else max(1, thickness - 1), cv2.LINE_AA)
    return out


def edge_distance(gray, proj_structural, shift=(0, 0)):
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 120)
    dist = cv2.distanceTransform(255 - edges, cv2.DIST_L2, 3)
    h, w = gray.shape
    vals = []
    for (u0, v0), (u1, v1), kind, structural, d0, d1 in proj_structural:
        n = int(max(abs(u1 - u0), abs(v1 - v0)) / 12) + 1
        for s in np.linspace(0, 1, n + 1):
            u = u0 + (u1 - u0) * s + shift[0]
            v = v0 + (v1 - v0) * s + shift[1]
            if 2 <= u < w - 2 and 2 <= v < h - 2:
                vals.append(dist[int(v), int(u)])
    return (float(np.median(vals)), len(vals)) if len(vals) >= 20 else (None, len(vals))


def run(shoot_dir, room_path, led_from, every, out_dir, max_frames=None):
    shoot = load_shoot(shoot_dir)
    room = json.loads(Path(room_path).read_text(encoding="utf-8"))
    el = pick_element(room, led_from)
    T_room_from_led, w, h = led_frame_from_element(room, el)
    al = align(shoot_dir, w, h)
    T_led_from_world = np.array(al["T_led_from_world"])
    T_room_from_world = T_room_from_led @ T_led_from_world
    T_world_from_room = invert_rigid(T_room_from_world)
    segs = room_segments(room)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(shoot.video))
    n_total = len(shoot.frames)
    scale_w = 1280
    writer = None
    rng = np.random.default_rng(1)
    rows = []
    step = max(1, int(round(every * (n_total / max(shoot.frames[-1]["pts"], 1e-6)))))
    i = 0
    while True:
        ok, img = cap.read()
        if not ok or i >= n_total:
            break
        fr = shoot.frames[i]
        if i % 1 == 0:
            T_cam_from_world = np.linalg.inv(mat4(fr["T"]))
            T_cam_from_room = T_cam_from_world @ T_world_from_room
            proj = project_segments(segs, T_cam_from_room, fr["K"], img.shape[:2])
            over = draw_overlay(img, proj)
            small = cv2.resize(over, (scale_w, int(img.shape[0] * scale_w / img.shape[1])), interpolation=cv2.INTER_AREA)
            label = f"{i:4d}  {fr['pts']:.2f}s  track:{fr['track']}"
            cv2.putText(small, label, (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4, cv2.LINE_AA)
            cv2.putText(small, label, (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
            if writer is None:
                fps = n_total / max(fr["pts"] if n_total == 1 else shoot.frames[-1]["pts"], 1e-6)
                writer = cv2.VideoWriter(str(out / "overlay.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), fps, (small.shape[1], small.shape[0]))
            writer.write(small)
            if i % step == 0:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                structural = [p for p in proj if p[3]]
                med, npts = edge_distance(gray, structural)
                base = []
                if med is not None:
                    for _ in range(6):
                        ang = rng.uniform(0, 2 * np.pi)
                        rad = rng.uniform(60, 120) * img.shape[1] / 3840
                        b, _ = edge_distance(gray, structural, (rad * np.cos(ang), rad * np.sin(ang)))
                        if b is not None:
                            base.append(b)
                rows.append({"frame": i, "time_s": round(fr["pts"], 3), "track": fr["track"], "edge_points": npts,
                             "edge_median_px": None if med is None else round(med, 2),
                             "baseline_median_px": None if not base else round(float(np.median(base)), 2)})
                cv2.imwrite(str(out / f"overlay_{i:04d}.png"), small)
        i += 1
        if max_frames and i >= max_frames:
            break
    cap.release()
    if writer:
        writer.release()

    good = [r for r in rows if r["edge_median_px"] is not None and r["baseline_median_px"] is not None]
    report = {
        "led_from": led_from, "led_size_m": [w, h],
        "alignment": al,
        "corner_reprojection_px": [c["reprojection_error_px"] for c in al["corners"]],
        "samples": rows,
        "summary": {
            "edge_median_px": None if not good else round(float(np.median([r["edge_median_px"] for r in good])), 2),
            "baseline_median_px": None if not good else round(float(np.median([r["baseline_median_px"] for r in good])), 2),
            "frames_measured": len(good),
        },
        "image_width_px": shoot.width,
    }
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shoot_dir")
    ap.add_argument("--room", required=True)
    ap.add_argument("--led-from", default="window:0")
    ap.add_argument("--every", type=float, default=2.0)
    ap.add_argument("--out", default=None)
    ap.add_argument("--max-frames", type=int, default=None)
    a = ap.parse_args()
    out = a.out or str(Path(a.shoot_dir) / "overlay")
    rep = run(a.shoot_dir, a.room, a.led_from, a.every, out, a.max_frames)
    print(json.dumps(rep["summary"], ensure_ascii=False), "位置合わせの誤差(画素):", rep["corner_reprojection_px"])
    print("出力:", out)


if __name__ == "__main__":
    main()
