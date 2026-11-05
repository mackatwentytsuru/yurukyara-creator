"""視線の校正: 「見本のキャラが自分を見ていると感じる向き」を、数点 合わせて、変換の未知数を求める。
状況(提出動画の入口): カメラは LED の一番下の床の近く、キャラの顔は LED の上のほう(カメラの 1〜1.5 m 上)。客はカメラではなく、LED の顔を見る。
  変換 = カメラの画像の顔の位置(画素)・目の間隔(画素) → 客の目の世界の位置 → キャラの目からその位置へ向く方向(yaw・pitch)。
  未知数: カメラの上向きの角度・キャラの目の位置(x, y, z)・校正した人の目の間隔(IPD)。
手順(本人 1 人・数点・数分): 床の数か所(距離 1.5〜3 m・左右)に立つ → そのつど、見本のキャラの向きを動かして「自分を見ている」と感じる所に合わせる
  → (そのときの顔の画素・目の間隔・合わせた向き)を 1 点として記録 → fit() で未知数を求める → gaze_geometry.json に保存。
  python gaze_calib.py --points points.json --geometry gaze_geometry.json --out gaze_geometry.json
  python gaze_calib.py --simulate        (答えの分かる試験: 本当の値から点を作り、ずれた初期値から戻せるかを見る)
points.json: [{"u": 画素, "v": 画素, "ipd_px": 画素, "yaw_deg": 度, "pitch_deg": 度}, ...](u, v は目の中点。5 点以上)
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import replace

import numpy as np

from gaze_bridge import Geometry, gaze_angles, pixel_to_world, world_to_pixel

PARAMS = ("cam_pitch_deg", "eye_x", "eye_y", "eye_z", "ipd_m")


def _apply(g: Geometry, x: np.ndarray, free: tuple) -> Geometry:
    d = dict(zip(free, x))
    eye = (d.get("eye_x", g.eye_pos[0]), d.get("eye_y", g.eye_pos[1]), d.get("eye_z", g.eye_pos[2]))
    return replace(g, cam_pitch_deg=d.get("cam_pitch_deg", g.cam_pitch_deg), eye_pos=eye, ipd_m=d.get("ipd_m", g.ipd_m))


def _get(g: Geometry, name: str) -> float:
    return {"cam_pitch_deg": g.cam_pitch_deg, "eye_x": g.eye_pos[0], "eye_y": g.eye_pos[1], "eye_z": g.eye_pos[2], "ipd_m": g.ipd_m}[name]


def residuals(g: Geometry, points: list[dict]) -> np.ndarray:
    out = []
    for p in points:
        w = pixel_to_world(g, p["u"], p["v"], p["ipd_px"])
        yaw, pitch = gaze_angles(g.eye_pos, w)
        out += [yaw - p["yaw_deg"], pitch - p["pitch_deg"]]
    return np.array(out)


def fit(points: list[dict], g0: Geometry, free: tuple = PARAMS, prior_sd: dict | None = None, iters: int = 40) -> tuple[Geometry, dict]:
    """ガウス・ニュートン(数値の微分)。prior_sd = 初期値からのずれの目安(度・m)。点が少ないとき、解が暴れないよう、初期値の近くに引く(弱い)。
    戻り: (求めた Geometry, {residual_rms_deg, residual_before_rms_deg, params})"""
    prior_sd = prior_sd or {"cam_pitch_deg": 15.0, "eye_x": 0.3, "eye_y": 0.5, "eye_z": 0.5, "ipd_m": 0.006}
    free = tuple(free)
    x0 = np.array([_get(g0, n) for n in free], float)
    x = x0.copy()
    sd = np.array([prior_sd[n] for n in free], float)
    sigma_deg = 1.5  # 人が「合っている」と感じる向きのばらつきの目安(度)

    def f(xv):
        r = residuals(_apply(g0, xv, free), points) / sigma_deg
        return np.concatenate([r, (xv - x0) / sd])

    for _ in range(iters):
        r0 = f(x)
        J = np.empty((len(r0), len(x)))
        for j in range(len(x)):
            h = 1e-5 * max(1.0, abs(x[j]))
            xp = x.copy()
            xp[j] += h
            J[:, j] = (f(xp) - r0) / h
        step, *_ = np.linalg.lstsq(J, -r0, rcond=None)
        # 1 回の動きを抑える(行き過ぎない)
        x = x + np.clip(step, -sd, sd)
        if np.linalg.norm(step / sd) < 1e-6:
            break
    g = _apply(g0, x, free)
    rms = lambda gg: float(np.sqrt(np.mean(residuals(gg, points) ** 2)))  # noqa: E731
    return g, {"residual_before_rms_deg": round(rms(g0), 3), "residual_rms_deg": round(rms(g), 3), "params": {n: round(float(v), 4) for n, v in zip(free, x)}}


def save(g: Geometry, path: str) -> None:
    json.dump({"width": g.width, "height": g.height, "hfov_deg": g.hfov_deg, "cam_pos": list(g.cam_pos), "cam_pitch_deg": g.cam_pitch_deg, "eye_pos": list(g.eye_pos), "ipd_m": g.ipd_m, "ema": g.ema, "hold_s": g.hold_s,
               "image_rot180": g.image_rot180, "ue_cam_h_m": g.ue_cam_h_m, "ue_cam_dz_m": g.ue_cam_dz_m},  # 映像の向きと UE の変換は校正で変えないが、消さない
              open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def simulate(n_points: int = 5, pixel_noise: float = 1.0, human_sd_deg: float = 1.5, seed: int = 3, free: tuple = PARAMS) -> dict:
    """答えの分かる試験。本当の値(真)から、校正の点(客の位置 → 画素 + 人が合わせた向き)を作り、ずれた初期値から戻す。
    戻り: 校正の前後で、別の客(目の間隔 ±6%)の視線の誤差(度)を比べた数字"""
    rng = np.random.default_rng(seed)
    true = Geometry(cam_pos=(0.0, 0.08, 0.3), cam_pitch_deg=38.0, eye_pos=(0.06, 1.3, -0.2), ipd_m=0.0655)  # 校正した人の IPD は 65.5 mm(平均 62.1 mm とは違う)
    g0 = Geometry(cam_pos=(0.0, 0.08, 0.3), cam_pitch_deg=30.0, eye_pos=(0.0, 1.0, 0.0), ipd_m=0.0621)  # 仮の初期値
    spots = [(0.0, 1.65, 2.0), (-0.7, 1.65, 1.6), (0.7, 1.65, 1.6), (-0.8, 1.65, 3.0), (0.8, 1.65, 3.0), (0.0, 1.65, 2.6), (0.4, 1.65, 3.4), (-0.4, 1.65, 1.5)][:n_points]
    pts = []
    for p in spots:
        u, v, ipd_px = world_to_pixel(true, np.array(p))
        yaw, pitch = gaze_angles(true.eye_pos, np.array(p))
        pts.append({"u": u + rng.normal(0, pixel_noise), "v": v + rng.normal(0, pixel_noise), "ipd_px": ipd_px * (1 + rng.normal(0, 0.01)),
                    "yaw_deg": yaw + rng.normal(0, human_sd_deg), "pitch_deg": pitch + rng.normal(0, human_sd_deg)})
    fitted, rep = fit(pts, g0, free=free)

    def eval_err(g):
        errs = []
        for _ in range(300):
            p = np.array([rng.uniform(-0.9, 0.9), rng.uniform(1.45, 1.8), rng.uniform(1.4, 3.4)])
            u, v, ipd_px = world_to_pixel(true, p)
            other = true.ipd_m * (1 + rng.normal(0, 0.06))  # 別の客の目の間隔(個人差)。画素は、その人の目の間隔で決まる
            ipd_px_other = ipd_px * other / true.ipd_m
            ty, tp = gaze_angles(true.eye_pos, p)
            est = pixel_to_world(g, u, v, ipd_px_other)
            ey, ep = gaze_angles(g.eye_pos, est)
            errs.append(math.hypot(ey - ty, ep - tp))
        return float(np.median(errs)), float(np.percentile(errs, 90))

    b, a = eval_err(g0), eval_err(fitted)
    return {"points": n_points, "before_median_deg": round(b[0], 2), "before_p90_deg": round(b[1], 2), "after_median_deg": round(a[0], 2), "after_p90_deg": round(a[1], 2),
            "fit": rep, "true": {"cam_pitch_deg": true.cam_pitch_deg, "eye_pos": true.eye_pos, "ipd_m": true.ipd_m}}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--points")
    ap.add_argument("--geometry", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--simulate", action="store_true")
    a = ap.parse_args()
    if a.simulate:
        for n in (3, 4, 5, 6, 8):
            print(json.dumps(simulate(n), ensure_ascii=False))
        return
    if not a.points:
        raise SystemExit("--points か --simulate が要ります")
    g0 = Geometry.load(a.geometry or None)
    pts = json.load(open(a.points, encoding="utf-8"))
    if len(pts) < 4:
        raise SystemExit("点が少なすぎます(最低 4 点、できれば 5 点以上)")
    g, rep = fit(pts, g0)
    print(json.dumps(rep, ensure_ascii=False, indent=1))
    if a.out:
        save(g, a.out)
        print("保存しました:", a.out)


if __name__ == "__main__":
    main()
