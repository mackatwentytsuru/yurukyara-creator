"""撮影のはじめに記録した LED の 4 隅(十字を合わせたときのレイ)から、
ARKit の世界 → LED の座標への変換を求める。

  python place/shootlog/align_led.py <撮影フォルダ> --led-size <横m> <縦m> [--out alignment.json]

考え方: LED は垂直な長方形(寸法は既知)。ARKit の世界は重力に合わせてあるので、未知数は
LED の向き(y まわりの回転 θ)と位置 t の 4 つだけ。4 つの角それぞれについて「角の予想位置とレイの距離」を小さくする。
レイが当たった点(hit)は、初期値と確かめの数字にだけ使う(LED は光る面なので当たりがずれやすい)。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from shootlib import CORNER_IDS, apply, invert_rigid, led_corners, load_shoot, project, rigid, rot_y, mat4


def _ray_residuals(params, pts_led, origins, dirs):
    theta, tx, ty, tz = params
    q = (rot_y(theta) @ pts_led.T).T + np.array([tx, ty, tz])
    d = q - origins
    along = np.sum(d * dirs, axis=1, keepdims=True)
    perp = d - along * dirs
    # 角がカメラの後ろに来る解を避ける(前方になる解を強く好む)
    behind = np.clip(-along[:, 0], 0, None)
    return np.concatenate([perp.ravel(), behind * 10.0])


def _free_residuals(params, origins, dirs):
    theta, tx, ty, tz, w, h = params
    led = led_corners(abs(w), abs(h))
    pts = np.array([led[i] for i in CORNER_IDS])
    return _ray_residuals([theta, tx, ty, tz], pts, origins, dirs)[:12]


def refine_free_size(corners, x0, w, h):
    """寸法(横・縦)も未知にして解き直す。戻り: (横, 縦, 横の標準偏差, 縦の標準偏差, theta, t)。
    標準偏差は、レイの向きの狙いずれ 0.1°(距離に比例)を仮定した見積もり。角を記録した位置が近いと大きくなる。"""
    origins = np.array([c["rayOrigin"] for c in corners], dtype=float)
    dirs = np.array([c["rayDirection"] for c in corners], dtype=float)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    r = least_squares(_free_residuals, [*x0, w, h], args=(origins, dirs), method="lm")
    dist = np.linalg.norm(np.array(corners[0]["rayOrigin"]) - np.array(r.x[1:4]), axis=0)
    sigma = np.radians(0.1) * max(dist, 1.0)
    try:
        cov = np.linalg.inv(r.jac.T @ r.jac) * sigma**2
        sw, sh = float(np.sqrt(abs(cov[4, 4]))), float(np.sqrt(abs(cov[5, 5])))
    except np.linalg.LinAlgError:
        sw = sh = float("inf")
    return abs(float(r.x[4])), abs(float(r.x[5])), sw, sh, r.x[0], r.x[1:4]


def solve(corners: list[dict], w: float, h: float):
    led = led_corners(w, h)
    pts = np.array([led[c["id"]] for c in corners])
    origins = np.array([c["rayOrigin"] for c in corners], dtype=float)
    dirs = np.array([c["rayDirection"] for c in corners], dtype=float)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)

    best = None
    mean_dir = dirs.mean(axis=0)
    for theta0 in np.linspace(0, 2 * np.pi, 12, endpoint=False):
        for dist in (2.0, 5.0, 10.0):
            centre = origins.mean(axis=0) + mean_dir * dist
            t0 = centre - rot_y(theta0) @ pts.mean(axis=0)
            r = least_squares(_ray_residuals, [theta0, *t0], args=(pts, origins, dirs), method="lm")
            cost = float(np.sum(r.fun**2))
            # 客席側(z+)の向きが、カメラのほうを向く解だけ採る(LED は客席に向かって光る)
            R = rot_y(r.x[0])
            normal = R @ np.array([0, 0, 1.0])
            facing = float(np.dot(normal, -mean_dir))
            if facing <= 0:
                continue
            if best is None or cost < best[0]:
                best = (cost, r.x, normal)
    if best is None:
        raise RuntimeError("LED の向きが決まらなかった(角を記録したカメラの向きを確かめる)")
    return best[1]


def align(shoot_dir: str | Path, w: float, h: float, face: str = "A", free_size: bool = False) -> dict:
    shoot = load_shoot(shoot_dir)
    cal = shoot.meta["calibration"]
    corners = {c["id"]: c for c in cal["corners"] if c.get("face", "A") == face}
    missing = [i for i in CORNER_IDS if i not in corners]
    if missing:
        raise SystemExit(f"LED の面 {face} の角が足りない: {missing}")
    ordered = [corners[i] for i in CORNER_IDS]
    theta, tx, ty, tz = solve(ordered, w, h)
    size_est = None
    if free_size:
        ew, eh, sw, sh, th2, t2 = refine_free_size(ordered, [theta, tx, ty, tz], w, h)
        size_est = {"width_m": round(ew, 3), "height_m": round(eh, 3), "aspect_w_over_h": round(ew / eh, 4),
                    "width_std_m": round(sw, 3), "height_std_m": round(sh, 3),
                    "given_aspect_w_over_h": round(w / h, 4),
                    "note": "std は狙いずれ 0.1° を仮定した見積もり。大きい(数 cm 以上)ときは、角を記録するカメラの位置をもっと離して撮り直す。変換(T)は与えた寸法で解いたもの。"}
    T_world_from_led = rigid(rot_y(theta), np.array([tx, ty, tz]))
    T_led_from_world = invert_rigid(T_world_from_led)

    led = led_corners(w, h)
    report = []
    for c in ordered:
        pts_world = apply(T_world_from_led, led[c["id"]])
        cam = c["camera"]
        px, depth = project(mat4(cam["T"]), cam["K"], pts_world)
        centre = np.array([cam["w"] / 2, cam["h"] / 2])
        err_px = float(np.linalg.norm(px[0] - centre))
        row = {"id": c["id"], "reprojection_error_px": round(err_px, 2), "distance_m": round(float(depth[0]), 3)}
        if c.get("hit"):
            row["hit_distance_cm"] = round(float(np.linalg.norm(np.array(c["hit"]) - pts_world[0])) * 100, 1)
        report.append(row)

    floor = cal.get("floor")
    out = {
        "face": face,
        "led_size_m": [w, h],
        "T_world_from_led": T_world_from_led.tolist(),
        "T_led_from_world": T_led_from_world.tolist(),
        "yaw_deg": float(np.degrees(theta)),
        "led_origin_world": [tx, ty, tz],
        "led_bottom_above_floor_m": None if not floor else round(float(ty - floor["planeY"]), 3),
        "corners": report,
        "max_reprojection_error_px": max(r["reprojection_error_px"] for r in report),
        "estimated_size": size_est,
        "notes": "reprojection_error_px は十字(画像の中心)と、解いた角の位置との画素差。hit_distance_cm は ARKit のレイが当たった点との差(参考)。",
    }
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shoot_dir")
    ap.add_argument("--led-size", nargs=2, type=float, required=True, metavar=("W_M", "H_M"))
    ap.add_argument("--face", default="A", help="LED の面(A・B・C。客席から見て左から)。1面の撮影は A")
    ap.add_argument("--free-size", action="store_true", help="寸法も未知にして解き直し、結果の横・縦・縦横比を出す(本物の寸法の確かめ用)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    out = align(a.shoot_dir, *a.led_size, face=a.face, free_size=a.free_size)
    dest = Path(a.out) if a.out else Path(a.shoot_dir) / f"alignment_{a.face}.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"書いた: {dest}")
    print(f"LED の向き yaw {out['yaw_deg']:.1f}°、左下の角(世界) {np.round(out['led_origin_world'], 3).tolist()}、床からの高さ {out['led_bottom_above_floor_m']} m")
    if out["estimated_size"]:
        print("推定した寸法:", out["estimated_size"])
    for r in out["corners"]:
        print("  ", r)


if __name__ == "__main__":
    main()
