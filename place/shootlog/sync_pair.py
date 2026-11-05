"""2 台(iPad と iPhone など)の撮影の映像から、LED の暗転・フラッシュ(明るさの急な変化)を探して、2 台の時刻のずれを出す。

  python sync_pair.py --a <テイク A の撮影の形のフォルダ> --b <テイク B のフォルダ> [--ffmpeg ffmpeg]
各フォルダに video.mp4 と frames.jsonl(pc_to_frames.py が作る)。コマの時刻は frames.jsonl の pts(本当の時刻。映像の 30 fps は目安)を使う。
出力: B の時刻 − A の時刻(秒。同じ出来事が B で何秒遅く写ったか)、合った出来事の数、ばらつき。A と B で見えた出来事が同じ LED の暗転・フラッシュであることが前提(2 台とも LED が見える)。
ほかの照合: 受け手が出す端末ごとの時計のずれ(summary.json の clock)でも、2 台を PC の時計にそろえられる(誤差は往復の半分ほど)。この道具は、その確かめ(独立の目印)。
映像の絵は保存しない。ffmpeg が要る。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SMALL = (32, 18)
STEP_THRESHOLD = 4.0     # 平方根の明るさ(0〜16)の 2 コマの差。暗転(100→0)で約 10、フラッシュ(5→170)で約 11
BIN_SEC = 0.1


def brightness(video: Path, ffmpeg: str):
    raw = subprocess.run([ffmpeg, "-v", "error", "-i", str(video), "-vf", f"scale={SMALL[0]}:{SMALL[1]}:flags=area,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True, stdin=subprocess.DEVNULL).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, SMALL[0] * SMALL[1]).astype(np.float32).mean(axis=1)


def events(video: Path, pts: list[float], ffmpeg: str):
    """明るさの急な変化の時刻(秒)の一覧。[(時刻, 向き +1=明るくなる / -1=暗くなる)]"""
    m = np.sqrt(np.maximum(brightness(video, ffmpeg), 0.0))
    n = min(len(m), len(pts))
    out, i = [], 2
    while i < n:
        d = m[i] - m[i - 2]
        if abs(d) >= STEP_THRESHOLD:
            out.append((float(pts[i - 1]), int(np.sign(d))))
            i += 3          # 立ち上がり・立ち下がりの間(平らな所では 2 コマの差が小さいので、立ち下がりは別の出来事として拾える)
        else:
            i += 1
    return out


def best_offset(ev_a, ev_b):
    """同じ向きの出来事どうしの差を集め、いちばん多く一致するずれを返す(窓 0.1 秒)。"""
    diffs = [tb - ta for ta, da in ev_a for tb, db in ev_b if da == db and abs(tb - ta) < 30]
    if not diffs:
        return None
    arr = np.array(diffs)
    best, best_n = None, 0
    for c in arr:
        near = arr[np.abs(arr - c) <= BIN_SEC]
        if len(near) > best_n:
            best, best_n = float(np.median(near)), len(near)
    near = arr[np.abs(arr - best) <= BIN_SEC]
    return {"offset_sec": round(best, 4), "matched": int(best_n), "spread_sec": round(float(near.max() - near.min()), 4), "events_a": len(ev_a), "events_b": len(ev_b)}


def load_pts(folder: Path):
    return [json.loads(line)["pts"] for line in (folder / "frames.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a", type=Path, required=True)
    ap.add_argument("--b", type=Path, required=True)
    ap.add_argument("--ffmpeg", default="ffmpeg")
    a = ap.parse_args()
    ev_a = events(a.a / "video.mp4", load_pts(a.a), a.ffmpeg)
    ev_b = events(a.b / "video.mp4", load_pts(a.b), a.ffmpeg)
    result = best_offset(ev_a, ev_b)
    print(json.dumps(result if result else {"error": "同じ向きの出来事が見つからない", "events_a": len(ev_a), "events_b": len(ev_b)}, ensure_ascii=False))
    return 0 if result and result["matched"] >= 2 else 1


if __name__ == "__main__":
    sys.exit(main())
