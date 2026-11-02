"""音の無い実写が、全編の音のどこに当たるかを、LED の明るさの変化だけで求める。

実写の明るさ(LED の範囲の平均)と元の LED 映像の明るさの差分を相関させ、実写の 0 秒が全編の何秒かを返す。
使い方: python sync_by_led.py <実写> <元の LED 映像> [--box x0 y0 x1 y1](0〜1 の割合。無ければ全画面)
"""
import argparse
import json
import subprocess

import numpy as np

FPS = 30
SMALL = (64, 36)
UP_FACTOR = 4  # 相関の山をなめらかに補う倍率
NOISE_FLOOR = 0.15  # 明るさの平方根の 1 コマの差のうち、ノイズとみなす大きさ


def brightness(path, box=None):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf",
                          f"fps={FPS},scale={SMALL[0]}:{SMALL[1]},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True, stdin=subprocess.DEVNULL).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, SMALL[1], SMALL[0]).astype(np.float32)
    if box:
        x0, y0, x1, y1 = box
        frames = frames[:, int(y0 * SMALL[1]):max(int(y1 * SMALL[1]), int(y0 * SMALL[1]) + 1),
                        int(x0 * SMALL[0]):max(int(x1 * SMALL[0]), int(x0 * SMALL[0]) + 1)]
    return frames.mean(axis=(1, 2))


def signal(values):
    """明るさの直線性に強くするため、平方根の差分を、局所の大きさでならす。暗い所のノイズは持ち上げない。"""
    diff = np.diff(np.sqrt(np.maximum(values, 0.0)))
    scale = np.convolve(np.abs(diff), np.ones(FPS * 2) / (FPS * 2), mode="same") + NOISE_FLOOR
    return diff / scale


def find_offset(shot, source):
    """実写の 0 コマ目が元の映像の何コマ目か(負もあり)と、相関の高さ、2 番目の山との比を返す。"""
    a, b = signal(shot), signal(source)
    size = a.size + b.size
    n = 1 << int(np.ceil(np.log2(size * 2)))
    spectrum = np.fft.rfft(b, n) * np.conj(np.fft.rfft(a, n))
    corr = np.fft.irfft(spectrum, n * UP_FACTOR) * UP_FACTOR
    lags = np.arange(corr.size)
    lags[lags > corr.size // 2] -= corr.size
    peak = int(np.argmax(corr))
    norm = np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9
    away = np.abs(lags - lags[peak]) > FPS * UP_FACTOR
    return lags[peak] / UP_FACTOR, float(corr[peak] / norm), float(corr[peak] / max(corr[away].max(), 1e-9))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shot")
    parser.add_argument("source")
    parser.add_argument("--box", nargs=4, type=float)
    args = parser.parse_args()
    frames, score, ratio = find_offset(brightness(args.shot, args.box), brightness(args.source))
    print(json.dumps({"shot_zero_at_show_sec": round(frames / FPS, 4), "offset_frames": frames,
                      "corr": round(score, 3), "peak_over_second": round(ratio, 2)}))


if __name__ == "__main__":
    main()
