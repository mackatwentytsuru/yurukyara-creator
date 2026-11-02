"""曲から拍・小節頭・BPM を出す(テンポが一定の曲を想定)。
1. librosa のテンポ推定で BPM の見当をつける(全帯域の立ち上がりから)。
2. 見当の ±3% と 0〜1 拍の位相を総当たりし、低域(キック・ベース。250 Hz まで)の立ち上がりの
   平均がいちばん大きい等間隔の格子を拍とする。全帯域だと裏拍のコードやハットに釣られる。
3. 小節頭は、4 拍ごとの 4 通りの位相のうち、ベースのクロマ(音の高さの構成)が前の拍からいちばん大きく変わる位相。
"""
import numpy as np
import warnings
import librosa
from scipy.signal import butter, sosfilt

warnings.filterwarnings("ignore", message="Empty filters detected")
HOP = 256
BPM_SPAN = 0.03


def _grid_score(env_max, sr, dur, period, t0):
    ts = np.arange(t0, dur, period)
    return env_max[np.clip(np.rint(ts * sr / HOP).astype(int), 0, len(env_max) - 1)].mean()


def analyze(x, sr, offset_sec=0.0):
    """x: モノの曲(区間)。拍の秒は offset_sec を足して返す。"""
    x = x.astype(np.float32)
    dur = len(x) / sr
    env = librosa.onset.onset_strength(y=x, sr=sr, hop_length=HOP)
    guess = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=env, sr=sr, hop_length=HOP))[0])
    low = librosa.onset.onset_strength(y=x, sr=sr, hop_length=HOP, fmax=250.0, n_mels=24)
    env_max = np.maximum(low, np.maximum(np.r_[low[1:], 0.0], np.r_[0.0, low[:-1]]))
    best = (-1.0, 60.0 / guess, 0.0)
    for bpm in np.arange(guess * (1 - BPM_SPAN), guess * (1 + BPM_SPAN) + 1e-9, 0.1):
        period = 60.0 / bpm
        for t0 in np.arange(0.0, period, 0.005):
            sc = _grid_score(env_max, sr, dur, period, t0)
            if sc > best[0]:
                best = (sc, period, t0)
    _, period, t0 = best
    grid = np.arange(t0, dur, period)
    info = {"tempo_guess": round(guess, 2), "grid_score": round(float(best[0]), 3)}
    phase = 0
    if len(grid) >= 8:
        # ベースの音(200 Hz まで)のクロマ。小節の頭でベースの根音が変わる曲が多い。
        # 声やコードを混ぜると、小節の途中の音の動きに釣られた(仮の曲で測った)
        bass = sosfilt(butter(4, 200, "low", fs=sr, output="sos"), x).astype(np.float32)
        chroma = librosa.feature.chroma_stft(y=bass, sr=sr, hop_length=HOP, n_fft=8192)
        st = np.clip(np.rint(grid * sr / HOP).astype(int), 0, chroma.shape[1] - 1)
        ln = max(int(0.9 * period * sr / HOP), 1)
        cs = np.array([chroma[:, j:j + ln].mean(axis=1) for j in st])
        cs = cs / (np.linalg.norm(cs, axis=1, keepdims=True) + 1e-9)
        nov = np.r_[0.0, 1.0 - (cs[1:] * cs[:-1]).sum(axis=1)]
        phase = int(np.argmax([nov[p::4].mean() for p in range(4)]))
    down = grid[phase::4]
    return {"beats": [round(float(b + offset_sec), 4) for b in grid],
            "downbeats": [round(float(b + offset_sec), 4) for b in down],
            "bpm": round(60.0 / period, 2), "info": dict(info, downbeat_phase=phase)}
