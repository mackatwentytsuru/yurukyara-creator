"""歌の試し: 伴奏(仮)の合成、a2(音程補正)、c(伴奏と掛け声)を作る。
使い方: python song_make.py <出力フォルダ> <a1の元mp3> <a2の名前の接尾辞>
  出力フォルダに raw/c1.mp3 c2.mp3 c3.mp3 がある前提。API は呼ばない。
BPM 140、5 小節(20 拍 = 約 8.6 秒)。
"""
import sys, os, subprocess, json
import numpy as np, soundfile as sf, pyworld as pw
sys.path.insert(0, os.path.dirname(__file__))
from song_probe import load, phrases, FS

BPM = 140
BEAT = int(FS * 60 / BPM)  # 18900 サンプル
NBEATS = 20
TOTAL = BEAT * NBEATS
FP = 5.0  # ms
MELODY = [[64, 67, 69, 67], [67, 69, 72, 69, 67], [69, 67], [67, 69, 71, 72], [72, 69, 67, 64]]
CHORDS = [(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60), (60, 64, 67)]
ROOTS = [36, 31, 33, 29, 36]


def hz(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def env(n, decay):
    return np.exp(-np.arange(n) / (FS * decay))


def saw(f, n, harm=8):
    t = np.arange(n) / FS
    return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, harm + 1) if f * k < FS / 2) * 0.5


def add(buf, pos, snd):
    end = min(len(buf), pos + len(snd))
    if pos < end:
        buf[pos:end] += snd[: end - pos]


def backing():
    rng = np.random.default_rng(1)
    b = np.zeros(TOTAL)
    n = int(BEAT * 0.9)
    tk = np.arange(n) / FS
    kick = np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-tk * 30)) / FS) * env(n, 0.12)
    for i in range(NBEATS):
        add(b, i * BEAT, kick * 0.9)
        add(b, i * BEAT + BEAT // 2, np.diff(rng.standard_normal(2000), prepend=0) * env(2000, 0.02) * 0.12)  # ハット
        if i % 2 == 1:
            nz = np.diff(rng.standard_normal(6000), prepend=0)
            add(b, i * BEAT, nz * env(6000, 0.06) * 0.35)  # クラップ
    for bar in range(5):
        for e in range(8):  # 8 分でベース
            p = bar * 4 * BEAT + e * BEAT // 2
            m = ROOTS[bar] + (12 if e % 4 == 3 else 0)
            add(b, p, np.sin(2 * np.pi * hz(m) * np.arange(BEAT // 2) / FS) * env(BEAT // 2, 0.18) * 0.45)
        for e in range(8):  # 明るいコード(裏拍多め)
            if e % 2 == 0 and e != 0:
                continue
            p = bar * 4 * BEAT + e * BEAT // 2
            ln = BEAT
            s = sum(saw(hz(m), ln) + saw(hz(m) * 1.004, ln) for m in CHORDS[bar]) * 0.06
            add(b, p, s * env(ln, 0.25))
    return b


def peak_norm(x, db=-1.0):
    return x * (10 ** (db / 20) / np.max(np.abs(x)))


def to_mp3(x, path):
    wav = path + ".tmp.wav"
    sf.write(wav, peak_norm(x), FS, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav, "-map_metadata", "-1", "-b:a", "192k", path], check=True)
    os.remove(wav)


def pitch_correct(src):
    x = load(src)
    f0, t = pw.harvest(x, FS, f0_floor=80, f0_ceil=800, frame_period=FP)
    f0 = pw.stonemask(x, f0, t, FS)
    sp = pw.cheaptrick(x, f0, t, FS)
    ap = pw.d4c(x, f0, t, FS)
    ph = phrases(f0)
    assert len(ph) == len(MELODY), f"phrases={len(ph)}"
    nf = int(TOTAL / FS * 1000 / FP)
    F0 = np.zeros(nf); SP = np.full((nf, sp.shape[1]), 1e-16); AP = np.ones((nf, ap.shape[1]))
    fpb = BEAT / FS * 1000 / FP  # 1 拍あたりのフレーム
    info = []
    for k, (s, e) in enumerate(ph):
        s, e = max(0, s - 6), min(len(f0) - 1, e + 6)
        n_out = int(3.4 * fpb)
        idx = np.linspace(s, e, n_out)
        i0 = np.floor(idx).astype(int); fr = (idx - i0)[:, None]; i1 = np.minimum(i0 + 1, len(f0) - 1)
        spk = sp[i0] * (1 - fr) + sp[i1] * fr
        apk = ap[i0] * (1 - fr) + ap[i1] * fr
        voiced = f0[np.rint(idx).astype(int)] > 0
        vi = np.where(voiced)[0]
        tgt = np.zeros(n_out)
        notes = MELODY[k]
        edges = np.linspace(vi[0], vi[-1] + 1, len(notes) + 1)
        for j, m in enumerate(notes):
            tgt[int(edges[j]):int(edges[j + 1])] = m
        tgt[~voiced] = 0
        mid = tgt.copy()
        # 音の切り替えを 30 ms ほどなめらかに
        cur = np.where(tgt > 0, tgt, np.nan)
        for q in range(len(cur)):
            if np.isnan(cur[q]):
                cur[q] = cur[q - 1] if q else 60
        ker = np.ones(6) / 6
        sm = np.convolve(np.pad(cur, (3, 2), mode="edge"), ker, mode="valid")
        fk = np.where(voiced, hz(sm), 0.0)
        p = int(k * 4 * fpb)
        F0[p:p + n_out] = fk; SP[p:p + n_out] = spk; AP[p:p + n_out] = apk
        src_dur = (e - s) * FP / 1000
        info.append({"phrase": k + 1, "src_sec": round(src_dur, 2), "out_sec": round(n_out * FP / 1000, 2),
                     "notes": notes, "out_f0_hz": [int(fk[fk > 0].min()), int(fk[fk > 0].max())]})
    y = pw.synthesize(F0, np.ascontiguousarray(SP), np.ascontiguousarray(AP), FS, FP)
    y = np.pad(y, (0, max(0, TOTAL - len(y))))[:TOTAL]
    return y, info, len(x) / FS


def call_mix(bk):
    v = np.zeros(TOTAL)
    for fn, beat in (("c1", 1), ("c2", 8), ("c3", 12)):
        w = load(os.path.join(OUT, "raw", fn + ".mp3"))
        add(v, int(beat * BEAT), w / np.max(np.abs(w)) * 0.9)
    return v


if __name__ == "__main__":
    OUT, src, tag = sys.argv[1], sys.argv[2], sys.argv[3]
    bk = backing()
    to_mp3(bk, os.path.join(OUT, "backing_仮.mp3"))
    y, info, src_len = pitch_correct(os.path.join(OUT, src))
    y = y / np.max(np.abs(y))
    to_mp3(y, os.path.join(OUT, f"a2_音程補正_伴奏なし{tag}.mp3"))
    to_mp3(y * 0.8 + bk / np.max(np.abs(bk)) * 0.4, os.path.join(OUT, f"a2_音程補正_伴奏あり{tag}.mp3"))
    if not tag:
        v = call_mix(bk)
        to_mp3(v * 0.8 + bk / np.max(np.abs(bk)) * 0.4, os.path.join(OUT, "c_伴奏と掛け声.mp3"))
    print(json.dumps({"src_len": round(src_len, 2), "out_len": round(TOTAL / FS, 2), "phrases": info}, ensure_ascii=False))
