"""声の音量と有声の度合いから、コマごと(60fps)の口の開き 0〜1 を作る。
- 声の帯域(150〜4000 Hz)のパワーを dB にし、しきい値より上を開きにする。
  しきい値は、分離に残った伴奏のもれに合わせて自動で決める(下の auto_threshold)。
- 有声の度合い = 声の帯域 / 全帯域のパワー比。もれたハイハット等(高域)や低域のキックを弱める。
- 立ち上がりは速く(時定数 ATTACK_TAU)、閉じるのは遅く(HOLD_FRAMES 保ってから RELEASE_TAU で下がる)。
"""
import numpy as np

FPS = 60
BAND = (150.0, 4000.0)
ATTACK_TAU = 0.020   # 秒
HOLD_FRAMES = 5      # 5 コマ = 83 ms 以内(測定: close_start_delay) 閉じ始めを遅らせる
RELEASE_TAU = 0.100  # 秒。子音の短い無音(〜100 ms)で閉じ切らない
LEAK_MARGIN_DB = 6.0
EPS = 1e-12


def band_features(x, sr, n_frames, fps=FPS):
    """コマごとの (声の帯域の dB, 有声の度合い 0〜1)。コマの中心を窓の中心にする(窓 2 コマ分)。"""
    hop = sr // fps
    win = 2 * hop
    pad = np.pad(x.astype(np.float64), (win // 2, win // 2 + n_frames * hop))
    idx = np.arange(n_frames)[:, None] * hop + np.arange(win)[None, :]
    seg = pad[idx] * np.hanning(win)[None, :]
    p = np.abs(np.fft.rfft(seg, axis=1)) ** 2
    f = np.fft.rfftfreq(win, 1 / sr)
    band = p[:, (f >= BAND[0]) & (f <= BAND[1])].sum(axis=1)
    total = p[:, f >= 50.0].sum(axis=1) + EPS
    db = 10 * np.log10(band + EPS) - 10 * np.log10(win)  # 窓の長さでそろえる(大きさの目安)
    voiced = np.clip((band / total - 0.45) / 0.4, 0.0, 1.0)
    return db, voiced


def auto_threshold(db, active_floor_db=-90.0):
    """もれの山と声の山を分ける dB を返す。(しきい値, 情報)
    - 音のある(active_floor_db より上の)コマの dB を 2 つに分ける大津の方法。
    - 声の最大(95 パーセンタイル)から 40 dB 下〜20 dB 下の間に収める。
    - もれが無ければ(静かなコマが無音そのもの)、下限(最大 -40 dB)に近くなる。"""
    peak = float(np.percentile(db, 98))
    vals = db[db > max(active_floor_db, peak - 70.0)]
    lo, hi = peak - 40.0, peak - 20.0
    if len(vals) < 10:
        return lo, {"peak_db": peak, "otsu_db": None, "leak_db": None}
    hist, edges = np.histogram(vals, bins=64)
    mids = (edges[:-1] + edges[1:]) / 2
    w = hist.astype(float)
    best, thr = -1.0, mids[0]
    for k in range(1, len(mids)):
        w0, w1 = w[:k].sum(), w[k:].sum()
        if w0 == 0 or w1 == 0:
            continue
        m0, m1 = (w[:k] * mids[:k]).sum() / w0, (w[k:] * mids[k:]).sum() / w1
        v = w0 * w1 * (m0 - m1) ** 2
        if v > best:
            best, thr = v, edges[k]
    leak = float(np.median(vals[vals < thr])) if (vals < thr).any() else None
    t = float(np.clip(thr + LEAK_MARGIN_DB * 0.5, lo, hi))
    return t, {"peak_db": peak, "otsu_db": float(thr), "leak_db": leak}


def smooth_mouth(target, fps=FPS):
    """立ち上がり速く、閉じる前に少し保ち、ゆっくり下げる。"""
    a = 1 - np.exp(-1 / fps / ATTACK_TAU)
    d = np.exp(-1 / fps / RELEASE_TAU)
    out = np.zeros(len(target))
    m, hold = 0.0, 0
    for i, t in enumerate(target):
        if t > m:
            m += a * (t - m)
            hold = HOLD_FRAMES
        elif hold > 0:
            hold -= 1
        else:
            m = t + (m - t) * d
        out[i] = m
    return out


def mouth_curve(x, sr, n_frames, fps=FPS):
    """1 区間の声(モノ)から口の曲線。(長さ n_frames の配列, 情報)"""
    db, voiced = band_features(x, sr, n_frames, fps)
    thr, info = auto_threshold(db)
    peak = info["peak_db"]
    level = np.clip((db - thr) / max(peak - thr, 6.0), 0.0, 1.0) ** 0.8
    target = level * (0.35 + 0.65 * voiced)
    # 有声の度合いが低い子音でも、しきい値を超えていれば少しは開く(0.35 が下限)
    target = target * (db > thr)
    cal = float(np.percentile(target[target > 0], 95)) if (target > 0).any() else 1.0
    target = np.clip(target / max(cal, 1e-3), 0.0, 1.0)
    info = dict(info, threshold_db=thr)
    return smooth_mouth(target, fps), info


def energy_curve(x, sr, n_frames, fps=FPS):
    """全編の音の強さ 0〜1(背景用)。窓 2 コマの RMS を、最大 -40 dB を 0 として線形に。"""
    hop = sr // fps
    win = 2 * hop
    pad = np.pad(x.astype(np.float64), (win // 2, win // 2 + n_frames * hop))
    idx = np.arange(n_frames)[:, None] * hop + np.arange(win)[None, :]
    rms = np.sqrt((pad[idx] ** 2).mean(axis=1) + EPS)
    db = 20 * np.log10(rms)
    peak = float(np.percentile(db, 99))
    e = np.clip((db - (peak - 40.0)) / 40.0, 0.0, 1.0)
    return np.clip(e, 0.0, 1.0)
