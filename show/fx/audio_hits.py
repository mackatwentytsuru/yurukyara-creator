"""音から打点を取る。低音(キック)・中高音(スネア)・高音の長い音(クラッシュ)を別々に、強さの順位つきで返す。

timeline の energy は音圧のそろった曲だと平らで(実測 0.84〜0.96)、強い音と弱い音を分けられない。
ここでは帯ごとの振幅の増え方(flux)で強さを測り、帯の中の順位(0〜1)にする。
秒はファイルからだけ決まる。曲が替わってもコードは変えない。
"""
import json
import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 48000
FFT_SIZE = 2048
HOP = 240  # 5 ms
FLUX_LAG = 4  # 20 ms 前との差。立ち上がりだけを見る
BANDS = {"kick": (30.0, 150.0), "snare": (1200.0, 5000.0), "crash": (6000.0, 16000.0)}
MIN_GAP_SEC = {"kick": 0.12, "snare": 0.12, "crash": 0.25}
FLOOR_OF_P99 = 0.2  # p99 のこの割合より弱い立ち上がりは打点にしない
CRASH_SUSTAIN_SEC = 0.25  # クラッシュはハイハットより長く鳴る。その比を強さに掛ける
CHUNK_FRAMES = 4096


def read_mono(path):
    """wav を 48 kHz モノラルの float32 で読む。"""
    command = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    done = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, check=True)
    return np.frombuffer(done.stdout, dtype=np.float32)


def band_amplitudes(samples):
    """帯ごとの振幅(パワーの平方根)。列は 5 ms ごと。"""
    window = np.hanning(FFT_SIZE).astype(np.float32)
    freqs = np.fft.rfftfreq(FFT_SIZE, 1.0 / SAMPLE_RATE)
    masks = {name: (freqs >= low) & (freqs < high) for name, (low, high) in BANDS.items()}
    count = max(0, (len(samples) - FFT_SIZE) // HOP + 1)
    out = {name: np.zeros(count, dtype=np.float32) for name in BANDS}
    for first in range(0, count, CHUNK_FRAMES):
        indices = np.arange(first, min(first + CHUNK_FRAMES, count))
        frames = np.stack([samples[i * HOP:i * HOP + FFT_SIZE] for i in indices]) * window
        power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
        for name, mask in masks.items():
            out[name][indices] = np.sqrt(power[:, mask].sum(axis=1))
    return out


def pick_peaks(values, min_gap):
    """強い順に取り、近い物を捨てる。戻りは位置の配列(時間順)。"""
    positive = values[values > 0]
    if positive.size == 0:
        return np.array([], dtype=int)
    floor = FLOOR_OF_P99 * np.percentile(positive, 99)
    is_peak = (values[1:-1] >= values[:-2]) & (values[1:-1] > values[2:]) & (values[1:-1] >= floor)
    candidates = np.where(is_peak)[0] + 1
    taken = []
    occupied = np.zeros(len(values), dtype=bool)
    for index in candidates[np.argsort(-values[candidates])]:
        if not occupied[index]:
            taken.append(index)
            occupied[max(0, index - min_gap):index + min_gap + 1] = True
    return np.array(sorted(taken), dtype=int)


def ranks(values):
    """0(いちばん弱い)〜 1(いちばん強い)の順位。"""
    if len(values) < 2:
        return np.ones(len(values))
    order = np.argsort(np.argsort(values))
    return order / (len(values) - 1)


def band_hits(name, amplitude):
    flux = np.zeros_like(amplitude)
    flux[FLUX_LAG:] = np.maximum(0.0, amplitude[FLUX_LAG:] - amplitude[:-FLUX_LAG])
    peaks = pick_peaks(flux, int(MIN_GAP_SEC[name] * SAMPLE_RATE / HOP))
    if peaks.size == 0:
        return []
    raw = flux[peaks].astype(np.float64)
    if name == "crash":
        span = int(CRASH_SUSTAIN_SEC * SAMPLE_RATE / HOP)
        sustain = np.array([amplitude[p:p + span].mean() / max(amplitude[p], 1e-6) for p in peaks])
        raw = raw * sustain
    strength = ranks(raw)
    # 窓の中心の時刻から、差を取った幅の半分だけ戻すと、音の立ち上がりの時刻になる
    times = (peaks * HOP + FFT_SIZE / 2.0) / SAMPLE_RATE - FLUX_LAG * HOP / 2.0 / SAMPLE_RATE
    return [{"t": round(float(t), 4), "band": name, "strength": round(float(s), 4)} for t, s in zip(times, strength)]


def analyze(path):
    amplitudes = band_amplitudes(read_mono(path))
    hits = [hit for name, amplitude in amplitudes.items() for hit in band_hits(name, amplitude)]
    return sorted(hits, key=lambda h: h["t"])


def find_source(timeline_path):
    """打点を取る音。分離したドラムがあれば優先し、次に伴奏、最後に全部を混ぜた音。"""
    folder = Path(timeline_path).parent
    for name in ("drums.wav", "stems/drums.wav", "karaoke.wav", "show_mix.wav"):
        if (folder / name).exists():
            return folder / name
    raise FileNotFoundError(f"打点を取る音がありません: {folder}")


def load_hits(timeline_path, hits_file=None):
    """打点の一覧と出どころを返す。hits_file があれば [{t, band, strength}] をそのまま使う。"""
    if hits_file:
        return json.loads(Path(hits_file).read_text(encoding="utf-8")), str(hits_file)
    source = find_source(timeline_path)
    return analyze(source), str(source)
