"""超広角の固定カットの「解く」道具(案 1): 動かないカメラの位置・向き・焦点距離を、LED に光らせた点から 1 回解き、合成に渡す形にする。

  python place/shootlog/uw_fixed_camera.py --video <点を撮った超広角.mov> --info <同じ名前.json> --out <出力フォルダ> [--shot <本番の超広角.mov>]
  試し(自宅のモニター): --curved で、点の位置を曲面のモニターの形にして、曲率も解く
入力: iPad の画面の超広角で、固定のまま点の映像(1 周 11.4 秒)を撮った物。同じ置き場のまま本番を撮る。
出力: camera.json(舞台の座標のカメラの位置 cm・向き・K・誤差)、frames.jsonl と meta.json(撮影記録の形。全部のコマが同じ姿勢。--shot を付けたとき、そのコマ数の分)、
alignment_A/B/C.json(--shot を付けたとき。世界が舞台の座標なので面の位置は図面どおり。shoot_track.build_track() がそのまま読む)。
舞台の座標: show/ue/stage_layout.py と同じ(cm、x 右、y 客席、z 上)。世界の座標は撮影記録の決まりに合わせて y 上(x, z, -y ではなく (x, z, y) の右手系に直す)で書く。
解き方: 点の 3D は、面が前後に 1.4 m ずれているので(B 面)、1 視点でも焦点距離を一緒に解ける(--solve-focal)。歪みは iOS の補正のあとの残りとして k1 だけを解く。外れた点は除く。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import least_squares

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dots_align  # noqa: E402
from make_led_dots_video import GAP, ON, STEP, dots  # noqa: E402


def find_dots(video: str, fps: float = 30.0):
    """映像から点を拾う。合図(全面の緑)が消えてからの時間で番号を決める。{番号: [(u, v)...]} を 4K の画素で返す。"""
    table = dots()
    W, H = 1920, 1080
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    fs, fi = W * H * 3, 0
    sync_end, in_sync, sync_start = None, False, 0.0
    in_ev, frames, quiet = False, [], 0
    found: dict[int, list] = {}
    syncs = 0
    base = None
    while True:
        buf = p.stdout.read(fs)
        if len(buf) < fs:
            break
        t = fi / fps
        fi += 1
        img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16)
        b, g, r = img[..., 0], img[..., 1], img[..., 2]
        raw = ((g - np.maximum(b, r)) > 25) & (g > 45)        # 暗い周(35%)も拾う
        if base is None:
            base = raw.astype(np.float32)
        m = raw & (base < 0.25)
        base = base * 0.97 + raw.astype(np.float32) * 0.03
        if int(m.sum()) > 0.05 * W * H:
            if not in_sync:
                sync_start = t
            in_sync, in_ev, frames = True, False, []
            continue
        if in_sync:
            in_sync = False
            if 0.25 <= t - sync_start <= 0.6:
                sync_end, syncs = t, syncs + 1
        n, _, st, cen = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
        best = None
        for i in range(1, n):
            x, y, w, h, area = st[i]
            if area < 6 or area > 6000 or not 0.4 < w / h < 2.5 or area / (w * h) < 0.5:
                continue
            if best is None or area > best[0]:
                best = (area, cen[i])
        if best is not None:
            if not in_ev:
                in_ev, frames = True, []
            quiet = 0
            frames.append((t, best[1][0] * 2, best[1][1] * 2))
            continue
        if not in_ev:
            continue
        quiet += 1
        if quiet < 2:
            continue
        in_ev = False
        if len(frames) < 2 or frames[-1][0] - frames[0][0] > 0.35 or sync_end is None:
            continue
        q = ((frames[0][0] + frames[-1][0]) / 2 - sync_end - GAP - ON / 2) / STEP
        k = int(round(q))
        if abs(q - round(q)) * STEP > 0.1 or not 0 <= k < len(table):
            continue
        mid = frames[len(frames) // 2]
        found.setdefault(k, []).append((mid[1], mid[2]))
    p.stdout.close()
    p.terminate()
    return found, syncs, fi


def solve_pose(P3, P2, K0, solve_focal=False, solve_k1=False):
    """姿勢(と、望めば焦点距離と k1)を解く。外れを除いて 3 回解き直す。"""
    use = np.ones(len(P3), bool)
    ok, rv, tv, _ = cv2.solvePnPRansac(P3, P2, K0, np.zeros(5), reprojectionError=40.0, iterationsCount=500, flags=cv2.SOLVEPNP_ITERATIVE)
    fx = K0[0, 0]
    k1 = 0.0
    cx, cy = K0[0, 2], K0[1, 2]
    for _ in range(3):
        def res(x):
            f = x[6] if solve_focal else fx
            kk = x[7] if solve_k1 else k1
            K = np.array([[f, 0, cx], [0, f * K0[1, 1] / K0[0, 0], cy], [0, 0, 1.0]])
            pr, _ = cv2.projectPoints(P3[use], x[:3], x[3:6], K, np.array([kk, 0, 0, 0, 0.0]))
            return (pr.reshape(-1, 2) - P2[use]).ravel()
        x0 = np.r_[rv.ravel(), tv.ravel(), fx, k1]
        sol = least_squares(res, x0, loss="soft_l1", f_scale=3.0, max_nfev=300)
        rv, tv = sol.x[:3], sol.x[3:6]
        if solve_focal:
            fx = float(sol.x[6])
        if solve_k1:
            k1 = float(sol.x[7])
        K = np.array([[fx, 0, cx], [0, fx * K0[1, 1] / K0[0, 0], cy], [0, 0, 1.0]])
        pr, _ = cv2.projectPoints(P3, rv, tv, K, np.array([k1, 0, 0, 0, 0.0]))
        e = np.linalg.norm(pr.reshape(-1, 2) - P2, axis=1)
        lim = max(6.0, 2.5 * float(np.median(e[use])))
        keep = e <= lim
        if keep.sum() < 8 or (keep == use).all():
            break
        use = keep
    return rv, tv, fx, k1, e, use


def stage_points(table, keys):
    """舞台の座標(cm)→ 右手系 m(x 右、y 上、z 客席)"""
    return np.array([[table[k]["stage_cm"][0] / 100, table[k]["stage_cm"][2] / 100, table[k]["stage_cm"][1] / 100] for k in keys], np.float64)


def monitor_points(table, keys, radius_m):
    """自宅のモニター: 絵の座標 → 中央を原点に、半径 radius の円筒(手前が凹)の上の点(m)"""
    pitch = 1.2 / 5680
    out = []
    for k in keys:
        s = (table[k]["px"] - 2840) * pitch
        y = (1240 - table[k]["py"]) * pitch
        if radius_m:
            th = s / radius_m
            out.append([radius_m * np.sin(th), y, radius_m * (1 - np.cos(th))])
        else:
            out.append([s, y, 0.0])
    return np.array(out, np.float64)


def camera_result(rv, tv, fx, k1, e, use, faces, K_ios):
    """solve_pose の結果 → camera.json の中身(舞台の座標のカメラの位置・T・K・誤差)。"""
    fx0, fy0, cx0, cy0 = K_ios
    R, _ = cv2.Rodrigues(np.asarray(rv))
    cam = (-R.T @ np.asarray(tv)).ravel()
    per = {f: {"rms_px": round(float(np.sqrt((e[[i for i, x in enumerate(faces) if x == f]] ** 2).mean())), 2), "points": faces.count(f)} for f in sorted(set(faces))}
    # OpenCV のカメラ(x 右、y 下、z 前)→ 撮影記録のカメラ(x 右、y 上、z 後ろ)で、カメラ → 世界 の 4×4
    D = np.diag([1.0, -1.0, -1.0])
    T = np.eye(4)
    T[:3, :3] = R.T @ D
    T[:3, 3] = cam
    fy = fx * fy0 / fx0
    return {"rms_px_4k": round(float(np.sqrt((e[use] ** 2).mean())), 2), "used": int(use.sum()), "per_face": per, "fx": round(fx, 2), "k1": round(k1, 5),
            "hfov_deg": round(float(2 * np.degrees(np.arctan(1920 / fx))), 2),
            "camera_stage_cm": [round(float(cam[0] * 100), 1), round(float(cam[2] * 100), 1), round(float(cam[1] * 100), 1)],
            "T_camera_to_world": T.T.flatten().tolist(), "K": [fx, fy, cx0, cy0], "size": [3840, 2160]}


def write_shoot(out, result, n, video):
    """撮影記録の形(frames.jsonl・meta.json)。全部のコマが同じ姿勢。K は 4K(3840 幅)の画素で、映像も 3840 幅。"""
    out = Path(out)
    with open(out / "frames.jsonl", "w", encoding="utf-8") as f:
        for i in range(n):
            f.write(json.dumps({"i": i, "t": i / 30.0, "pts": i / 30.0, "T": result["T_camera_to_world"], "K": result["K"], "track": "fixed", "ok": True}) + "\n")
    (out / "meta.json").write_text(json.dumps({"videoFile": str(Path(video).resolve()), "stats": {"width": 3840, "height": 2160, "frames": n}, "source": "ultrawide_fixed", "lens": "ultrawide",
                                               "note": "固定のカメラ。T は舞台の座標(右手系 m、x 右・y 上・z 客席)。alignment_A/B/C.json は同じ世界での面の位置(図面から)"}, ensure_ascii=False, indent=1), encoding="utf-8")


def write_stage_alignments(out, result):
    """alignment_A/B/C.json。世界が舞台の座標なので、面の位置は図面(stage_layout.py)のとおり。shoot_track.build_track() が読む。
    面ごとの誤差は、その面の点の画素の誤差(4K)。"""
    docs = dots_align.stage_world_docs(lambda face: {
        "source": "dots", "camera": "ultrawide_fixed", "rms_cm": None, "rms_px_4k": result["rms_px_4k"], "face_residual_px_4k": (result["per_face"].get(face) or {}).get("rms_px"),
        "dots_used": result["used"], "dots_used_on_face": (result["per_face"].get(face) or {}).get("points", 0), "dots_found": result["points"],
        "notes": "超広角の固定カット(uw_fixed_camera.py)。世界は舞台の座標。面ごとの形は図面から。"})
    for face, doc in docs.items():
        (Path(out) / f"alignment_{face}.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--info", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shot", help="本番の超広角の映像(撮影記録の形を作る)")
    ap.add_argument("--curved", action="store_true", help="自宅のモニターの試し: 曲率も解く")
    ap.add_argument("--solve-focal", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    info = json.loads(Path(a.info).read_text(encoding="utf-8"))
    fx0, fy0, cx0, cy0 = info["K"]
    K0 = np.array([[fx0, 0, cx0], [0, fy0, cy0], [0, 0, 1.0]])
    table = dots()
    found, syncs, nframes = find_dots(a.video)
    keys = sorted(found)
    print(f"コマ {nframes}、合図 {syncs}、拾えた点 {len(keys)}/{len(table)}", flush=True)
    if len(keys) < 8:
        raise SystemExit("点が 8 個より少なくて解けない。画角に LED が入っているか、緑が飛んでいないかを確かめる")
    P2 = np.array([np.mean(found[k], axis=0) for k in keys], np.float64)
    faces = [table[k]["face"] for k in keys]
    result: dict = {"points": len(keys), "syncs": syncs, "K_ios": info["K"]}
    if a.curved:
        rows = []
        for R in [None, 1.0, 1.2, 1.5, 1.8, 2.0, 2.3, 2.7, 3.0, 4.0, 6.0]:
            P3 = monitor_points(table, keys, R)
            rv, tv, fx, k1, e, use = solve_pose(P3, P2, K0, solve_focal=a.solve_focal)
            rows.append({"R_m": R, "rms_px": float(np.sqrt((e[use] ** 2).mean())), "used": int(use.sum()), "fx": fx})
            print(rows[-1], flush=True)
        best = min(rows, key=lambda r: (r["rms_px"] if r["used"] >= 0.8 * len(keys) else 1e9))
        result["curved"] = rows
        result["best"] = best
        P3 = monitor_points(table, keys, best["R_m"])
    else:
        P3 = stage_points(table, keys)
    rv, tv, fx, k1, e, use = solve_pose(P3, P2, K0, solve_focal=a.solve_focal, solve_k1=a.solve_focal)
    result.update(camera_result(rv, tv, fx, k1, e, use, faces, info["K"]))
    (out / "camera.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("rms_px_4k", "used", "per_face", "fx", "k1", "hfov_deg", "camera_stage_cm")}, ensure_ascii=False))
    if a.shot:
        r = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", a.shot], capture_output=True, text=True)
        n = int(r.stdout.strip().split()[0])
        write_shoot(out, result, n, a.shot)
        if a.curved:
            print("(--curved は自宅のモニターの試し。世界が舞台の座標ではないので alignment は書かない)")
        else:
            write_stage_alignments(out, result)
        print("撮影記録の形:", out / "frames.jsonl", n, "コマ")


if __name__ == "__main__":
    main()
