"""ゲンロックなしで、2 台のカメラ(a7 の動画と iPhone「撮影記録」の動画)の時刻を合わせる。

  python place/shootlog/sync_flash.py --a <a7 の動画> --b <iPhone の video.mov> [--b-shoot <撮影フォルダ>] --out sync.json

LED に流した白いフラッシュ(make_sync_pattern.py の映像)を両方が撮っていれば、全体の明るさの急な立ち上がりの時刻が、
両方の映像で同じ瞬間を指す。立ち上がりを順に対にして、時刻の対応 t_a = alpha * t_b + beta(alpha はほぼ 1、a と b の時計の進みの差)を求める。
  --b-shoot を付けると b の時刻は frames.jsonl の pts(コマが不ぞろいでも正しい)。無ければ fps から。
出力 sync.json: alpha, beta, 対の数, 残差(ms と a のコマ数)、見つけたフラッシュの時刻。
使い方: b の時刻 t_b に対応する a の時刻は alpha * t_b + beta。
目安: フラッシュは 4〜6 回、間隔が不ぞろい(対の取り違えを避ける)。残差が 1 コマ(a のコマ間隔)より大きければ警告。
**時計の進みの比(alpha)は、撮影の頭と終わりの 2 か所にフラッシュがあって初めて正しく出る**(12 秒の 1 か所だけだと alpha が 1 から大きくずれる)。1 か所だけのときは alpha=1 に固定したほうがよい。
"""
from __future__ import annotations

import argparse
import json
from itertools import product
from pathlib import Path

import shutil
import subprocess

import cv2
import numpy as np


def _fps_of(video: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate", "-of", "csv=p=0", str(video)],
                       capture_output=True, text=True)
    num, _, den = r.stdout.strip().partition("/")
    return float(num) / float(den or 1) if num else 30.0


def luma_series_ffmpeg(video: str, times_from, w=160, h=90, window=None):
    """ffmpeg で縮小して読む(長い 5680×1240 の動画でも速い)。window=(開始秒, 終了秒)で区間だけ読める。"""
    fps = _fps_of(video)
    cmd = ["ffmpeg", "-v", "error", "-threads", "0"]
    if window:
        cmd += ["-ss", str(window[0]), "-t", str(window[1] - window[0])]
    cmd += ["-i", str(video), "-an", "-vf", f"scale={w}:{h}:flags=area,format=gray", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    frames = np.frombuffer(raw, np.uint8)
    n = len(frames) // (w * h)
    y = frames[: n * w * h].reshape(n, h * w).mean(axis=1)
    t0 = window[0] if window else 0.0
    t = np.array(times_from) if times_from is not None else t0 + np.arange(n) / fps
    m = min(n, len(t))
    return t[:m], y[:m], fps


def luma_series(video: str, times_from: list[float] | None = None, scale_w=160, window=None):
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        try:
            t, y, fps = luma_series_ffmpeg(video, times_from, window=window)
            if len(y) > 1:
                return t, y, fps
        except Exception:
            pass
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    vals = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        small = cv2.resize(img, (scale_w, max(1, int(img.shape[0] * scale_w / img.shape[1]))), interpolation=cv2.INTER_AREA)
        vals.append(float(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).mean()))
    cap.release()
    t = np.array(times_from) if times_from is not None else np.arange(len(vals)) / fps
    n = min(len(vals), len(t))
    return t[:n], np.array(vals[:n]), fps


def rising_edges(t: np.ndarray, y: np.ndarray, min_gap_s=0.25, min_contrast=8.0):
    """明るさが「中間の値」を下から上へ横切る時刻(コマの間は直線で補間)。"""
    lo, hi = np.percentile(y, 5), np.percentile(y, 95)
    if hi - lo < min_contrast:
        return []
    mid = (lo + hi) / 2
    out = []
    for i in range(1, len(y)):
        if y[i - 1] < mid <= y[i]:
            frac = (mid - y[i - 1]) / (y[i] - y[i - 1])
            te = t[i - 1] + frac * (t[i] - t[i - 1])
            if not out or te - out[-1] >= min_gap_s:
                out.append(float(te))
    return out


def pair_edges(ea: list[float], eb: list[float]):
    """2 つの立ち上がりの並びを、一次式 t_a = alpha*t_b + beta でいちばん合う形で対にする(数が違っても、連続した部分で)。"""
    best = None
    na, nb = len(ea), len(eb)
    k = min(na, nb)
    if k < 2:
        raise SystemExit(f"フラッシュが足りない(a: {na} 回、b: {nb} 回)。2 回以上、できれば 4 回以上要る")
    for sa in range(0, na - k + 1):
        for sb in range(0, nb - k + 1):
            a = np.array(ea[sa:sa + k])
            b = np.array(eb[sb:sb + k])
            A = np.stack([b, np.ones_like(b)], axis=1)
            coef, *_ = np.linalg.lstsq(A, a, rcond=None)
            res = a - A @ coef
            cost = float(np.sqrt(np.mean(res**2)))
            if best is None or cost < best[0]:
                best = (cost, coef, sa, sb, k, res)
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--b-shoot", default=None)
    ap.add_argument("--out", default="sync.json")
    ap.add_argument("--a-window", nargs=2, type=float, metavar=("START_S", "END_S"), help="a の動画のうち、フラッシュが入っている区間だけ読む(長い動画を速くする)")
    a = ap.parse_args()

    ta, ya, fps_a = luma_series(a.a, window=tuple(a.a_window) if a.a_window else None)
    tb_override = None
    if a.b_shoot:
        frames = [json.loads(line) for line in (Path(a.b_shoot) / "frames.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        tb_override = [f["pts"] for f in frames]
    tb, yb, fps_b = luma_series(a.b, tb_override)
    ea, eb = rising_edges(ta, ya), rising_edges(tb, yb)
    cost, coef, sa, sb, k, res = pair_edges(ea, eb)
    alpha, beta = float(coef[0]), float(coef[1])
    frame_a = 1.0 / fps_a
    out = {
        "alpha": alpha, "beta": beta, "pairs": int(k),
        "residual_rms_ms": round(cost * 1000, 2), "residual_max_ms": round(float(np.abs(res).max()) * 1000, 2),
        "residual_in_a_frames": round(cost / frame_a, 3),
        "a_fps": fps_a, "flashes_a": ea, "flashes_b": eb, "paired_from_a": sa, "paired_from_b": sb,
        "use": "b の時刻 t_b に対応する a の時刻 = alpha * t_b + beta",
    }
    ok = cost < frame_a
    out["ok"] = bool(ok)
    Path(a.out).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"フラッシュ a:{len(ea)} 回、b:{len(eb)} 回 → {k} 対。t_a = {alpha:.6f}·t_b + {beta:.4f} s、残差 {out['residual_rms_ms']} ms(a の {out['residual_in_a_frames']} コマ)")
    if not ok:
        print("警告: 残差が 1 コマより大きい。フラッシュの検出か、対の取り方を確かめる(明るさの変化が LED 以外にもないか)")


if __name__ == "__main__":
    main()
