"""AR の完成版の音を作る。実写の音(声と会場の響き)に、元の音 show_mix.wav を足して、合成の映像に付ける。

1. 実写の音と元の音のずれを、相互相関(白色化つき)で実測する。頭と終わりの 2 か所で測り、時間の伸び(29.97p の録音など)も出す。
2. 実写の音を伸び・ずれの分だけ補正し、映像の 0 コマ目からの時間に並べる。元の音も同じ時間に切り出す。
3. 実写に対する元の音の大きさ(--music-db)で混ぜ、loudnorm の 2 パスで約 -14 LUFS・真のピーク -1 dBTP 以下にする。
4. H.264 / yuv420p / AAC 320k / faststart。映像のコマ数・コマ数毎秒は入力のまま。動画の情報(メタデータ・SEI)は消す。

秒の扱いは sync_by_led.py と同じ: 「全編の何秒に映像の 0 コマ目が当たるか」(--start、または sync_by_led の出力の json を --sync-json で)。
合成の連番を --first N から作った場合は、--first-frame N を足す(映像の 0 コマ目 = 実写の N コマ目)。

使い方:
  python mix_final.py <映像(mp4 か連番のフォルダ)> <実写の音(動画か wav)> <show_mix.wav> <出力 mp4> --start 30.5 [--music-db -6]
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates
from scipy.signal import resample_poly

SR = 48000
MSR = 16000  # 測る用
BAND = (150.0, 5000.0)
PHAT_BETA = 0.8
MIN_Z = 6.0  # 相関の山が周りの揺れの何倍あれば信じるか
DEFAULT_MUSIC_DB = -6.0  # 実写の大きさに対する元の音の大きさ(試験の偽の実写で決めた。本物の会場では未確認)
TARGET_LUFS = -14.0
TARGET_TP = -1.0


# ---------- 入出力 ----------
def decode(path, sr=SR, channels=2):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", str(channels), "-ar", str(sr),
                          "-f", "f32le", "-"], capture_output=True, check=True, stdin=subprocess.DEVNULL).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, channels).T.copy()  # (ch, n)


def write_wav_f32(path, x, sr=SR):
    """float32 の wav(ffmpeg が読める IEEE float 形式)。"""
    data = np.ascontiguousarray(x.T.astype("<f4")).tobytes()
    ch = x.shape[0]
    with open(path, "wb") as f:
        f.write(b"RIFF" + (36 + len(data)).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little"))
        f.write((3).to_bytes(2, "little") + ch.to_bytes(2, "little") + sr.to_bytes(4, "little"))
        f.write((sr * ch * 4).to_bytes(4, "little") + (ch * 4).to_bytes(2, "little") + (32).to_bytes(2, "little"))
        f.write(b"data" + len(data).to_bytes(4, "little") + data)


def probe_video(path):
    """(コマ数, fps の分数の文字, 秒)。連番のフォルダは別に扱う。"""
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
                          "stream=nb_read_frames,r_frame_rate", "-of", "json", str(path)],
                         capture_output=True, check=True, text=True).stdout
    s = json.loads(out)["streams"][0]
    num, den = (int(v) for v in s["r_frame_rate"].split("/"))
    frames = int(s["nb_read_frames"])
    return frames, s["r_frame_rate"], frames * den / num


def sequence_info(folder):
    files = sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".exr", ".tif", ".tiff"))
    if not files:
        raise SystemExit(f"連番が見つからない: {folder}")
    m = re.match(r"^(.*?)(\d+)(\.\w+)$", files[0].name)
    if not m:
        raise SystemExit(f"連番の名前を読めない: {files[0].name}")
    return files, f"{m.group(1)}%0{len(m.group(2))}d{m.group(3)}", int(m.group(2))


# ---------- ずれの実測 ----------
def to_mono16(x):
    return resample_poly(x.mean(axis=0), 1, SR // MSR).astype(np.float64)


def seg(x, i0, n):
    """x[i0:i0+n]。範囲の外は 0。"""
    out = np.zeros(n)
    a, b = max(i0, 0), min(i0 + n, x.size)
    if b > a:
        out[a - i0:b - i0] = x[a:b]
    return out


def match_window(live, music, t_center, win, music_center, search):
    """実写の t_center 秒(窓 win 秒)が、元の音の何秒に当たるかを返す(music_center ± search 秒の範囲で探す)。
    戻り値: (元の音の秒, z = 山の高さ / 周りの揺れ)。"""
    n = int(win * MSR)
    x = seg(live, int(round((t_center - win / 2) * MSR)), n)
    ref_start = int(round((music_center - win / 2 - search) * MSR))
    y = seg(music, ref_start, n + int(2 * search * MSR))
    size = 1 << int(np.ceil(np.log2(x.size + y.size)))
    hann = np.hanning(n)
    X, Y = np.fft.rfft(x * hann, size), np.fft.rfft(y, size)
    cross = Y * np.conj(X)
    freqs = np.fft.rfftfreq(size, 1 / MSR)
    cross = cross / (np.abs(cross) + 1e-12 * np.abs(cross).max()) ** PHAT_BETA * ((freqs >= BAND[0]) & (freqs <= BAND[1]))
    corr = np.fft.irfft(cross, size)[:y.size - n + 1]  # 窓が元の範囲に収まる遅れだけ
    # 曲はくり返す(試験の曲は約 4.95 秒ごと)ので、見込みに近い山を少し優先する(端で 30% 割り引く)
    center = (corr.size - 1) / 2
    k = int(np.argmax(corr * (1 - 0.3 * np.abs(np.arange(corr.size) - center) / max(center, 1))))
    if 0 < k < corr.size - 1:
        l, c, r = corr[k - 1], corr[k], corr[k + 1]
        denom = l - 2 * c + r
        frac = 0.5 * (l - r) / denom if denom != 0 else 0.0
    else:
        frac = 0.0
    far = np.abs(np.arange(corr.size) - k) > 0.25 * MSR
    sigma = corr[far].std() if far.any() else 1e-9
    z = float((corr[k] - corr[far].mean()) / (sigma + 1e-12)) if far.any() else 0.0
    return (ref_start + k + frac) / MSR + win / 2, z


def measure_offset(live48, music48, start, search=3.0, win=8.0, log=print):
    """live(t) = music(a + b t) の a, b を出す。start は映像の 0 秒が当たる全編の秒(実写の 0 秒がそこにあるとして探す)。
    戻り値: dict(a, b, points=[(t, 元の音の秒, z)...], stretch_applied)。"""
    live, music = to_mono16(live48), to_mono16(music48)
    dur = live.size / MSR
    win = min(win, dur / 3)
    if win < 1.0:
        raise SystemExit("実写の音が短すぎて測れない(1 秒の窓を 3 つ取れない)")
    t1, t2 = win / 2, dur - win / 2
    m1, z1 = match_window(live, music, t1, win, start + t1, search)
    pts = [(t1, m1, z1)]
    # 終わりは、頭の結果から外れていない所だけを探す
    m2, z2 = match_window(live, music, t2, win, m1 + (t2 - t1), 1.0)
    pts.append((t2, m2, z2))
    for t, m, z in pts:
        log(f"  実写 {t:7.2f} 秒 → 元の音 {m:8.3f} 秒(z={z:.1f})")
    if min(z1, z2) < MIN_Z:
        raise SystemExit(f"相関が弱い(z={z1:.1f}, {z2:.1f} < {MIN_Z})。--start か --search を見直す。ずれは信じない")
    b = (m2 - m1) / (t2 - t1)
    drift = abs(b - 1.0) * (t2 - t1)
    applied = bool(drift >= 0.005)  # 2 点の間の伸びが 5 ms 未満なら測りの誤差と区別できないので伸びは補正しない
    if not applied:
        b = 1.0
        a = ((m1 - t1) + (m2 - t2)) / 2
    else:
        a = m1 - b * t1
    return {"a": a, "b": b, "points": pts, "stretch_applied": applied, "drift_over_span_sec": drift}


# ---------- 並べて混ぜる ----------
def sample_at(x, pos_sec):
    """x (ch, n) の、pos_sec(配列)の秒の値を 3 次補間で取る。範囲の外は 0。"""
    pos = np.asarray(pos_sec) * SR
    return np.stack([map_coordinates(c.astype(np.float64), [pos], order=3, mode="constant", cval=0.0) for c in x]).astype(np.float32)


def align(live, music, start, a, b, duration, timescale=1.0):
    """映像の v 秒(0〜duration)に当たる実写の音と元の音を取り出す。show 秒 s = start + v*timescale、実写の秒 t = (s - a) / b。"""
    n = int(round(duration * SR))
    s = start + np.arange(n) / SR * timescale
    return sample_at(live, (s - a) / b), sample_at(music, s)


def fine_offset(live_a, music_a, win=3.0, count=6, max_lag=0.010, log=print):
    """並べた後に残る小さなずれ(秒)。48 kHz のまま、全帯域の白色化つき相互相関を、元の音が大きい窓で取り、中央値を返す。
    16 kHz の測りは 1 ms 弱の偏りが残り、足すと櫛の形(0.77 ms なら 650 Hz 付近)に抜けるため、混ぜる前に詰める。
    戻り値 k: music(t + k) が live(t) と重なる。つまり a に足す。"""
    x, y = live_a.mean(axis=0).astype(np.float64), music_a.mean(axis=0).astype(np.float64)
    n = int(win * SR)
    hops = np.arange(0, max(x.size - n, 1), n)
    energy = np.array([rms(y[h:h + n]) for h in hops])
    picks = hops[np.argsort(energy)[::-1][:count]]
    lags = []
    for h in picks:
        xs, ys = x[h:h + n] * np.hanning(n), y[h:h + n]
        size = 1 << int(np.ceil(np.log2(2 * n)))
        cross = np.fft.rfft(ys, size) * np.conj(np.fft.rfft(xs, size))
        freqs = np.fft.rfftfreq(size, 1 / SR)
        cross = cross / (np.abs(cross) + 1e-12 * np.abs(cross).max()) * ((freqs >= 150) & (freqs <= 8000))
        c = np.fft.irfft(cross, size)
        L = int(max_lag * SR)
        c = np.concatenate([c[-L:], c[:L + 1]])  # 遅れ -L..L
        k = int(np.argmax(c))
        if 0 < k < c.size - 1:
            d = c[k - 1] - 2 * c[k] + c[k + 1]
            frac = 0.5 * (c[k - 1] - c[k + 1]) / d if d != 0 else 0.0
        else:
            frac = 0.0
        lags.append((k - L + frac) / SR)
    log(f"  並べた後の細かいずれ: 中央値 {1000 * np.median(lags):+.3f} ms(窓 {len(lags)} 個、ばらつき {1000 * np.std(lags):.3f} ms)")
    return float(np.median(lags))


def rms(x):
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-12)


def mix(live_a, music_a, music_db):
    """元の音の rms を、実写の rms から music_db(dB)に置いて足す。2 つの声を同じ時間に並べた後に足す。"""
    gain = rms(live_a) * 10 ** (music_db / 20) / rms(music_a)
    m = live_a + music_a * gain
    peak = float(np.abs(m).max())
    return m * (0.9 / peak) if peak > 0.9 else m  # 余りに大きいときだけ float の範囲で下げる(音量は後で loudnorm が決める)


# ---------- 音量と出力 ----------
def run_ff(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostdin"] + args, capture_output=True, text=True, encoding="utf-8", errors="replace")


def loudnorm_pass1(wav, tp):
    r = run_ff(["-i", str(wav), "-af", f"loudnorm=I={TARGET_LUFS}:TP={tp}:LRA=11:print_format=json", "-f", "null", "-"])
    text = r.stderr[r.stderr.rindex("{"):]
    return json.loads(text[:text.index("}") + 1])


def loudnorm_filter(m, tp):
    return (f"loudnorm=I={TARGET_LUFS}:TP={tp}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
            f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,"
            f"aresample={SR}")


def measure_loudness(path):
    """出力 mp4 の音の積分ラウドネス(LUFS)と真のピーク(dBTP)。"""
    r = run_ff(["-i", str(path), "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
    summary = r.stderr[r.stderr.rindex("Summary:"):]
    return (float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1)),
            float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1)))


def encode(video, fps, wav, out, tp, duration, seq):
    m = loudnorm_pass1(wav, tp)
    if seq:
        files, pattern, first = seq
        vin = ["-framerate", fps, "-start_number", str(first), "-i", str(Path(files[0]).parent / pattern)]
    else:
        vin = ["-i", str(video)]
    cmd = vin + ["-i", str(wav), "-map", "0:v:0", "-map", "1:a:0", "-af", loudnorm_filter(m, tp),
                 "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough",
                 "-bsf:v", "filter_units=remove_types=6", "-c:a", "aac", "-b:a", "320k", "-ar", str(SR),
                 "-t", f"{duration:.6f}", "-movflags", "+faststart", "-map_metadata", "-1", "-map_chapters", "-1",
                 "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", "-y", str(out)]
    r = run_ff(cmd)
    if r.returncode != 0:
        raise SystemExit("ffmpeg が失敗:\n" + r.stderr[-1500:])
    return m


def build(video, live_src, music_src, out, start, music_db=DEFAULT_MUSIC_DB, fps=None, search=3.0, timescale=1.0,
          log=print):
    video = Path(video)
    if video.is_dir():
        files, pattern, first = sequence_info(video)
        fps = fps or "30"
        num, _, den = fps.partition("/")
        frames, duration = len(files), len(files) * int(den or 1) / int(num)
        seq = (files, pattern, first)
    else:
        frames, fps_s, duration = probe_video(video)
        fps, seq = fps or fps_s, None
    log(f"映像: {frames} コマ {fps} fps {duration:.4f} 秒")
    live, music = decode(live_src), decode(music_src)
    log("ずれの実測:")
    # 映像の時間と実写の音の時間は同じ頭から数える(実写の動画の音なら 0 秒 = 映像の 0 コマ目)
    est = measure_offset(live, music, start, search=search, log=log)
    log(f"  a = {est['a']:.4f} 秒(実写 0 秒が元の音のこの秒)、b = {est['b']:.6f}"
        f"({'伸びを補正' if est['stretch_applied'] else '伸びは 2 点の間で 5 ms 未満。補正しない'})")
    live_a, music_a = align(live, music, start, est["a"], est["b"], duration, timescale)
    est["a"] += fine_offset(live_a, music_a, log=log)  # 細かいずれを詰めて、並べ直す
    live_a, music_a = align(live, music, start, est["a"], est["b"], duration, timescale)
    mixed = mix(live_a, music_a, music_db)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "mix.wav"
        write_wav_f32(wav, mixed)
        tp = TARGET_TP - 0.5  # AAC にすると真のピークが少し増えるので余裕を見る
        for _ in range(4):
            encode(video, fps, wav, out, tp, duration, seq)
            lufs, peak = measure_loudness(out)
            log(f"  出力 {lufs:.2f} LUFS、サンプルのピーク {peak:.2f} dBFS(目標 TP {tp})")
            if peak <= TARGET_TP - 0.05:
                break
            tp -= 0.5
    return {"frames": frames, "duration": duration, "lufs": lufs, "peak_dbfs": peak, "estimate": est}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", help="合成の mp4 か、連番のフォルダ")
    p.add_argument("live", help="実写の音(動画か wav)。0 秒 = 映像の 0 コマ目")
    p.add_argument("music", help="元の音 show_mix.wav")
    p.add_argument("out")
    p.add_argument("--start", type=float, help="映像の 0 コマ目が当たる全編の秒")
    p.add_argument("--sync-json", help="sync_by_led.py の出力の json(shot_zero_at_show_sec を読む)")
    p.add_argument("--first-frame", type=int, default=0, help="合成を --first N から作ったときの N(実写 30 コマ毎秒換算)")
    p.add_argument("--music-db", type=float, default=DEFAULT_MUSIC_DB, help="実写に対する元の音の大きさ(dB)。既定 %(default)s")
    p.add_argument("--fps", help="連番のコマ数毎秒('30' か '30000/1001')")
    p.add_argument("--search", type=float, default=3.0, help="開始秒の前後に探す幅(秒)")
    p.add_argument("--timescale", type=float, default=1.0,
                   help="映像の 1 秒が全編の何秒か。29.97p の録音を 30 で並べた連番は 30/29.97")
    a = p.parse_args()
    start = a.start
    if a.sync_json:
        data = json.loads(Path(a.sync_json).read_text(encoding="utf-8"))
        start = data["shot_zero_at_show_sec"] + a.first_frame / 30
    elif start is not None:
        start += a.first_frame / 30
    if start is None:
        sys.exit("--start か --sync-json が要る")
    res = build(a.video, a.live, a.music, a.out, start, a.music_db, a.fps, a.search, a.timescale)
    est = res.pop("estimate")
    print(json.dumps({**res, "a": round(est["a"], 4), "b": round(est["b"], 6),
                      "stretch_applied": est["stretch_applied"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
