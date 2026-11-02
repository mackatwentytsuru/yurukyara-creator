"""曲の候補の構成を測る(耳の代わりに、測れる事実だけを出す)。
段階:
  separate  曲を 44.1kHz ステレオにして demucs(htdemucs)で分け、<out>/<名前>/ に
            src44.wav・vocals.wav・no_vocals.wav を置く(GPU。札で包む)。
  measure   分けた結果から、歌声の最初の秒・拍・音量の列・サビ候補(歌声の自己相似)を
            <out>/<名前>/measure.json に出す(CPU)。
使い方:
  python measure_song.py separate --out <フォルダ> 名前=曲.wav [名前=曲.wav ...]
  python measure_song.py measure  --out <フォルダ> 名前 [名前 ...]
"""
import argparse, json, pathlib, subprocess, sys
import numpy as np, soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SEP_SR = 44100
STEP = 0.5            # 音量の列の間隔(秒)
VOICE_DB = -10.0      # 歌声が「入った」とみなす、歌声の 95 パーセンタイルに対する差(dB)
VOICE_HOLD = 0.4      # この秒数つづいて超えたら入ったとみなす
FEAT_HOP = 0.25       # 自己相似の特徴の間隔(秒)
SIM_THR = 0.65       # 繰り返しとみなす類似の下限
WIN = 6.0             # 繰り返しを探す窓の長さ(秒)


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-9))


def separate(args):
    import show_beats  # noqa: F401  (環境の確認のみ)
    from make_show_audio import separate as sep
    import torch
    out = pathlib.Path(args.out)
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    for item in args.items:
        name, src = item.split("=", 1)
        d = out / name
        d.mkdir(parents=True, exist_ok=True)
        s44 = d / "src44.wav"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-ac", "2", "-ar", str(SEP_SR),
                        "-c:a", "pcm_f32le", str(s44)], check=True)
        v, nv = sep(s44, device)
        sf.write(str(d / "vocals.wav"), v, SEP_SR, subtype="PCM_24")
        sf.write(str(d / "no_vocals.wav"), nv, SEP_SR, subtype="PCM_24")
        print("separated", name, device, flush=True)


def level_series(x, sr, step):
    n = int(sr * step)
    k = len(x) // n
    return np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(axis=1))


def first_voice(v, sr):
    """歌声の RMS(50 ms)が、歌声の 95 パーセンタイルより VOICE_DB 以内になって VOICE_HOLD 秒つづく最初の秒。
    それより小さい声(息・ハミング・分離の漏れ)は quiet_before に、最大の音量を添えて別に出す。"""
    hop = int(sr * 0.05)
    k = len(v) // hop
    r = np.sqrt((v[:k * hop].reshape(k, hop) ** 2).mean(axis=1))
    ref = np.percentile(r, 95)
    thr = ref * 10 ** (VOICE_DB / 20)
    need = int(VOICE_HOLD / 0.05)
    ok = r > thr
    first = None
    for i in range(len(ok) - need):
        if ok[i:i + need].all():
            first = i * 0.05
            break
    quiet = None
    if first:
        pre = r[:int(first / 0.05)]
        weak = np.flatnonzero(pre > ref * 10 ** (-45.0 / 20))
        if len(weak):
            quiet = {"from": round(weak[0] * 0.05, 2), "to": round(weak[-1] * 0.05, 2),
                     "peak_db_rel": round(float(db(pre.max() / ref)), 1)}
    return first, float(db(thr)), quiet


def vocal_gaps(v, sr, after, min_len=1.2, rel_db=-30.0):
    """歌声の無い区間(95 パーセンタイル比 rel_db 未満が min_len 秒以上)。[(始め, 終わり), ...]"""
    hop = int(sr * 0.1)
    k = len(v) // hop
    r = np.sqrt((v[:k * hop].reshape(k, hop) ** 2).mean(axis=1))
    low = r < np.percentile(r, 95) * 10 ** (rel_db / 20)
    out, i = [], int(after / 0.1)
    while i < len(low):
        if low[i]:
            j = i
            while j < len(low) and low[j]:
                j += 1
            if (j - i) * 0.1 >= min_len:
                out.append((round(i * 0.1, 1), round(j * 0.1, 1)))
            i = j
        else:
            i += 1
    return out


def vocal_features(v, sr):
    import librosa
    hop = int(sr * FEAT_HOP)
    m = librosa.feature.melspectrogram(y=v, sr=sr, n_fft=2048, hop_length=hop, n_mels=64)
    c = librosa.feature.chroma_stft(y=v, sr=sr, n_fft=4096, hop_length=hop)
    f = np.vstack([librosa.power_to_db(m), c * 20])
    f = f - f.mean(axis=1, keepdims=True)
    f = f / (np.linalg.norm(f, axis=0, keepdims=True) + 1e-9)
    return f  # (特徴, 時間)


