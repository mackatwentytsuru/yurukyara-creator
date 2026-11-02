"""合成の部屋(room_1102 の壁・床・家具の箱)に既知の模様を貼り、その中を歩くカメラの映像から room_color_project が模様を取り戻せるか確かめる。

  python place/shootlog/room_color_selftest.py [--room <room.json>] [--out <作業フォルダ>]
真の模様と、取り戻した模様の、見えた所での平均の差(0〜255)と PSNR、見えた割合、家具に隠れた所を使っていないか(隠れた所の誤差)を出す。
ARKit の姿勢の雑音(位置 0.5 cm・向き 0.05°)と、露出の揺れ(±5%)を入れてある。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation as Rot

from room_color_project import ARKIT_FROM_CV, interior_normal, occluded, sample_bilinear, surfaces_from_room, texel_grid
from shootlib import apply, invert_rigid, mat4, rot_y

W_IMG, H_IMG = 960, 540
K = np.array([[820.0, 0, 480.0], [0, 820.0, 270.0], [0, 0, 1.0]])


def make_texture(W, H, seed, detail=True):
    rng = np.random.default_rng(seed)
    base = rng.uniform(80, 200, 3)
    img = np.zeros((H, W, 3), np.float32) + base
    # なめらかな色の変化 + 細かい模様(格子とまだら)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    for c in range(3):
        img[..., c] += 40 * np.sin(xx / (30 + 10 * c) + seed) * np.cos(yy / (25 + 5 * c))
    if not detail:
        return np.clip(img, 0, 255).astype(np.uint8)
    img += 25 * (((xx // 24).astype(int) + (yy // 24).astype(int)) % 2)[..., None]
    noise = cv2.GaussianBlur(rng.normal(0, 25, (H, W, 3)).astype(np.float32), (0, 0), 2.0)
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def look_at_cam(eye, target):
    eye, target = np.asarray(eye, float), np.asarray(target, float)
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1.0, 0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = r, d, f, eye   # OpenCV 流(カメラ→部屋)
    return T


def render(surfaces, textures, boxes, T_cv):
    """画素ごとにレイを飛ばし、いちばん手前の面(または家具の箱 = 灰色)の色。"""
    ys, xs = np.mgrid[0:H_IMG, 0:W_IMG].astype(np.float32)
    rays = np.stack([(xs - K[0, 2]) / K[0, 0], (ys - K[1, 2]) / K[1, 1], np.ones_like(xs)], axis=-1).reshape(-1, 3)
    d = rays @ T_cv[:3, :3].T
    C = T_cv[:3, 3]
    best_t = np.full(len(d), np.inf)
    img = np.zeros((len(d), 3), np.float32)
    for s, tex in zip(surfaces, textures):
        M = s["M"]
        n = M[:3, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            t = ((M[:3, 3] - C) @ n) / (d @ n)
        P = C + d * t[:, None]
        loc = (np.linalg.inv(M)[:3, :3] @ (P - M[:3, 3]).T).T
        inside = (t > 0.05) & (np.abs(loc[:, 0]) <= s["w"] / 2) & (np.abs(loc[:, 1]) <= s["h"] / 2)
        upd = inside & (t < best_t)
        if not upd.any():
            continue
        th, tw = tex.shape[:2]
        col = (loc[upd, 0] + s["w"] / 2) / s["w"] * tw - 0.5
        row = (s["h"] / 2 - loc[upd, 1]) / s["h"] * th - 0.5
        img[upd] = sample_bilinear(tex, col, row)
        best_t[upd] = t[upd]
    # 家具の箱: 手前にあれば灰色
    for Mb, dims in boxes:
        R, c = Mb[:3, :3], Mb[:3, 3]
        half = np.asarray(dims, float) / 2
        o = R.T @ (C - c)
        dd = (R.T @ d.T).T
        with np.errstate(divide="ignore", invalid="ignore"):
            t1 = (-half - o) / dd
            t2 = (half - o) / dd
        tmin = np.nanmax(np.minimum(t1, t2), axis=1)
        tmax = np.nanmin(np.maximum(t1, t2), axis=1)
        hit = (tmax > np.maximum(tmin, 0.05)) & (tmin < best_t)
        img[hit] = 120
        best_t[hit] = tmin[hit]
    return np.clip(img, 0, 255).astype(np.uint8).reshape(H_IMG, W_IMG, 3)


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--room", default=str(here.parents[1] / "places/room_1102/scan/room.json"))
    ap.add_argument("--out", default=str(Path.home() / "AppData/Local/Temp/room_color_selftest"))
    ap.add_argument("--noise", type=float, default=1.0, help="ARKit の雑音と露出の揺れの倍率(0 なら雑音なし = 幾何だけの確かめ)")
    ap.add_argument("--smooth", action="store_true", help="なめらかな模様だけ(細かい模様のぼけを除いて、位置合わせの正しさだけ見る)")
    a = ap.parse_args()
    room = json.loads(Path(a.room).read_text(encoding="utf-8"))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(4)

    surfaces = surfaces_from_room(room)
    floor_c = mat4(room["floors"][0]["transform"])[:3, 3]
    gt = []
    for k, s in enumerate(surfaces):
        _, (W, H) = texel_grid(s, 100.0)
        gt.append(make_texture(W, H, k + 1, not a.smooth))
        (out / f"gt_{s['name']}.png").write_bytes(cv2.imencode(".png", gt[-1])[1].tobytes())
    boxes = [(mat4(o["transform"]), o["dimensions"]) for o in room.get("objects", [])]

    # カメラの道: 部屋の中を歩きながら壁を見回す(70 コマ)
    xs = [p["transform"][12] for p in room["floors"]]
    cx0, cz0 = float(room["floors"][0]["transform"][12]), float(room["floors"][0]["transform"][14])
    eye_y = floor_c[1] + 1.4
    T_world_from_room = np.eye(4)
    T_world_from_room[:3, :3] = rot_y(np.radians(-25))
    T_world_from_room[:3, 3] = [2.0, 0.3, -1.0]
    frames = []
    vw = cv2.VideoWriter(str(out / "video.mov"), cv2.VideoWriter_fourcc(*"MJPG"), 30, (W_IMG, H_IMG))
    n = 150
    for i in range(n):
        s_ = i / (n - 1)
        eye = np.array([cx0 + 0.8 * np.sin(2 * np.pi * s_), eye_y, cz0 + 0.5 * np.cos(2 * np.pi * s_)])
        ang = 2 * np.pi * s_ * 1.6 + 0.4
        pitch = -0.1 - 0.35 * (1 + np.sin(9 * s_))        # 壁から床まで見渡す(下向き 0.1〜0.8)
        target = eye + np.array([np.sin(ang) * np.cos(pitch), np.sin(pitch), np.cos(ang) * np.cos(pitch)]) * 3.0
        T_cv = look_at_cam(eye, target)
        img = render(surfaces, gt, boxes, T_cv)
        img = np.clip(img.astype(np.float32) * (1 + 0.05 * a.noise * np.sin(i / 7.0)), 0, 255).astype(np.uint8)
        vw.write(img)
        T_cam_room = T_cv @ ARKIT_FROM_CV
        T_w = T_world_from_room @ T_cam_room
        T_w[:3, 3] += rng.normal(0, 0.005 * a.noise, 3)
        T_w[:3, :3] = Rot.from_rotvec(rng.normal(0, np.radians(0.05 * a.noise), 3)).as_matrix() @ T_w[:3, :3]
        frames.append({"i": i, "t": i / 30, "pts": i / 30, "T": [float(v) for v in T_w.T.reshape(-1)], "K": [K[0, 0], K[1, 1], K[0, 2], K[1, 2]], "track": "normal", "ok": True})
    vw.release()
    (out / "frames.jsonl").write_text("\n".join(json.dumps(f) for f in frames) + "\n", encoding="utf-8")
    (out / "meta.json").write_text(json.dumps({"videoFile": "video.mov", "stats": {"width": W_IMG, "height": H_IMG, "frames": n}}), encoding="utf-8")
    T_room_from_world = invert_rigid(T_world_from_room)
    (out / "room_from_world.json").write_text(json.dumps({"T_room_from_world": T_room_from_world.tolist()}), encoding="utf-8")

    subprocess.run([sys.executable, str(here / "room_color_project.py"), str(out), "--room", a.room, "--out", str(out / "result"),
                    "--room-from-world", str(out / "room_from_world.json"), "--stride", "2", "--max-frames", "60"], check=True)

    # 比べる: 見えた所(report の seen)だけでなく、全テクセルのうち「家具に隠れていない & 見えた」所
    rep = json.loads((out / "result" / "report.json").read_text(encoding="utf-8"))
    errs, psnrs, meds = [], [], []
    for s, g, r in zip(surfaces, gt, rep["surfaces"]):
        rec = cv2.imdecode(np.fromfile(str(out / "result" / f"{s['name']}.png"), np.uint8), cv2.IMREAD_COLOR)
        seen = cv2.imdecode(np.fromfile(str(out / "result" / f"{s['name']}_seen.png"), np.uint8), cv2.IMREAD_GRAYSCALE) > 0
        if not seen.any():
            print(f"  {s['name']}: 見えた 0%")
            continue
        d = (rec.astype(np.float32) - g.astype(np.float32))[seen]
        errs.append(float(np.abs(d).mean()))
        meds.append(float(np.median(np.abs(d))))
        psnrs.append(10 * np.log10(255 * 255 / max(float((d ** 2).mean()), 1e-9)))
        print(f"  {s['name']}: 見えた {r['seen_percent']}%、見えた所の平均の差 {errs[-1]:.1f}、PSNR {psnrs[-1]:.1f} dB")
    print(f"全体(見えた所だけ): 平均の差 {np.mean(errs):.1f}、中央値 {np.mean(meds):.1f}(0〜255)、PSNR 平均 {np.mean(psnrs):.1f} dB(露出の揺れ ±5% と ARKit の雑音を含む)")
    seen = np.mean([r["seen_percent"] for r in rep["surfaces"]])
    ok = np.mean(meds) < 8 and np.mean(psnrs) > 24 and seen > 25
    print("合格" if ok else "不合格")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
