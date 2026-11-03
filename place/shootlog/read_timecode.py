"""カメラの映像(画面の盤とコマ番号の帯が写っている)から、画面のコマ番号を各コマで読み、カメラの時刻との対応を出す。

  python place/shootlog/read_timecode.py --faces faces.json --face center --video <動画> [--times <frames.jsonl>] [--out timecode_fit.json] [--every 1]
やること: ①盤(ChArUco)の角から、面→画像の射影を求める ②上と下の帯のコマ番号を読む ③カメラの時刻(--times の pts)と画面のコマ番号を一次式で合わせる。
出力: 時刻の対応(画面のコマ番号 = rate × カメラの時刻 + offset)・残差(ms)・落ちたコマ・上下の帯の差(ローリングシャッターで進んだコマ数)・読めなかったコマ数。
画面の更新が 60 Hz のとき rate ≈ 60。画面側の時刻(PC の時刻と画面のコマ番号の対応)は、表示ページの記録(calib_pattern.html の __tc)と組み合わせる。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import timecode as TC  # noqa: E402
from lenslib import Board, detect_corners  # noqa: E402


def load_face(path, name):
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    for f in spec["faces"]:
        if f["name"] == name:
            b = f["board"]
            board = Board(**{k: (tuple(v) if k in ("offset_px", "face_px") else v) for k, v in b.items()})
            return board, f["timecode"]["strips"]
    raise SystemExit(f"面 {name} が faces.json に無い")


def face_homography(gray, board: Board):
    """盤の角から、面の画素 → 画像の画素のホモグラフィー。"""
    r = detect_corners(gray, board, min_corners=8)
    if r is None:
        return None, 0
    c, ids = r
    xyz = board.corner_led_m(ids)
    W, H = board.face_px
    face_px = np.stack([xyz[:, 0] / board.pitch_m, H - xyz[:, 1] / (board.pitch_y_m or board.pitch_m)], axis=1).astype(np.float32)
    Hm, mask = cv2.findHomography(face_px, c.astype(np.float32), cv2.RANSAC, 3.0)
    return Hm, int(mask.sum()) if mask is not None else 0


def decode_frame(gray, board: Board, strips):
    Hm, n_in = face_homography(gray, board)
    if Hm is None:
        return None
    out = {"corners": n_in}
    for s in strips:
        n, norm, amb = TC.decode(gray, Hm, s)
        out[s["name"]] = {"n": n, "ambiguous_bits": amb, "norm": [round(float(v), 2) for v in norm]}
    return out


def unwrap(ns, period=1 << TC.BITS):
    ns = np.array(ns, float)
    out = ns.copy()
    for i in range(1, len(ns)):
        d = ns[i] - ns[i - 1]
        out[i:] -= period * np.round(d / period) if abs(d) > period / 2 else 0
    return out


def fit(times, counts, fps_nominal=60.0):
    """counts = rate × times + offset の最小二乗(外れ値を 3 回削る)。"""
    t, n = np.array(times, float), np.array(counts, float)
    keep = np.ones(len(t), bool)
    for _ in range(3):
        A = np.stack([t[keep], np.ones(keep.sum())], axis=1)
        (rate, off), *_ = np.linalg.lstsq(A, n[keep], rcond=None)
        res = n - (rate * t + off)
        sd = res[keep].std() or 1e-9
        keep = np.abs(res) < max(3 * sd, 0.6)
    res_ms = res / rate * 1000.0
    return float(rate), float(off), res_ms, keep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--faces", required=True)
    ap.add_argument("--face", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--times", default=None, help="frames.jsonl(各行の pts を映像のコマの時刻とする)")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--out", default="timecode_fit.json")
    ap.add_argument("--every", type=int, default=1)
    a = ap.parse_args()
    board, strips = load_face(a.faces, a.face)
    pts = None
    if a.times:
        pts = [json.loads(x)["pts"] for x in Path(a.times).read_text(encoding="utf-8").splitlines() if x.strip()]
    cap = cv2.VideoCapture(a.video)
    rows, i = [], 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if i % a.every == 0:
            d = decode_frame(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), board, strips)
            t = pts[i] if pts and i < len(pts) else i / a.fps
            rows.append({"frame": i, "t": t, "decoded": d})
        i += 1
    cap.release()
    good = [r for r in rows if r["decoded"] and r["decoded"]["top"]["n"] is not None]
    result = {"frames_read": len(rows), "frames_decoded_clean": len(good), "frames_no_board": sum(1 for r in rows if r["decoded"] is None)}
    if len(good) >= 4:
        tt = [r["t"] for r in good]
        nn = unwrap([r["decoded"]["top"]["n"] for r in good])
        rate, off, res_ms, keep = fit(tt, nn)
        result.update({"rate_per_s": rate, "offset": off, "residual_ms": {"rms": float(np.sqrt(np.mean(res_ms[keep] ** 2))), "max": float(np.abs(res_ms[keep]).max()), "outliers": int((~keep).sum())}})
        both = [r for r in good if r["decoded"]["bottom"]["n"] is not None]
        if both:
            diffs = np.array([((r["decoded"]["bottom"]["n"] - r["decoded"]["top"]["n"] + (1 << 15)) % (1 << 16)) - (1 << 15) for r in both], float)
            result["rolling_shutter_frames_top_to_bottom"] = {"mean": float(diffs.mean()), "ms": float(diffs.mean() / rate * 1000)}
        # 落ちたコマ: 映像のコマ番号の差に対して、画面のコマ番号の進みが一定でない所
        steps = np.diff(nn) / rate
        if pts:
            dts = np.diff(tt)
            result["dropped_or_stalled"] = int(np.sum(np.abs(steps - dts) > 0.5 / rate + 0.5 * np.median(dts)))
    Path(a.out).write_text(json.dumps({"summary": result, "rows": rows}, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
