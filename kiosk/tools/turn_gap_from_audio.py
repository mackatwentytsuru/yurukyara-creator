"""録音(動画でもよい)から、「人の声の塊が終わってから、返事の声の塊が始まるまでの無音」を測る(外からの遅れの測り方)。
  python kiosk/tools/turn_gap_from_audio.py --audio rec.m4a [--threshold-db -35] [--min-gap 0.25] [--out gaps.json]
順番に話す(重ならない)会話なので、二人の声を分けずに、声の塊と塊のあいだの無音を、往復ごとの遅れとして数える。
限界: (1) 曲やざわめきが鳴っていると、無音にならないので使えない(曲なしで測る)。(2) 人の「えー」や返事の間(ま)も無音に入る。
        奇数番目の隙間 = 本人 → 返事、偶数番目 = 返事 → 本人 の目安。いちばん長い隙間(考え込み)は外れ値として別に出す。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 16000


def load(path: str) -> np.ndarray:
    tmp = Path(tempfile.mkdtemp()) / "a.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), str(tmp)], check=True)
    with wave.open(str(tmp), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def bursts(x: np.ndarray, threshold_db: float, min_gap: float, win: float = 0.02) -> list[tuple[float, float]]:
    n = int(SR * win)
    frames = x[: len(x) // n * n].reshape(-1, n)
    level = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-9)
    on = level > threshold_db
    segs, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        if not v and start is not None:
            segs.append([start * win, i * win])
            start = None
    if start is not None:
        segs.append([start * win, len(on) * win])
    merged = []
    for s in segs:  # min_gap より短い無音は、同じ塊の中の間(ま)として つなぐ
        if merged and s[0] - merged[-1][1] < min_gap:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return [(round(a, 2), round(b, 2)) for a, b in merged if b - a >= 0.15]


def gaps(segs: list[tuple[float, float]]) -> list[float]:
    return [round(b[0] - a[1], 2) for a, b in zip(segs, segs[1:])]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--threshold-db", type=float, default=-35.0)
    ap.add_argument("--min-gap", type=float, default=0.25)
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    segs = bursts(load(a.audio), a.threshold_db, a.min_gap)
    g = gaps(segs)
    res = {"声の塊": segs, "塊のあいだの無音_秒": g, "奇数番目(本人→返事の目安)": g[0::2], "偶数番目(返事→本人の目安)": g[1::2]}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.out:
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
