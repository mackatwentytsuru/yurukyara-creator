"""撮った mp4 の明るさの変化を元の映像と比べ、ずれのコマ数を測る。音が付いていれば、白い光と音の始まりの差も測る。

使い方: python measure_sim_sync.py <元の映像> <撮った mp4> [--start 秒]
"""
import argparse
import json
import subprocess

import numpy as np

FPS = 30
MAX_LAG = 30
WINDOW = 90
AUDIO_RATE = 48000
SMALL = (32, 18)
FLASH_RATIO = 0.8  # 明るさの範囲のこの位置を超えたら光とみなす


def brightness(path, start=0.0):
    """30p の 1 コマごとの平均の明るさ。"""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", path,
                          "-vf", f"fps={FPS},scale={SMALL[0]}:{SMALL[1]},format=gray",
                          "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, SMALL[1], SMALL[0]).mean(axis=(1, 2))


def best_lag(source, shot):
    """shot[i] が source[i + lag] に一番似る lag と、その相関。正なら撮った絵が先へ進んでいる。"""
    best = (0, -2.0)
    for lag in range(-MAX_LAG, MAX_LAG + 1):
        a0 = max(0, -lag)
        count = min(shot.size - a0, source.size - a0 - lag)
        if count < 10:
            continue
        a = shot[a0:a0 + count]
        b = source[a0 + lag:a0 + lag + count]
        if a.std() == 0 or b.std() == 0:
            continue
        score = float(np.corrcoef(a, b)[0, 1])
        if score > best[1]:
            best = (lag, score)
    return best


def audio_onsets(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(AUDIO_RATE),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    samples = np.abs(np.frombuffer(raw, np.float32))
    if samples.size == 0 or samples.max() == 0:
        return []
    loud = samples > samples.max() * 0.5
    rising = np.flatnonzero(loud[1:] & ~loud[:-1]) / AUDIO_RATE
    return [float(t) for i, t in enumerate(rising) if i == 0 or t - rising[i - 1] > 0.5]


def flashes(values):
    limit = values.min() + (values.max() - values.min()) * FLASH_RATIO
    bright = values > limit
    return [i / FPS for i in np.flatnonzero(bright[1:] & ~bright[:-1]) + 1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("shot")
    parser.add_argument("--start", type=float, default=0.0)
    args = parser.parse_args()
    source = brightness(args.source, args.start)
    shot = brightness(args.shot)
    lag, score = best_lag(source, shot)
    windows = []
    for begin in range(0, max(1, shot.size - WINDOW + 1), WINDOW):
        part_lag, part_score = best_lag(source[max(0, begin - MAX_LAG):begin + WINDOW + MAX_LAG], shot[begin:begin + WINDOW])
        windows.append({"from_frame": begin, "lag": part_lag - min(begin, MAX_LAG), "corr": round(part_score, 3)})
    result = {"frames": int(shot.size), "lag_frames": lag, "corr": round(score, 4), "windows": windows,
              "brightness_range": [round(float(shot.min()), 1), round(float(shot.max()), 1)]}
    beeps = audio_onsets(args.shot)
    if beeps:
        pairs = [(light, min(beeps, key=lambda b: abs(b - light))) for light in flashes(shot)]
        result["flash_minus_audio_ms"] = [round((a - b) * 1000) for a, b in pairs]
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