def repeats(v, sr, first_v, dur):
    """歌声の特徴(メルと音の高さの構成)を、ずらした自分と比べて(ラグごとの対角線)、
    声のある所で類似が高いまま続く区間を長い順に返す。同じ歌詞・同じ旋律の繰り返し(サビ)が出る。
    a=先に出る側の始まり、b=繰り返しの始まり、len=つづく秒、sim=平均のコサイン類似。"""
    f = vocal_features(v, sr)
    T = f.shape[1]
    hop = int(sr * FEAT_HOP)
    vp = np.pad(v, (0, max(T * hop - len(v), 0)))
    en = np.sqrt((vp[:T * hop].reshape(T, hop) ** 2).mean(axis=1))
    voiced = en > np.percentile(en, 95) * 10 ** (-20.0 / 20)
    k = int(3.0 / FEAT_HOP)
    runs = []
    for L in range(int(WIN / FEAT_HOP), T - int(WIN / FEAT_HOP)):
        s_t = (f[:, :T - L] * f[:, L:]).sum(axis=0)
        s_t = np.convolve(s_t, np.ones(k) / k, "same")
        good = (s_t > SIM_THR) & voiced[:T - L] & voiced[L:]
        i = 0
        while i < len(good):
            if good[i]:
                j = i
                while j < len(good) and good[j]:
                    j += 1
                runs.append((j - i, float(s_t[i:j].mean()), i, L))
                i = j
            else:
                i += 1
    runs.sort(reverse=True)
    out = []
    for n, sim, i, L in runs:
        a_, b_ = i * FEAT_HOP, (i + L) * FEAT_HOP
        if all(abs(a_ - o["a"]) > 3 or abs(b_ - o["b"]) > 3 for o in out):
            out.append({"a": round(a_, 2), "b": round(b_, 2), "len": round(n * FEAT_HOP, 2), "sim": round(sim, 3)})
        if len(out) >= 5:
            break
    return out


def beat_quality(mono, sr, res):
    """格子の拍と、librosa の拍追跡の拍のずれ(ミリ秒)の標準偏差と中央値。小さいほど安定。"""
    import librosa
    _, tr = librosa.beat.beat_track(y=mono, sr=sr, units="time", bpm=res["bpm"])
    grid = np.array(res["beats"])
    if len(tr) < 4 or len(grid) < 4:
        return None
    d = np.array([(t - grid[np.argmin(np.abs(grid - t))]) for t in tr]) * 1000
    # 拍の半分以上ずれる物は位相違い(裏拍)。外れ値として数える
    period = 60000 / res["bpm"]
    off = float((np.abs(d) > period / 4).mean())
    d_in = d[np.abs(d) <= period / 4]
    return {"track_vs_grid_std_ms": round(float(d_in.std()), 1) if len(d_in) else None,
            "track_vs_grid_median_ms": round(float(np.median(d_in)), 1) if len(d_in) else None,
            "outlier_ratio": round(off, 3)}


def measure(args):
    import show_beats
    out = pathlib.Path(args.out)
    for name in args.items:
        d = out / name
        mix, sr = sf.read(str(d / "src44.wav"), dtype="float32")
        voc = sf.read(str(d / "vocals.wav"), dtype="float32")[0]
        mm, vm = mix.mean(axis=1), voc.mean(axis=1)
        dur = len(mm) / sr
        fv, thr_db, quiet = first_voice(vm, sr)
        res = show_beats.analyze(mm, sr)
        res["quality"] = beat_quality(mm, sr, res)
        lv, vv = level_series(mm, sr, STEP), level_series(vm, sr, STEP)
        rep = repeats(vm, sr, fv, dur)
        r = {"duration": round(dur, 2), "first_voice_sec": fv, "quiet_before": quiet, "voice_threshold_db": round(thr_db, 1),
             "bpm": res["bpm"], "grid_score": res["info"]["grid_score"], "downbeat_phase": res["info"]["downbeat_phase"],
             "beat_quality": res["quality"], "beats": res["beats"], "downbeats": res["downbeats"],
             "mix_db": [round(float(x), 1) for x in db(lv)], "vocal_db": [round(float(x), 1) for x in db(vv)],
             "step": STEP, "repeats": rep, "vocal_gaps": vocal_gaps(vm, sr, fv or 0)}
        (d / "measure.json").write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
        print(name, "dur", r["duration"], "voice", fv, "bpm", r["bpm"], r["beat_quality"], "rep", rep[:1], flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["separate", "measure"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default=None)
    ap.add_argument("items", nargs="+")
    a = ap.parse_args()
    {"separate": separate, "measure": measure}[a.stage](a)


if __name__ == "__main__":
    main()
