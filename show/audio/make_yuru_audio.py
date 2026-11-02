"""ゆるキャラのショーの音と timeline を作る(声なしの曲の頭を切って使う。分離は通さない)。
使い方: python show/audio/make_yuru_audio.py --song <wav> --until 22.8 --script show/show_script.json --out <フォルダ>
  --until  歌い出しの秒。これより前の最後の小節頭で切る
出力: yuru_mix.wav(48kHz 24bit ステレオ)、timeline.json(sections・beats・downbeats・bpm・energy・sync)
流れ: preroll → sync_head → show → tail → sync_tail → black_end。拍は一定の BPM の格子(show_beats.py)。
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).parent))
import show_beats  # noqa: E402

SR = 48000
FPS = 60
FADE_IN_SEC = 0.3
FADE_OUT_SEC = 1.0
PEAK_DB = -1.0
BEEP_EDGE_SEC = 0.005
ANALYZE_EXTRA_SEC = 3.0
PREROLL_SEC = 20
SYNC_SEC = 12
TAIL_SEC = 3
BLACK_END_SEC = 3


def add_beeps(mix, sync, starts):
    count = int(round(sync["beep_sec"] * SR))
    tone = np.sin(2 * np.pi * sync["beep_hz"] * np.arange(count) / SR) * 10 ** (sync["beep_db"] / 20)
    edge = int(BEEP_EDGE_SEC * SR)
    ramp = np.linspace(0, 1, edge)
    tone[:edge] *= ramp
    tone[-edge:] *= ramp[::-1]
    for section_start in starts:
        for at in sync["flash_starts"]:
            pos = int(round((section_start + at) * SR))
            mix[pos:pos + count] += tone[:, None]


def frame_energy(mono, frames):
    """コマごとの音の強さ(0〜1)。背景の模様に使う"""
    hop = SR // FPS
    rms = np.array([np.sqrt(np.mean(mono[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(frames)])
    return np.clip(rms / np.percentile(rms, 98), 0, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--song", required=True)
    ap.add_argument("--until", type=float, required=True)
    ap.add_argument("--script", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sync = json.loads(Path(a.script).read_text(encoding="utf-8"))["sync"]

    x, sr = sf.read(a.song, always_2d=True)
    if sr != SR:
        x = resample_poly(x, SR, sr, axis=0)
    head = x[: int((a.until + ANALYZE_EXTRA_SEC) * SR)]
    grid = show_beats.analyze(head.mean(axis=1), SR)
    downs = [d for d in grid["downbeats"] if d <= a.until]
    cut_a, cut_b = downs[0], downs[-1]
    show_frames = int(round((cut_b - cut_a) * FPS))
    first_sample = int(round(cut_a * SR))
    song = x[first_sample : first_sample + show_frames * (SR // FPS)].copy()
    ramp_in = int(FADE_IN_SEC * SR)
    ramp_out = int(FADE_OUT_SEC * SR)
    song[:ramp_in] *= np.linspace(0, 1, ramp_in)[:, None]
    song[-ramp_out:] *= np.linspace(1, 0, ramp_out)[:, None]
    song *= 10 ** (PEAK_DB / 20) / max(float(np.abs(song).max()), 1e-6)

    show_start = PREROLL_SEC + SYNC_SEC
    show_end = show_start + show_frames / FPS
    spans = [("preroll", 0, PREROLL_SEC), ("sync_head", PREROLL_SEC, SYNC_SEC), ("show", show_start, show_frames / FPS),
             ("tail", show_end, TAIL_SEC), ("sync_tail", show_end + TAIL_SEC, SYNC_SEC), ("black_end", show_end + TAIL_SEC + SYNC_SEC, BLACK_END_SEC)]
    sections = [{"id": s, "start": round(t, 6), "end": round(t + d, 6)} for s, t, d in spans]
    total = sections[-1]["end"]
    frames = int(round(total * FPS))
    mix = np.zeros((frames * (SR // FPS), 2))
    first = show_start * SR
    mix[first : first + len(song)] = song
    add_beeps(mix, sync, [sections[1]["start"], sections[4]["start"]])
    sf.write(out / "yuru_mix.wav", mix, SR, subtype="PCM_24")

    shift = show_start - cut_a
    beats = [round(b + shift, 4) for b in grid["beats"] if cut_a - 1e-6 <= b < cut_b - 1e-6]
    downbeats = [round(b + shift, 4) for b in downs[:-1]]
    timeline = {"fps": FPS, "duration_sec": total, "frames": frames, "sections": sections, "beats": beats, "downbeats": downbeats, "bpm": grid["bpm"],
                "energy": [round(float(v), 3) for v in frame_energy(mix.mean(axis=1), frames)],
                "sync": {"flash_starts": sync["flash_starts"], "flash_sec": sync["flash_sec"]},
                "source": {"song": Path(a.song).name, "cut_sec": [cut_a, cut_b], "grid": grid["info"]}}
    (out / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False), encoding="utf-8")
    print(f"切り出し {cut_a}〜{cut_b} 秒、ショー {show_frames / FPS:.3f} 秒、小節 {len(downbeats)}、BPM {grid['bpm']}、全編 {total:.3f} 秒 {frames} コマ")


if __name__ == "__main__":
    main()
