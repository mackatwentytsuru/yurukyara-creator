"""予行(ウルトラワイドのモニターを LED の代わりにして、iPhone「撮影記録」で撮った本物の映像)の解析。

  python place/shootlog/rehearsal_analyze.py <撮影フォルダ> --board board.json --led-size <横m> <縦m> [--out <出力>] [--every 6] [--face A]

やること(すべて本物の映像で数字を出す):
 1. 盤(ChArUco)を見つけて、iPhone の姿勢(PnP)を LED の座標で出す。ARKit の K を使う。
 2. 同じ映像で iPhone のレンズ校正(焦点距離・歪み)を測り、ARKit の K と比べる。
 3. LED の位置合わせを 2 通りで出して比べる: 撮影のはじめの 4 隅のタップ(align_led)と、盤から(PnP + ARKit)。
 4. ARKit の追跡と PnP の姿勢のずれ(位置 cm・向き °)を時間順に出す = ARKit のずれ(ドリフト)。
 5. 位置合わせ(タップ版)と ARKit の姿勢だけで盤の角を映像に投影し、見つけた角との画素の差を測る = 実際に合成に使う形の誤差。重ねた絵を出す。
 6. 同期フラッシュの時刻の間隔が、流した間隔(1.0, 2.5, 3.2, 5.5, 6.0, 8.5 秒)と合うか = iPhone の時刻(pts)が正しいか。
 7. 盤の大きさ(画素の大きさ)の確かめ: 盤から見た移動量 ÷ ARKit の移動量。1.00 から外れた分だけ、画素の大きさの仮定がずれている。
出力: report.json、overlay_*.png、error_over_time.png、lens_iphone.json。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation as Rot

from align_led import align
from lenslib import Board, calibrate, detect_corners, imwrite
from rig_offset import ARKIT_FROM_CV, pose_from_board, summarize
from shootlib import apply, invert_rigid, led_corners, load_shoot, mat4

FLASH_STARTS = [1.0, 2.5, 3.2, 5.5, 6.0, 8.5]


def luma_edges(video, pts):
    cap = cv2.VideoCapture(str(video))
    ys = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        small = cv2.resize(img, (160, 90), interpolation=cv2.INTER_AREA)
        ys.append(float(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).mean()))
    cap.release()
    n = min(len(ys), len(pts))
    y, t = np.array(ys[:n]), np.array(pts[:n])
    lo, hi = np.percentile(y, 5), np.percentile(y, 95)
    if hi - lo < 8:
        return []
    mid = (lo + hi) / 2
    out = []
    for i in range(1, n):
        if y[i - 1] < mid <= y[i]:
            te = t[i - 1] + (mid - y[i - 1]) / (y[i] - y[i - 1]) * (t[i] - t[i - 1])
            if not out or te - out[-1] > 0.25:
                out.append(float(te))
    return out


def flash_check(edges):
    """見つけた立ち上がりが、流した並び(開始 1.0, 2.5, … 秒)と合うか。数が違えば連続した部分で合わせる。"""
    if len(edges) < 2:
        return {"found": len(edges), "note": "フラッシュが写っていない(2 回以上要る)"}
    best = None
    k = min(len(edges), len(FLASH_STARTS))
    for sa in range(0, len(FLASH_STARTS) - k + 1):
        for sb in range(0, len(edges) - k + 1):
            a = np.array(FLASH_STARTS[sa:sa + k]); b = np.array(edges[sb:sb + k])
            A = np.stack([a, np.ones_like(a)], axis=1)
            coef, *_ = np.linalg.lstsq(A, b, rcond=None)
            res = b - A @ coef
            c = float(np.sqrt(np.mean(res ** 2)))
            if best is None or c < best[0]:
                best = (c, coef, k)
    c, coef, k = best
    return {"found": len(edges), "paired": int(k), "scale_iphone_over_page": float(coef[0]), "offset_s": float(coef[1]),
            "residual_rms_ms": round(c * 1000, 2), "note": "scale は 1.000 に近いほど、iPhone の時刻の進みが正しい(ページの時計との比)"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shoot_dir")
    ap.add_argument("--board", required=True)
    ap.add_argument("--led-size", nargs=2, type=float, required=True, metavar=("W_M", "H_M"))
    ap.add_argument("--face", default="A")
    ap.add_argument("--every", type=int, default=6)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    shoot = load_shoot(a.shoot_dir)
    board = Board.load(a.board)
    out = Path(a.out or Path(a.shoot_dir) / "rehearsal")
    out.mkdir(parents=True, exist_ok=True)
    W, H = a.led_size
    n = len(shoot.frames)
    pts = np.array([f["pts"] for f in shoot.frames])

    # 1・2: 盤を見つける(ARKit の K で PnP)+ 校正用の角を集める
    cap = cv2.VideoCapture(str(shoot.video))
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    pnp, views, kept = {}, [], []
    saved = {}
    i = 0
    while True:
        ok, img = cap.read()
        if not ok or i >= n:
            break
        if i % a.every == 0:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            fx, fy, cx, cy = shoot.frames[i]["K"]
            K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
            r = detect_corners(gray, board, 12)
            if r is not None:
                corners, ids = r
                P = pose_from_board(gray, board, K, np.zeros(5))
                if P is not None:
                    pnp[i] = (P, corners, ids)
                views.append((corners, ids)); kept.append(i)
                if i not in saved and len(saved) < 400:
                    saved[i] = None
        i += 1
    cap.release()
    if len(pnp) < 5:
        raise SystemExit(f"盤が見つかったコマが少ない({len(pnp)})。盤の表示・距離・ピントを確かめる")

    # 2: iPhone のレンズ校正
    sel = np.linspace(0, len(views) - 1, min(len(views), 50)).astype(int)
    cal = calibrate([views[j] for j in sel], board, size, "simple", shoot.frames[0]["K"][0])
    lens = {"image_size": list(size), "fx": cal["K"][0, 0], "fy": cal["K"][1, 1], "cx": cal["K"][0, 2], "cy": cal["K"][1, 2],
            "dist": [float(v) for v in cal["dist"][:5]], "rms_px": cal["rms"], "views": len(sel)}
    arkit_k = shoot.frames[0]["K"]
    lens["arkit_K"] = arkit_k
    lens["fx_ratio_measured_over_arkit"] = lens["fx"] / arkit_k[0]
    (out / "lens_iphone.json").write_text(json.dumps(lens, indent=2), encoding="utf-8")

    # 3: 位置合わせ 2 通り
    al_tap = align(a.shoot_dir, W, H, a.face)
    T_led_from_world_tap = np.array(al_tap["T_led_from_world"])
    world_to_led = [pnp[i][0] @ invert_rigid(mat4(shoot.frames[i]["T"])) for i in pnp if shoot.frames[i]["ok"]]
    Wb, Wb_std, (wr_med, wr_p95) = summarize(world_to_led)
    d_t = np.linalg.norm(Wb[:3, 3] - T_led_from_world_tap[:3, 3]) * 100
    d_r = np.degrees(np.linalg.norm(Rot.from_matrix(Wb[:3, :3].T @ T_led_from_world_tap[:3, :3]).as_rotvec()))

    # 4・5・7: ARKit の追跡と PnP の姿勢のずれ、投影誤差
    rows = []
    path_pnp, path_ark = [], []
    for i in sorted(pnp):
        if not shoot.frames[i]["ok"]:
            continue
        P, corners, ids = pnp[i]
        T_ark_led = T_led_from_world_tap @ mat4(shoot.frames[i]["T"])         # ARKit + タップの位置合わせ
        dpos = np.linalg.norm(T_ark_led[:3, 3] - P[:3, 3]) * 100
        drot = np.degrees(np.linalg.norm(Rot.from_matrix(T_ark_led[:3, :3].T @ P[:3, :3]).as_rotvec()))
        # 投影誤差(画素): ARKit の姿勢だけで盤の角を投影
        fx, fy, cx, cy = shoot.frames[i]["K"]
        Tcv = invert_rigid(T_ark_led @ ARKIT_FROM_CV)
        pts_led = board.corner_led_m(ids)
        cam = (Tcv[:3, :3] @ pts_led.T).T + Tcv[:3, 3]
        uv = np.stack([cx + fx * cam[:, 0] / cam[:, 2], cy + fy * cam[:, 1] / cam[:, 2]], axis=1)
        reproj = float(np.median(np.linalg.norm(uv - corners, axis=1)))
        rows.append({"frame": i, "t": round(float(pts[i]), 3), "pos_err_cm": round(float(dpos), 2), "rot_err_deg": round(float(drot), 3), "reproj_px_median": round(reproj, 1)})
        path_pnp.append(P[:3, 3]); path_ark.append(mat4(shoot.frames[i]["T"])[:3, 3])
    pos = np.array([r["pos_err_cm"] for r in rows]); rot = np.array([r["rot_err_deg"] for r in rows]); rp = np.array([r["reproj_px_median"] for r in rows])
    scale = None
    if len(path_pnp) > 5:
        lp = np.sum(np.linalg.norm(np.diff(np.array(path_pnp), axis=0), axis=1)); la = np.sum(np.linalg.norm(np.diff(np.array(path_ark), axis=0), axis=1))
        scale = float(lp / la) if la > 1e-6 else None

    # 重ねた絵(最初・中間・最後あたりの 6 枚): 緑=ARKit+タップの位置合わせで投影した画面の枠と盤の外形、赤=PnP
    cap = cv2.VideoCapture(str(shoot.video))
    want = {rows[j]["frame"] for j in np.linspace(0, len(rows) - 1, min(6, len(rows))).astype(int)}
    i = 0
    led = led_corners(W, H)
    rect = np.array([led[k] for k in ["tl", "tr", "br", "bl"]], np.float32)
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if i in want:
            fx, fy, cx, cy = shoot.frames[i]["K"]
            for color, P in (((0, 255, 0), (T_led_from_world_tap @ mat4(shoot.frames[i]["T"]))), ((0, 0, 255), pnp[i][0] if i in pnp else None)):
                if P is None:
                    continue
                Tcv = invert_rigid(P @ ARKIT_FROM_CV)
                cam = (Tcv[:3, :3] @ rect.T).T + Tcv[:3, 3]
                if np.all(cam[:, 2] > 0.05):
                    uv = np.stack([cx + fx * cam[:, 0] / cam[:, 2], cy + fy * cam[:, 1] / cam[:, 2]], axis=1).astype(np.int32)
                    cv2.polylines(img, [uv.reshape(-1, 1, 2)], True, color, max(3, size[0] // 600), cv2.LINE_AA)
            sm = cv2.resize(img, (1600, int(size[1] * 1600 / size[0])), interpolation=cv2.INTER_AREA)
            imwrite(out / f"overlay_{i:05d}.png", sm)
        i += 1
    cap.release()

    flash = flash_check(luma_edges(shoot.video, pts))
    report = {
        "frames": n, "frames_with_board": len(pnp), "led_size_m": [W, H],
        "iphone_lens": lens,
        "alignment_tap_vs_board": {"position_diff_cm": round(float(d_t), 2), "rotation_diff_deg": round(float(d_r), 3),
                                   "tap_corner_reprojection_px": al_tap["max_reprojection_error_px"],
                                   "board_alignment_spread_mm": [round(float(v), 1) for v in Wb_std]},
        "arkit_vs_pnp": {"samples": len(rows), "pos_err_cm_median": round(float(np.median(pos)), 2), "pos_err_cm_p95": round(float(np.percentile(pos, 95)), 2),
                         "rot_err_deg_median": round(float(np.median(rot)), 3), "rot_err_deg_p95": round(float(np.percentile(rot, 95)), 3),
                         "reproj_px_median": round(float(np.median(rp)), 1), "reproj_px_p95": round(float(np.percentile(rp, 95)), 1),
                         "first_third_pos_err_cm": round(float(np.median(pos[: len(pos) // 3 + 1])), 2), "last_third_pos_err_cm": round(float(np.median(pos[-(len(pos) // 3 + 1):])), 2)},
        "pixel_pitch_check": {"pnp_path_over_arkit_path": scale, "note": "1.00 から外れた分だけ、画素の大きさ(pitch)の仮定がずれている。実際の pitch ≈ 仮定 × この値"},
        "sync_flash": flash,
        "samples": rows,
    }
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    import matplotlib
    matplotlib.use("Agg")
    matplotlib.rcParams["font.family"] = ["Yu Gothic", "Meiryo", "MS Gothic", "DejaVu Sans"]
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(3, 1, figsize=(9, 7), sharex=True)
    tt = [r["t"] for r in rows]
    ax[0].plot(tt, pos); ax[0].set_ylabel("位置のずれ cm")
    ax[1].plot(tt, rot); ax[1].set_ylabel("向きのずれ °")
    ax[2].plot(tt, rp); ax[2].set_ylabel("投影の誤差 px"); ax[2].set_xlabel("時間 s")
    for x in ax:
        x.grid(alpha=.3)
    fig.tight_layout(); fig.savefig(out / "error_over_time.png", dpi=110)
    print(json.dumps({k: report[k] for k in ("frames_with_board", "alignment_tap_vs_board", "arkit_vs_pnp", "pixel_pitch_check", "sync_flash")}, ensure_ascii=False, indent=1))
    print("iPhone のレンズ:", {k: lens[k] for k in ("fx", "fy", "cx", "cy", "dist", "rms_px", "fx_ratio_measured_over_arkit")})


if __name__ == "__main__":
    main()
