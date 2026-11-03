"""せりふを歌と同じ空間に置く: 音量を歌声にそろえ、高域を落とし、リバーブを足す。伴奏との比も歌の部分にそろえる。
読み上げの声は乾いて明るいので、そのままだと歌声の間で浮く。
"""
import numpy as np
from scipy.signal import fftconvolve, lfilter

BLOCK_SEC, HOP_SEC = 0.4, 0.1
ABS_GATE, REL_GATE = -70.0, -10.0
# BS.1770 の K 特性(48 kHz)
K_SHELF = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
K_HIGHPASS = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
DEFAULTS = {"rt60": 1.1, "wet": 0.28, "predelay": 0.025, "shelf_hz": 3500.0, "shelf_db": -1.0, "level_offset_db": 0.0}
TAIL_SEC = 1.6
DUCK_LIMITS = (0.0, 14.0)


def lufs(x):
    """積分のラウドネス(LUFS)。x は 48 kHz。1 本でも 2 本でもよい。"""
    x = x if x.ndim == 2 else x[:, None]
    weighted = lfilter(*K_HIGHPASS, lfilter(*K_SHELF, x, axis=0), axis=0)
    block, hop = int(BLOCK_SEC * 48000), int(HOP_SEC * 48000)
    if len(weighted) < block:
        raise ValueError("音が短すぎて測れない")
    energy = (weighted ** 2).sum(axis=1)
    cum = np.r_[0.0, np.cumsum(energy)]
    power = (cum[block:] - cum[:-block])[::hop] / block
    loud = -0.691 + 10 * np.log10(power + 1e-12)
    keep = power[loud > ABS_GATE]
    if not len(keep):
        return ABS_GATE
    threshold = -0.691 + 10 * np.log10(keep.mean()) + REL_GATE
    keep = power[(loud > ABS_GATE) & (loud > threshold)]
    return float(-0.691 + 10 * np.log10(keep.mean()))


def high_shelf(x, hz, db, sr=48000):
    """hz より上を db 変える(1 次のシェルフ)。"""
    gain = 10 ** (db / 20)
    a = np.exp(-2 * np.pi * hz / sr)
    # 低域はそのまま、高域だけ gain になる形
    b0, b1 = gain + (1 - gain) * (1 - a), -(gain * a)
    return lfilter([b0, b1], [1.0, -a], x)


def impulse(rt60, predelay, seed, sr=48000):
    rng = np.random.default_rng(seed)
    n = int(rt60 * 1.2 * sr)
    t = np.arange(n) / sr
    ir = rng.standard_normal(n) * 10 ** (-3 * t / rt60)
    ir = high_shelf(ir, 5000.0, -3.0, sr)  # 残響の高域は早く消える
    ir = np.r_[np.zeros(int(predelay * sr)), ir]
    return ir / np.sqrt((ir ** 2).sum())


def process(voice, target_lufs, config=None):
    """乾いた声(1 本)を、(n, 2) のリバーブ付きの声にする。残響の分だけ長くなる。戻りは (声, 情報)。"""
    c = {**DEFAULTS, **(config or {})}
    bright = high_shelf(voice, c["shelf_hz"], c["shelf_db"])
    tail = int(TAIL_SEC * 48000)
    dry = np.r_[bright, np.zeros(tail)]
    wet = np.stack([fftconvolve(dry, impulse(c["rt60"], c["predelay"], seed))[:len(dry)] for seed in (7, 11)], axis=1)
    wet *= np.sqrt((dry ** 2).mean() / ((wet ** 2).mean() + 1e-12))
    out = (1 - c["wet"]) * dry[:, None] + c["wet"] * wet
    before = lufs(out)
    gain_db = target_lufs + c["level_offset_db"] - before
    out = out * 10 ** (gain_db / 20)
    return out, {"lufs_dry": round(lufs(voice), 1), "lufs_out": round(lufs(out), 1), "gain_db": round(gain_db, 1), **{k: c[k] for k in DEFAULTS}}


def duck_for(line_lufs, backing_lufs, sung_vocal_lufs, sung_backing_lufs):
    """せりふと伴奏の差を、歌声と伴奏の差にそろえるために、伴奏を何 dB 下げるか。"""
    want = sung_vocal_lufs - sung_backing_lufs
    return float(np.clip(backing_lufs - (line_lufs - want), *DUCK_LIMITS))
