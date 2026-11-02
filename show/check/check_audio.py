"""ショーの音の測定。
使い方: python check_audio.py --out <make_show_audio の出力フォルダ>
          [--truth-voice <声だけの正解 wav。仮の曲では make_temp_song が書く *_voice_truth.wav>]
          [--truth-bpm 140] [--truth-song-start 0.0]
測るもの:
 1. 口の曲線と声の包絡(RMS)の相関: answer(読み上げ)と song(vocals.wav)
 2. 伴奏だけの区間での口の開き(正解の声があるとき。声が終わって 0.25 秒たったあとの区間)
 3. show_mix の長さと timeline の一致、mouth/energy の長さ・範囲、区間の外で mouth が 0 か
 4. ピーク(show_mix・vocals・karaoke)
 5. 拍・小節頭・BPM の誤差(正解の BPM があるとき)
 6. 口の閉じ始めの遅れ(合成の音で。立ち上がりと閉じる速さ)
"""
import argparse, json, pathlib, sys
import numpy as np, soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "audio"))
import show_mouth  # noqa: E402

FPS = 60


def rms_env(x, sr, n_frames):
    hop = sr // FPS
    win = 2 * hop
    pad = np.pad(x, (win // 2, win // 2 + n_frames * hop))
    idx = np.arange(n_frames)[:, None] * hop + np.arange(win)[None, :]
    return np.sqrt((pad[idx] ** 2).mean(axis=1))


def db(v):
    return float(20 * np.log10(max(v, 1e-9)))


def corr(a, b):
    return float(np.corrcoef(a, b)[0, 1]) if len(a) > 2 and a.std() > 0 and b.std() > 0 else float("nan")


def selftest_close_delay():
    """100 Hz の基本音 + 倍音の母音のような音を 0.5 秒鳴らして止める。止めてから口が最大の 95% を割るまでと、
    10% を割るまでの時間(ms)、立ち上がりで 90% に達するまでの時間(ms)。"""
    sr = 48000
    t = np.arange(int(1.5 * sr)) / sr
    x = sum(np.sin(2 * np.pi * 200 * k * t) / k for k in range(1, 12))
    x = x * ((t >= 0.5) & (t < 1.0)) * 0.3
    n = len(x) // (sr // FPS)
    m, _ = show_mouth.mouth_curve(x, sr, n)
    pk = m.max()
    on = int(0.5 * FPS)
    off = int(1.0 * FPS)
    up90 = next(i for i in range(on, off) if m[i] >= 0.9 * pk) - on
    d95 = next(i for i in range(off, n) if m[i] < 0.95 * pk) - off
    d10 = next(i for i in range(off, n) if m[i] < 0.10 * pk) - off
    ms = 1000 / FPS
    return {"attack_to_90pct_ms": round(up90 * ms, 1), "close_start_delay_ms": round(d95 * ms, 1),
            "close_to_10pct_ms": round(d10 * ms, 1), "peak": round(float(pk), 3)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--truth-voice")
    ap.add_argument("--truth-bpm", type=float)
    ap.add_argument("--truth-song-start", type=float, default=0.0)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    tl = json.loads((out / "timeline.json").read_text(encoding="utf-8"))
    mix, sr = sf.read(str(out / "show_mix.wav"), always_2d=True)
    voc = sf.read(str(out / "vocals.wav"), always_2d=True)[0]
    kar = sf.read(str(out / "karaoke.wav"), always_2d=True)[0]
    n = tl["frames"]
    mouth, energy = np.array(tl["mouth"]), np.array(tl["energy"])
    sec = {s["id"]: s for s in tl["sections"]}
    res = {}

    # 3. 長さ・範囲
    res["length"] = {
        "show_mix_sec": round(len(mix) / sr, 4), "timeline_duration_sec": round(tl["duration_sec"], 4),
        "frames": n, "round(duration*60)": int(round(tl["duration_sec"] * FPS)),
        "mouth_len": len(mouth), "energy_len": len(energy),
        "vocals_len_eq": len(voc) == len(mix), "karaoke_len_eq": len(kar) == len(mix),
        "sample_rate": sr, "channels": mix.shape[1], "subtype": sf.info(str(out / "show_mix.wav")).subtype,
        "ok": bool(abs(len(mix) / sr - tl["duration_sec"]) < 1e-6 and n == round(tl["duration_sec"] * FPS)
                   and len(mouth) == n == len(energy) and len(voc) == len(mix) == len(kar)),
        "ranges_ok": bool(mouth.min() >= 0 and mouth.max() <= 1 and energy.min() >= 0 and energy.max() <= 1),
    }
    allowed = np.zeros(n, bool)
    for sid in ("line", "song", "answer"):
        if sid in sec:
            allowed[int(round(sec[sid]["start"] * FPS)):int(round(sec[sid]["end"] * FPS))] = True
    res["mouth_outside_sections_max"] = round(float(mouth[~allowed].max()), 4) if (~allowed).any() else 0.0

    # 1. 相関
    corrs = {}
    if "answer" in sec:
        s0, s1 = (int(round(sec["answer"][k] * FPS)) for k in ("start", "end"))
        env = rms_env(mix[:, 0], sr, n)
        corrs["answer(show_mix の読み上げ)"] = round(corr(mouth[s0:s1], env[s0:s1]), 3)
    if "song" in sec:
        s0, s1 = (int(round(sec["song"][k] * FPS)) for k in ("start", "end"))
        env = rms_env(voc.mean(axis=1), sr, n)
        lo = s0
        if "line" in sec:  # せりふを乗せた区間は口がせりふに任されるので、そのあとだけ
            lo = int(round(sec["line"]["end"] * FPS))
        corrs["song(vocals.wav。せりふのあと)"] = round(corr(mouth[lo:s1], env[lo:s1]), 3)
    res["corr_mouth_vs_voice_envelope"] = corrs

    # 2. 伴奏だけの区間
    if a.truth_voice and "song" in sec:
        tv = sf.read(a.truth_voice, always_2d=True)[0].mean(axis=1)
        tsr = sf.info(a.truth_voice).samplerate
        s0 = int(round(sec["song"]["start"] * FPS))
        s1 = int(round(sec["song"]["end"] * FPS))
        off = int(round(a.truth_song_start * tsr))
        tv = tv[off:]
        env = rms_env(np.pad(tv, (0, max(0, (s1 - s0) * (tsr // FPS) - len(tv)))), tsr, s1 - s0)
        voiced = env > env.max() * 10 ** (-50 / 20)
        near = np.convolve(voiced.astype(float), np.ones(2 * int(0.25 * FPS) + 1), "same") > 0  # 声の前後 0.25 秒
        if "line" in sec:
            l0 = int(round(sec["line"]["start"] * FPS)) - s0
            l1 = int(round(sec["line"]["end"] * FPS)) - s0
            near[l0:l1] = True  # せりふの区間は除く
        inst = ~near
        m = mouth[s0:s1][inst]
        res["instrumental_only"] = {"frames": int(inst.sum()), "sec": round(inst.sum() / FPS, 2),
                                    "mouth_max": round(float(m.max()), 4) if len(m) else None,
                                    "mouth_mean": round(float(m.mean()), 4) if len(m) else None}
    else:
        res["instrumental_only"] = "正解の声(--truth-voice)が無いので測っていない"

    # 4. ピーク
    res["peak_dbfs"] = {"show_mix": round(db(np.abs(mix).max()), 2), "vocals": round(db(np.abs(voc).max()), 2),
                        "karaoke": round(db(np.abs(kar).max()), 2)}

    # 5. 拍
    beats = np.array(tl["beats"])
    b = {"bpm": tl["bpm"], "beats": len(beats), "downbeats": len(tl["downbeats"])}
    if a.truth_bpm and "song" in sec and len(beats):
        t0 = sec["song"]["start"] - a.truth_song_start
        period = 60 / a.truth_bpm
        k = np.rint((beats - t0) / period)
        err = (beats - (t0 + k * period)) * 1000
        b.update({"bpm_error": round(tl["bpm"] - a.truth_bpm, 3),
                  "beat_err_ms_median_abs": round(float(np.median(np.abs(err))), 1),
                  "beat_err_ms_max_abs": round(float(np.abs(err).max()), 1),
                  "beat_err_ms_signed_mean": round(float(err.mean()), 1)})
        down = np.array(tl["downbeats"])
        if len(down):
            kb = np.rint((down - t0) / period)
            b["downbeats_on_bar_start_(truth=every 4 beats from song start)"] = bool(np.all(kb % 4 == 0))
    res["beats"] = b

    # 6. 口の遅れ
    res["mouth_dynamics_synthetic"] = selftest_close_delay()
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
