"""ARKit の向きのゆっくりしたずれを、映像の中の動かない物の特徴点から測って引く(撮影記録の frames.jsonl を直す)。

  python place/shootlog/track_refine.py --shoot <撮影フォルダ> --ref-video <校正のときの映像> --ref-rows <その映像の姿勢 json> --out <直した撮影フォルダ>
なぜ要るか: 固定の iPad でも ARKit の向きは 10 分で約 4° ずれる(実測。位置は 0.35 cm 以内)。点の校正は撮る前の姿勢で決めるので、時間がたつと重ねの位置が
ずれる(13 m で 1° は約 27 px)。ずれは世界全体の回転としてゆっくり変わる(1 テイクの間はほぼ一定)ので、校正のときに撮った参照の絵と、テイクの絵の、
動かない物(LED の外の、天井・トラス・照明・舞台の縁。LED の面と床の映り込みは明るさで隠す)の特徴点を合わせ、向きの差(参照の絵からの回転)を出す。
  参照の姿勢(校正のとき。ずれ 0) × 回転(絵から測る) = 今の本当の向き。ARKit の報告との差 = 世界の回転のずれ Rw。
  Rw はテイクの間の時間の 1 次式(回転ベクトルごと)に当てて、コマごとの ARKit の向きから引く(高い周波数の揺れは触らない)。位置は触らない。
前提と限り: ①参照とテイクの視点がほぼ同じ(特徴点が遠い。カメラが数 m 動いても天井・奥の壁では回転で近似できる)②動かない特徴点が見える
  ③ARKit の世界が変わっていない(arSessionId が同じ)。足りないとき(特徴点が少ない)は直さずに理由を出す。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation as R

D_FLIP = np.diag([1.0, -1.0, -1.0])        # ARKit のカメラ(y 上・z 後ろ)↔ OpenCV のカメラ(y 下・z 前)
MIN_INLIERS = 8
BRIGHT_LIMIT = 56                           # これより明るい所(LED・映り込み)は特徴点に使わない(0〜255)
MASK_GROW = 13                              # 明るい所の周りを広げる画素


def unflat(v):
    return np.array(v, float).reshape(4, 4).T


def flat(T):
    return [float(v) for v in np.asarray(T).T.reshape(-1)]


def led_hull_mask(shape, corners_px, margin):
    """LED の 3 面(それぞれ 4 隅の四角)を投影して、margin 画素ふくらませて隠す。corners_px は (12,2) = A・B・C の tl,tr,br,bl。"""
    mask = np.full(shape, 255, np.uint8)
    poly = np.zeros(shape, np.uint8)
    pts = np.asarray(corners_px, np.float64).reshape(-1, 4, 2)
    for quad in pts:
        if not np.isfinite(quad).all():
            continue
        cv2.fillConvexPoly(poly, np.clip(np.round(quad), -30000, 30000).astype(np.int32), 255)
    poly = cv2.dilate(poly, np.ones((2 * int(margin) + 1, 2 * int(margin) + 1), np.uint8))
    mask[poly > 0] = 0
    return mask


def static_mask(gray, hull=None):
    """隠す物: ①LED の面(投影した凸包 + 余白)②明るい所とその周り(床の映り込み・光る物)。残るのは暗い会場(天井・トラス・照明・壁)。"""
    blur = cv2.GaussianBlur(gray, (0, 0), 3)
    bright = (blur > BRIGHT_LIMIT).astype(np.uint8) * 255
    bright = cv2.dilate(bright, np.ones((MASK_GROW, MASK_GROW), np.uint8))
    mask = cv2.bitwise_not(bright)
    return mask if hull is None else cv2.bitwise_and(mask, hull)


def features(gray, orb, hull=None):
    mask = static_mask(gray, hull)
    eq = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(cv2.GaussianBlur(gray, (0, 0), 1.2))
    kp, des = orb.detectAndCompute(eq, mask)
    return kp, des


def procrustes(a, b):
    """b ≈ R a となる回転 R(a・b は (N,3) の単位ベクトル)。"""
    H = a.T @ b
    U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    return Vt.T @ np.diag([1, 1, d]) @ U.T


def relative_rotation(ref_gray, cur_gray, K, orb, matcher, ref_feat=None, cur_hull=None):
    """参照の絵 → 今の絵の回転 A(OpenCV のカメラの座標で、b_ref = A b_cur)。戻り (A, 内れ点数) か (None, 理由)。"""
    kp1, d1 = ref_feat or features(ref_gray, orb)
    kp2, d2 = features(cur_gray, orb, cur_hull)
    if d1 is None or d2 is None or len(kp1) < 8 or len(kp2) < 8:
        return None, f"特徴点が少ない({0 if d1 is None else len(kp1)}, {0 if d2 is None else len(kp2)})"
    pairs = matcher.knnMatch(d2, d1, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.8 * n.distance]
    if len(good) < 12:
        return None, f"合った点が少ない({len(good)})"
    p_cur = np.float32([kp2[m.queryIdx].pt for m in good])
    p_ref = np.float32([kp1[m.trainIdx].pt for m in good])
    H, inl = cv2.findHomography(p_cur, p_ref, cv2.RANSAC, 3.0)
    if H is None or inl.sum() < MIN_INLIERS:
        return None, f"内れ点が少ない({0 if inl is None else int(inl.sum())})"
    sel = inl.ravel() > 0
    Ki = np.linalg.inv(K)

    def rays(p):
        v = (Ki @ np.c_[p, np.ones(len(p))].T).T
        return v / np.linalg.norm(v, axis=1, keepdims=True)

    A = procrustes(rays(p_cur[sel]), rays(p_ref[sel]))
    return A, int(sel.sum())


def corner_pixels(T_flat, track, fx):
    """記録の 1 コマの姿勢(ARKit の世界)→ LED 3 面の 4 隅の画素(12 点)。track は shoot_track.build_track の結果(world_to_ue を使う)。"""
    sys.path[:0] = [str(Path(__file__).resolve().parents[2] / "show" / "composite"), str(Path(__file__).resolve().parents[2] / "show" / "ue")]
    from shoot_track import frame_pose, model_corners
    from ue_axes import project_ue
    rot = np.array(track["world_to_ue"]["rotation"])
    trans = np.array(track["world_to_ue"]["translation_cm"])
    pos, M = frame_pose({"T": T_flat}, rot, trans)
    pts = np.vstack([model_corners(f) for f in "ABC"])
    px, depth = project_ue(pts, pos, M[:, 0], M[:, 1], M[:, 2], fx, fx, 960.0, 540.0)
    px[depth <= 1.0] = np.nan
    return px


def corrected(T_flat, rw_vec):
    T = unflat(T_flat)
    T[:3, :3] = R.from_rotvec(rw_vec).as_matrix().T @ T[:3, :3]
    return flat(T)


def read_gray(path, first, last):
    """映像の first〜last コマ(含む)を半分の大きさの灰色で読む。{コマ番号: 画像}。"""
    cap = cv2.VideoCapture(str(path))
    out, i = {}, 0
    while i <= last:
        ok, img = cap.read()
        if not ok:
            break
        if i >= first:
            out[i] = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
        i += 1
    cap.release()
    return out


def stack_denoise(gray, rots, idx, K_half, half=4, gain=4.0):
    """idx コマの絵に、前後 half コマを ARKit の相対回転(短い間は正確)で合わせて平均する。暗い会場の雑音を 1/3 ほどにする。
    rots: {コマ: ARKit のカメラの回転 3x3}。b_i = (R_i^T R_j) b_j(OpenCV の座標へは D で共役)。"""
    acc, n = np.zeros(gray[idx].shape, np.float32), 0
    Ki = np.linalg.inv(K_half)
    for j in range(idx - half, idx + half + 1):
        if j not in gray or j not in rots:
            continue
        rel = D_FLIP @ (rots[idx].T @ rots[j]) @ D_FLIP          # b_i = rel b_j
        H = K_half @ rel @ Ki                                      # 絵 j の画素 → 絵 i の画素
        acc += cv2.warpPerspective(gray[j].astype(np.float32), H, (gray[idx].shape[1], gray[idx].shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        n += 1
    return np.clip(acc / max(n, 1) * gain, 0, 255).astype(np.uint8)       # 暗いので 4 倍にして見えやすくする(明るい所の隠し方の値も 4 倍で比べる)


def estimate(shoot: Path, ref_video: Path, ref_rows, ref_index, track, every=5, fx=1532.5, margin_px=150.0, rw_guess=None, log=print):
    """テイクの各(every コマおき)の絵で Rw を測る。LED の面は、rw_guess で直した姿勢で投影して隠す(margin_px の余白)。戻り: 時刻(秒)・回転ベクトル(ラジアン)の列・内れ点・落ちた理由。
    絵は半分の大きさにして、前後 9 コマを ARKit の相対回転で合わせて平均してから使う(雑音対策)。"""
    frames = [json.loads(l) for l in (shoot / "frames.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    K = np.array([[fx / 2, 0, 480.0], [0, fx / 2, 270.0], [0, 0, 1.0]])
    orb = cv2.ORB_create(2000, fastThreshold=5)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    skip = int(json.loads((shoot / "meta.json").read_text(encoding="utf-8")).get("video_frame_offset", 0))
    ref_gray_all = read_gray(ref_video, max(ref_index - 4, 0), ref_index + 4)
    if ref_index not in ref_gray_all:
        raise RuntimeError("参照の絵が読めない")
    ref_rots = {j: unflat(ref_rows[j]["T"])[:3, :3] for j in ref_gray_all}
    ref_gray = stack_denoise(ref_gray_all, ref_rots, ref_index, K)
    scale = 0.5
    ref_hull = led_hull_mask(ref_gray.shape, corner_pixels(ref_rows[ref_index]["T"], track, fx) * scale, (margin_px if rw_guess is None else 40.0) * scale)
    ref_feat = features(ref_gray, orb, ref_hull)
    T_ref = unflat(ref_rows[ref_index]["T"])
    guess = (lambda t: np.zeros(3)) if rw_guess is None else rw_guess
    gray_all = read_gray(shoot / "video.mp4", 0, skip + len(frames))
    rots = {i: unflat(frames[i]["T"])[:3, :3] for i in range(len(frames))}
    gray = {i: gray_all[i + skip] for i in range(len(frames)) if (i + skip) in gray_all}
    times, rvs, inl, reasons = [], [], [], {}
    for i in range(0, len(frames), every):
        if i not in gray:
            continue
        img = stack_denoise(gray, rots, i, K)
        hull = led_hull_mask(img.shape, corner_pixels(corrected(frames[i]["T"], guess(frames[i]["pts"])), track, fx) * scale, (margin_px if rw_guess is None else 40.0) * scale)
        A, info = relative_rotation(ref_gray, img, K, orb, matcher, ref_feat, hull)
        if A is None:
            reasons[info] = reasons.get(info, 0) + 1
            continue
        R_cur_vis = T_ref[:3, :3] @ (D_FLIP @ A @ D_FLIP)
        Rw = rots[i] @ R_cur_vis.T                      # ARKit の報告 = Rw × 本当の向き
        times.append(frames[i]["pts"])
        rvs.append(R.from_matrix(Rw).as_rotvec())
        inl.append(info)
    return np.array(times), np.array(rvs), inl, reasons


def led_edge_samples(n=40):
    """LED の 3 面の外側の縁(上・左・右。下は床の映り込みで曖昧なので使わない)の点列(UE の座標、cm)。"""
    sys.path[:0] = [str(Path(__file__).resolve().parents[2] / "show" / "composite"), str(Path(__file__).resolve().parents[2] / "show" / "ue")]
    from shoot_track import model_corners
    pts = []
    for face in "ABC":
        tl, tr, br, bl = model_corners(face)
        # 外側の輪郭だけ。A の上と左、B の上、C の上(B の横の縁は A と C の後ろに隠れ、A の右・C の左は B と接していて縁にならない)
        edges = {"A": ((tl, tr), (tl, bl)), "B": ((tl, tr),), "C": ((tl, tr),)}[face]
        for p0, p1 in edges:
            for k in np.linspace(0.03, 0.97, n):
                pts.append(p0 + (p1 - p0) * k)
    return np.array(pts)


def project_points(T_flat, track, fx, pts_ue):
    from shoot_track import frame_pose
    from ue_axes import project_ue
    pos, M = frame_pose({"T": T_flat}, np.array(track["world_to_ue"]["rotation"]), np.array(track["world_to_ue"]["translation_cm"]))
    px, depth = project_ue(pts_ue, pos, M[:, 0], M[:, 1], M[:, 2], fx, fx, 960.0, 540.0)
    px[depth <= 1.0] = np.nan
    return px


def fit_edges(dist, T_flat, track, fx, pts_ue, start=None, grid_deg=6.0, step_deg=1.0):
    """LED の縁の投影が、絵の LED の縁(距離変換 dist。半分の大きさ)に合う Rw を探す。まず粗い格子(上下・左右)、次に最小二乗。戻り: (rotvec, 残差の中央値 px)。"""
    from scipy.optimize import least_squares
    h, w = dist.shape

    def residual(v):
        px = project_points(corrected(T_flat, v), track, fx, pts_ue) * 0.5
        ok = np.isfinite(px).all(axis=1) & (px[:, 0] > 2) & (px[:, 0] < w - 3) & (px[:, 1] > 2) & (px[:, 1] < h - 3)
        r = np.full(len(px), 40.0)       # 絵の外へ出た点は一定の罰(0 にすると、点を絵の外へ追い出す向きが得になる)
        if ok.any():
            mx, my = px[ok, 0].astype(np.float32).reshape(1, -1), px[ok, 1].astype(np.float32).reshape(1, -1)
            r[ok] = cv2.remap(dist, mx, my, cv2.INTER_LINEAR)[0] * 2.0       # 全体の画素へ
        return r

    best, best_cost = np.zeros(3) if start is None else np.asarray(start, float), np.inf
    base = best.copy()
    for dy in np.arange(-grid_deg, grid_deg + 1e-6, step_deg):
        for dz in np.arange(-grid_deg, grid_deg + 1e-6, step_deg):
            v = base + np.radians([dy, dz, 0.0])
            r = residual(v)
            cost = np.minimum(r, 40.0).mean()
            if cost < best_cost:
                best, best_cost = v, cost
    sol = least_squares(residual, best, loss="soft_l1", f_scale=3.0, x_scale=np.radians(1.0), diff_step=1e-3)
    r = residual(sol.x)
    return sol.x, float(np.median(r))


def estimate_edges(shoot: Path, track, every=10, fx=1532.5, led_level=9.0, log=print):
    """テイクの各(every コマおき)の絵で、LED の縁から Rw を測る(絵だけで測れ、参照の絵は要らない。LED の寸法と位置は校正のとき決めた物)。"""
    frames = [json.loads(l) for l in (shoot / "frames.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    K = np.array([[fx / 2, 0, 480.0], [0, fx / 2, 270.0], [0, 0, 1.0]])
    skip = int(json.loads((shoot / "meta.json").read_text(encoding="utf-8")).get("video_frame_offset", 0))
    gray_all = read_gray(shoot / "video.mp4", 0, skip + len(frames))
    gray = {i: gray_all[i + skip] for i in range(len(frames)) if (i + skip) in gray_all}
    rots = {i: unflat(frames[i]["T"])[:3, :3] for i in range(len(frames))}
    pts = led_edge_samples()
    times, rvs, res = [], [], []
    for i in range(0, len(frames), every):
        if i not in gray:
            continue
        img = stack_denoise(gray, rots, i, K, half=4, gain=1.0)
        # LED の中が暗い瞬間でも縁が出るよう、前後 ±15 コマの最大(合わせずに)も使う
        lo, hi = max(i - 15, 0), min(i + 15, len(frames) - 1)
        mx = np.max([gray[j] for j in range(lo, hi + 1, 3) if j in gray], axis=0)
        mask = ((cv2.GaussianBlur(np.maximum(img, mx), (0, 0), 1.5)) > led_level).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)       # 中の穴(暗い絵・キャラ)は埋める
        mask = np.zeros_like(mask)
        cv2.drawContours(mask, contours, -1, 1, -1)
        edge = mask - cv2.erode(mask, np.ones((3, 3), np.uint8))
        if edge.sum() < 200:
            continue
        dist = cv2.distanceTransform((1 - edge).astype(np.uint8), cv2.DIST_L2, 3).astype(np.float32)
        v, med = fit_edges(dist, frames[i]["T"], track, fx, pts)
        times.append(frames[i]["pts"])
        rvs.append(v)
        res.append(med)
    return np.array(times), np.array(rvs), res


def refine_edges(shoot: Path, out: Path, track, every=10, fx=1532.5, degree=1, log=print):
    times, rvs, res = estimate_edges(shoot, track, every, fx, log=log)
    if len(times) < 4:
        log(f"直さない: 測れたコマが少ない({len(times)})")
        return {"applied": False, "measured": len(times)}
    fit = fit_slow(times, rvs, degree)
    mid = fit(times.mean())
    apply(shoot, out, fit)
    info = {"applied": True, "mode": "edges", "measured": int(len(times)), "rw_deg": float(np.degrees(np.linalg.norm(mid))), "rw_axis_deg": [round(float(v), 3) for v in np.degrees(mid)],
            "edge_residual_px_median": float(np.nanmedian(res)), "scatter_deg": float(np.degrees(np.std(np.linalg.norm(rvs - np.array([fit(t) for t in times]), axis=1))))}
    log(f"直した(LED の縁): Rw {info['rw_deg']:.3f}° {info['rw_axis_deg']}、縁の残差 {info['edge_residual_px_median']:.1f} px、ばらつき {info['scatter_deg']:.3f}°")
    return info


def fit_slow(times, rvs, degree=1):
    """回転ベクトルの時間の多項式(既定 1 次)。外れ値に強いよう、中央値の周りで 2 回当て直す。"""
    t0 = times.mean()
    coefs = [np.polyfit(times - t0, rvs[:, k], degree) for k in range(3)]
    for _ in range(2):
        res = np.stack([rvs[:, k] - np.polyval(coefs[k], times - t0) for k in range(3)], 1)
        mag = np.linalg.norm(res, axis=1)
        keep = mag <= max(3 * np.median(mag), np.radians(0.05))
        if keep.sum() < degree + 2:
            break
        coefs = [np.polyfit((times - t0)[keep], rvs[keep, k], degree) for k in range(3)]
    return lambda t: np.array([np.polyval(coefs[k], t - t0) for k in range(3)])


def apply(shoot: Path, out: Path, rw_of_t):
    """撮影フォルダを写し、frames.jsonl の向きから Rw を引く(位置は触らない)。"""
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(shoot, out)
    frames = [json.loads(l) for l in (shoot / "frames.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    lines = []
    for f in frames:
        T = unflat(f["T"])
        Rw = R.from_rotvec(rw_of_t(f["pts"])).as_matrix()
        T[:3, :3] = Rw.T @ T[:3, :3]
        lines.append(json.dumps({**f, "T": [round(v, 6) for v in flat(T)]}))
    (out / "frames.jsonl").write_text("\n".join(lines), encoding="utf-8")
    return out


def refine(shoot: Path, out: Path, ref_video: Path, ref_rows, ref_index, track, every=5, fx=1532.5, degree=1, passes=3, margin_px=150.0, log=print):
    """passes 回くり返す(1 回目は余白を広く、2 回目からは前回の Rw で直した姿勢で LED を隠して余白を狭く)。"""
    n_total = len((shoot / "frames.jsonl").read_text(encoding="utf-8").splitlines()) // every + 1
    fit, info, last = None, {"applied": False}, None
    for k in range(passes):
        times, rvs, inl, reasons = estimate(shoot, ref_video, ref_rows, ref_index, track, every, fx, margin_px, fit, log)
        if len(times) < 5:
            log(f"{k + 1} 回目: 測れたコマが少ない({len(times)}/{n_total}。理由 {dict(list(reasons.items())[:3])})")
            if last is None:
                return {"applied": False, "measured": len(times), "reasons": reasons}
            break
        fit = fit_slow(times, rvs, degree)
        mid = fit(times.mean())
        info = {"applied": True, "measured": int(len(times)), "of": int(n_total), "inliers_median": float(np.median(inl)), "rw_deg": float(np.degrees(np.linalg.norm(mid))),
                "rw_axis_deg": [round(float(v), 3) for v in np.degrees(mid)],
                "scatter_deg": float(np.degrees(np.std(np.linalg.norm(rvs - np.array([fit(t) for t in times]), axis=1)))), "passes": k + 1}
        log(f"{k + 1} 回目: Rw {info['rw_deg']:.3f}°(測れたコマ {info['measured']}/{n_total}、内れ点の中央値 {info['inliers_median']:.0f}、ばらつき {info['scatter_deg']:.3f}°)")
        if last is not None and abs(info["rw_deg"] - last) < 0.02:
            break
        last = info["rw_deg"]
    apply(shoot, out, fit)
    return info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shoot", required=True, type=Path)
    ap.add_argument("--mode", choices=["features", "edges"], default="features", help="features=LED の外の動かない物の特徴点(参照の絵が要る)、edges=LED の縁")
    ap.add_argument("--ref-video", type=Path)
    ap.add_argument("--ref-rows", type=Path, help="参照の映像のコマごとの姿勢(frames.jsonl の形。T は列順 16 個)")
    ap.add_argument("--ref-index", type=int, default=0)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--fx", type=float, default=1532.5, help="映像(1920 幅)の画素の fx")
    ap.add_argument("--degree", type=int, default=1)
    ap.add_argument("--track", required=True, type=Path, help="この撮影フォルダから作った track.json(LED の面の投影に world_to_ue を使う)")
    a = ap.parse_args()
    if a.mode == "edges":
        info = refine_edges(a.shoot, a.out, json.loads(a.track.read_text(encoding="utf-8")), fx=a.fx, degree=a.degree)
        print(json.dumps(info, ensure_ascii=False))
        sys.exit(0 if info["applied"] else 1)
    rows = json.loads(a.ref_rows.read_text(encoding="utf-8"))
    info = refine(a.shoot, a.out, a.ref_video, rows, a.ref_index, json.loads(a.track.read_text(encoding="utf-8")), fx=a.fx, degree=a.degree)
    print(json.dumps(info, ensure_ascii=False))
    sys.exit(0 if info["applied"] else 1)


if __name__ == "__main__":
    main()
