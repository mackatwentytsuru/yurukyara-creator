"""せりふ(読み上げ)の声を歌声に近づける試し。お金はかからない(キャッシュ済みの読み上げ wav を加工するだけ)。
使い方: python voice_match_trial.py --line <せりふ wav> --sung <歌声だけの wav> --out <フォルダ>
  案 1: 高さ +3 半音(pyworld で f0 だけ上げる)+ 高域 +3 dB(2〜4 kHz で立ち上げる)。リバーブなし。
  案 2: 高さ +1.5 半音 + 高域 +1.5 dB + 歌声と同じリバーブ(RT60 0.8 秒、ウェット 20%)。歌声側にも同じリバーブを掛けた版を出す。
聞き比べ用の mp3(せりふ → 1 秒の間 → 歌声)と、測った数字(f0 の中央値・スペクトル重心)を out に書く。
"""
import argparse, json, os, subprocess
import numpy as np, soundfile as sf, pyworld as pw

SR = 48000
FP = 5.0


def to_mono(path):
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        from scipy.signal import resample_poly
        x = resample_poly(x, SR, sr)
    return x


def shift_bright(x, semitones, bright_db):
    f0, t = pw.harvest(x, SR, f0_floor=80, f0_ceil=800, frame_period=FP)
    f0 = pw.stonemask(x, f0, t, SR)
    sp = pw.cheaptrick(x, f0, t, SR)
    ap = pw.d4c(x, f0, t, SR)
    freqs = np.linspace(0, SR / 2, sp.shape[1])
    ramp = np.clip((freqs - 2000.0) / 2000.0, 0.0, 1.0)  # 2 kHz から 4 kHz へ立ち上げる
    sp = sp * (10 ** (bright_db * ramp / 10))[None, :]
    y = pw.synthesize(f0 * 2 ** (semitones / 12), np.ascontiguousarray(sp), ap, SR, FP)
    return y[: len(x)]


def reverb(x, rt60=0.8, wet=0.2, predelay=0.02, seed=7):
    rng = np.random.default_rng(seed)
    n = int(rt60 * 1.2 * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * 10 ** (-3 * t / rt60)
    ir = np.r_[np.zeros(int(predelay * SR)), ir]
    ir /= np.sqrt((ir ** 2).sum())
    from scipy.signal import fftconvolve
    w = fftconvolve(x, ir)[: len(x)]
    w *= np.sqrt((x ** 2).mean() / ((w ** 2).mean() + 1e-12))  # 湿った音の大きさを元の声にそろえる
    return (1 - wet) * x + wet * w


def stats(x):
    f0, t = pw.harvest(x, SR, f0_floor=80, f0_ceil=800, frame_period=FP)
    v = f0[f0 > 0]
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    return {"f0_median_hz": round(float(np.median(v)), 1), "voiced_sec": round(len(v) * FP / 1000, 2),
            "spectral_centroid_hz": round(float((spec * fr).sum() / spec.sum()), 0)}


def mp3(x, path):
    x = x * (10 ** (-3 / 20) / np.max(np.abs(x)))
    tmp = path + ".tmp.wav"
    sf.write(tmp, x, SR, subtype="PCM_24")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-map_metadata", "-1", "-b:a", "192k", path], check=True)
    os.remove(tmp)


def seq(*parts):
    gap = np.zeros(SR)
    out = []
    for p in parts:
        out += [p / np.sqrt((p ** 2).mean()) * 0.1, gap]  # RMS をそろえて並べる
    return np.concatenate(out[:-1])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--line", required=True)
    ap.add_argument("--sung", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    line, sung = to_mono(a.line), to_mono(a.sung)
    sung = sung[: int(np.nonzero(np.abs(sung) > 1e-3)[0][-1]) + 1]
    first = int(np.nonzero(np.abs(sung) > 1e-3)[0][0])
    sung = sung[first:]
    p1 = shift_bright(line, 3.0, 3.0)
    p2 = reverb(shift_bright(line, 1.5, 1.5))
    sung_rv = reverb(sung)
    sets = {"0_元のせりふ": line, "1_せりふ案1_高さと明るさ": p1, "2_せりふ案2_弱め+リバーブ": p2,
            "3_仮の歌声": sung, "4_仮の歌声_案2と同じリバーブ": sung_rv,
            "A_元のせりふ→歌声": seq(line, sung), "B_案1→歌声": seq(p1, sung), "C_案2→リバーブ付き歌声": seq(p2, sung_rv)}
    for k, v in sets.items():
        mp3(v, os.path.join(a.out, k + ".mp3"))
    st = {k: stats(v) for k, v in list(sets.items())[:5]}
    json.dump(st, open(os.path.join(a.out, "測定.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(st, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
