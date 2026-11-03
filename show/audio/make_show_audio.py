"""ショーの音を 1 コマンドで作る。曲が差し替わっても同じコマンドで、分離・口の動き・拍まで作り直す。
使い方:
  python make_show_audio.py --script show/show_script.json --song <wav か temp>
      [--song-start 秒] [--song-len 秒] --out <出力フォルダ>
      [--answer-file <返事.json>] [--ledger <ledger.json>] [--temp-voice-src <声の元>]
出力(--out): show_mix.wav(48kHz 24bit ステレオ・全編)、vocals.wav・karaoke.wav(分離の結果。
  show_mix と同じ長さ・同じ位置に置く。曲の区間の外は無音)、timeline.json。作業の途中の物は work/ に置く。
絶対パスは引数か環境変数で渡す: SHOW_ANSWER_FILE、TTS_LEDGER、SHOW_TEMP_VOICE_SRC、ELEVENLABS_API_KEY(鍵は表示しない)。
"""
import argparse, json, os, pathlib, subprocess, sys
import numpy as np, soundfile as sf
from scipy.signal import resample_poly

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import line_match, show_beats, show_mouth, show_tts  # noqa: E402

SR = 48000
FPS = 60
FRAME = SR // FPS  # 800 サンプル。区間の境目はすべてコマの境目にそろえる
LEAD, TRAIL = 0.3, 0.4  # せりふの前後の余白(秒)
SONG_FADE = 0.5
SEP_SR = 44100
TTS_PEAK_DB, SONG_PEAK_DB = -2.0, -3.0
BEEP_EDGE_SEC = 0.002
DUCK_RAMP = 0.3  # せりふの前後で曲を下げる・戻す秒数


def frames_of(sec):
    return int(round(sec * FPS))


def read_answer(script, cli_path, script_dir):
    """返事 json の answer を書き換えずに使う。無ければ answer_placeholder。(文, 仮か)"""
    cand = cli_path or os.environ.get("SHOW_ANSWER_FILE") or script.get("answer_file")
    if cand:
        p = pathlib.Path(cand)
        if not p.is_absolute():
            p = script_dir / p
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))["answer"], False
    return script["answer_placeholder"], True


def locate_says(script, cli_path, script_dir, x, t0):
    """返事 json の says(文ごとの表情・動き)に、show 全体の開始秒をつける。
    文の境目は、文字数の比から予想した位置の近くで、いちばん長い無音を探す。"""
    cand = cli_path or os.environ.get("SHOW_ANSWER_FILE") or script.get("answer_file")
    p = pathlib.Path(cand) if cand else None
    if p is not None and not p.is_absolute():
        p = script_dir / p
    if p is None or not p.exists():
        return []
    says = json.loads(p.read_text(encoding="utf-8")).get("says", [])
    if not says:
        return []
    hop = SR // 100
    env = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, "same"))[::hop]
    quiet = env < 0.03 * env.max()
    t_first = np.flatnonzero(~quiet)[0] / 100.0
    chars = np.cumsum([0] + [len(sy["text"]) for sy in says])
    starts_sec = [t_first]
    for k in range(1, len(says)):
        guess = t_first + (len(x) / SR - t_first) * chars[k] / chars[-1]
        lo, hi = max(int((guess - 0.8) * 100), 0), min(int((guess + 0.8) * 100), len(quiet))
        best, i = (0, int(guess * 100)), lo
        while i < hi:
            if quiet[i]:
                j = i
                while j < len(quiet) and quiet[j]:
                    j += 1
                if j - i > best[0]:
                    best = (j - i, j)
                i = j
            else:
                i += 1
        starts_sec.append(best[1] / 100.0)
    return [{"start": round(t0 + st, 3), "text": sy["text"], "expression": sy.get("expression"),
             "motion": sy.get("motion"), "gaze": sy.get("gaze")} for st, sy in zip(starts_sec, says)]


def ffmpeg_cut(src, dst, start, length, sr):
    cmd = ["ffmpeg", "-y", "-v", "error", "-ss", str(start)]
    if length:
        cmd += ["-t", str(length)]
    cmd += ["-i", str(src), "-ac", "2", "-ar", str(sr), "-c:a", "pcm_f32le", str(dst)]
    subprocess.run(cmd, check=True)


def separate(seg_wav, device):
    """demucs(htdemucs)で vocals と no_vocals(44.1kHz ステレオ float)に分ける。"""
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    model = get_model("htdemucs")
    model.eval()
    x, sr = sf.read(str(seg_wav), dtype="float32", always_2d=True)
    assert sr == model.samplerate and x.shape[1] == 2, (sr, x.shape)
    wav = torch.from_numpy(x.T.copy())
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        out = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    src = out.cpu().numpy()
    v = src[model.sources.index("vocals")]
    nv = sum(src[i] for i, s in enumerate(model.sources) if s != "vocals")
    return v.T, nv.T


def to48(x):
    return resample_poly(x, 160, 147, axis=0)  # 44100 -> 48000


def fit_len(x, n):
    x = x[:n]
    return np.pad(x, [(0, n - len(x))] + [(0, 0)] * (x.ndim - 1))


def peak_scale(x, db):
    m = float(np.max(np.abs(x))) or 1.0
    return 10 ** (db / 20) / m


def ceil_frame(n):
    return -(-n // FRAME) * FRAME


def add_sync_beeps(mix, sync, section_starts):
    """同期のフラッシュごとに短いビープを足す。両端は短くなめらかにして、つなぎ目の音を防ぐ"""
    count = int(round(sync["beep_sec"] * SR))
    tone = np.sin(2 * np.pi * sync["beep_hz"] * np.arange(count) / SR) * 10 ** (sync["beep_db"] / 20)
    edge = int(BEEP_EDGE_SEC * SR)
    ramp = np.linspace(0, 1, edge)
    tone[:edge] *= ramp
    tone[-edge:] *= ramp[::-1]
    for section_start in section_starts:
        for at in sync["flash_starts"]:
            pos = section_start + int(round(at * SR))
            mix[pos:pos + count] += tone[:, None]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--script", required=True)
    ap.add_argument("--song", help="曲の wav(mp3 も可)か temp(仮の曲を作る)。--vocals と --karaoke があれば省ける")
    ap.add_argument("--vocals", help="歌声だけの wav(曲と同じ長さ・頭がそろっている)。渡すと demucs を動かさない")
    ap.add_argument("--karaoke", help="伴奏だけの wav。--vocals と一緒に渡す")
    ap.add_argument("--song-start", type=float)
    ap.add_argument("--song-len", type=float)
    ap.add_argument("--out", required=True)
    ap.add_argument("--answer-file")
    ap.add_argument("--ledger", default=os.environ.get("TTS_LEDGER"))
    ap.add_argument("--temp-voice-src", default=os.environ.get("SHOW_TEMP_VOICE_SRC"))
    ap.add_argument("--cache-dir")
    ap.add_argument("--device", default=None)
    a = ap.parse_args()

    script_path = pathlib.Path(a.script).resolve()
    script = json.loads(script_path.read_text(encoding="utf-8"))
    out = pathlib.Path(a.out)
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)
    cache_dir = pathlib.Path(a.cache_dir) if a.cache_dir else out.resolve().parent.parent / "tts_cache"
    dur = script["durations"]
    start = a.song_start if a.song_start is not None else script["song"]["start_sec"]
    length = a.song_len if a.song_len is not None else script["song"]["len_sec"]
    report = {}

    # 1. 曲を用意して切り出す
    have_stems = bool(a.vocals and a.karaoke)
    if bool(a.vocals) != bool(a.karaoke):
        sys.exit("--vocals と --karaoke は両方いっしょに渡す")
    if not a.song and not have_stems:
        sys.exit("--song か、--vocals と --karaoke が要る")
    if have_stems:
        song_src = pathlib.Path(a.vocals)
    elif a.song == "temp":
        song_src = work / "temp_song.wav"
        if not song_src.exists():
            if not a.temp_voice_src:
                sys.exit("--song temp には --temp-voice-src か環境変数 SHOW_TEMP_VOICE_SRC が要る")
            subprocess.run([sys.executable, str(HERE / "make_temp_song.py"), "--voice-src", a.temp_voice_src,
                            "--out", str(song_src)], check=True)
    else:
        song_src = pathlib.Path(a.song)
    seg = work / "song_segment.wav"
    if have_stems:  # 分けた物をそのまま使う(demucs は動かさない)
        segv, segk = work / "stem_vocals.wav", work / "stem_karaoke.wav"
        ffmpeg_cut(a.vocals, segv, start, length, SEP_SR)
        ffmpeg_cut(a.karaoke, segk, start, length, SEP_SR)
        v44 = sf.read(str(segv), dtype="float32", always_2d=True)[0]
        nv44 = sf.read(str(segk), dtype="float32", always_2d=True)[0]
        n_min = min(len(v44), len(nv44))
        v44, nv44 = v44[:n_min], nv44[:n_min]
        sf.write(str(seg), v44 + nv44, SEP_SR, subtype="PCM_24")
        sep = "given_stems"
    else:
        ffmpeg_cut(song_src, seg, start, length, SEP_SR)
    info = sf.info(str(seg))
    song_n = int(info.frames / SEP_SR * SR) // FRAME * FRAME  # コマの境目に切り捨て
    report["song"] = {"source": song_src.name, "start": start, "len_requested": length, "len_used": song_n / SR}

    # 2. 分離(GPU)。stems を渡されたときは動かさない
    if not have_stems:
        import torch
        device = a.device or ("cuda" if torch.cuda.is_available() else "cpu")
        v44, nv44 = separate(seg, device)
        sep = "demucs:htdemucs"
    report["separation"] = sep
    seg_mix = sf.read(str(seg), dtype="float32", always_2d=True)[0]
    song_mix = fit_len(to48(seg_mix), song_n)
    voc = fit_len(to48(v44), song_n)
    kar = fit_len(to48(nv44), song_n)
    g = peak_scale(song_mix, SONG_PEAK_DB)
    fade = np.ones(song_n)
    fi, fo = int(0.02 * SR), int(SONG_FADE * SR)
    fade[:fi] = np.linspace(0, 1, fi)
    fade[-fo:] = np.minimum(fade[-fo:], np.linspace(1, 0, fo))
    song_mix, voc, kar = [s * g * fade[:, None] for s in (song_mix, voc, kar)]

    # 3. 読み上げ(キャッシュ)
    answer_text, placeholder = read_answer(script, a.answer_file, script_path.parent)
    voices = {}
    for sid, text in (("line", script["line"]), ("answer", answer_text)):
        wav, called = show_tts.synth(text, script["voice_id"], script["tts_model"], cache_dir, a.ledger)
        x = sf.read(str(wav), dtype="float64")[0]
        voices[sid] = x * peak_scale(x, TTS_PEAK_DB)
        report[f"tts_{sid}"] = {"chars": len(text), "api_called": called, "cache": wav.name, "sec": len(x) / SR}

    # 4. 区間を並べる(境目はコマの境目)
    def pad_n(sec):
        return frames_of(sec) * FRAME

    over = bool(script["song"].get("line_over_intro", False))
    line_n = pad_n(LEAD) + ceil_frame(len(voices["line"])) + pad_n(TRAIL)
    plan = []  # (id, サンプル数)。重ならない並び。line_over_intro のときの line は曲の上に重ねる
    for sid in ("preroll", "sync_head", "dark", "enter"):
        plan.append((sid, pad_n(dur[sid])))
    if not over:
        plan.append(("line", line_n))
    plan.append(("song", song_n))
    for sid in ("bow", "listen"):
        plan.append((sid, pad_n(dur[sid])))
    plan.append(("answer", pad_n(LEAD) + ceil_frame(len(voices["answer"])) + pad_n(TRAIL)))
    for sid in ("outro", "tail", "sync_tail", "black_end"):
        plan.append((sid, pad_n(dur[sid])))
    total = sum(n for _, n in plan)
    starts, pos = {}, 0
    for sid, n in plan:
        starts[sid] = pos
        pos += n
    n_frames = total // FRAME
    plan_n = dict(plan)

    mix = np.zeros((total, 2))
    vocals = np.zeros((total, 2))
    karaoke = np.zeros((total, 2))
    mouth = np.zeros(n_frames)
    mouth_info = {}
    if over:  # 語りの始まりは曲の頭から line_at_sec 秒(イントロの上)
        line_at = pad_n(script["song"]["line_at_sec"])
        starts["line"] = starts["song"] + line_at
        assert line_at + line_n <= song_n, "せりふが曲より長い"
        plan_n["line"] = line_n
    # せりふと返事を歌と同じ空間に置く(音量を歌声にそろえ、高域を落とし、リバーブを足す)
    line_cfg = script["song"].get("line_match")
    placed = {}
    if line_cfg is not None:
        sung = slice(int(float(line_cfg.get("sung_from_sec", 8.5)) * SR), None)
        sung_vocal = line_match.lufs(voc[sung])
        sung_backing = line_match.lufs(kar[sung])
        report["line_match"] = {"sung_vocal_lufs": round(sung_vocal, 1), "sung_backing_lufs": round(sung_backing, 1)}
        for sid in ("line", "answer"):
            placed[sid], report["line_match"][sid] = line_match.process(voices[sid], sung_vocal, line_cfg)
    for sid in ("line", "answer"):
        s0 = starts[sid] + pad_n(LEAD)
        x = voices[sid]
        if sid in placed:
            room = min(len(placed[sid]), total - s0)
            mix[s0:s0 + room] += placed[sid][:room]
        else:
            mix[s0:s0 + len(x), 0] += x
            mix[s0:s0 + len(x), 1] += x
        n = plan_n[sid]
        seg_x = np.zeros(n)
        seg_x[pad_n(LEAD):pad_n(LEAD) + len(x)] = x
        m, mi = show_mouth.mouth_curve(seg_x, SR, n // FRAME)
        mouth[starts[sid] // FRAME:(starts[sid] + n) // FRAME] = m
        mouth_info[sid] = mi
    s0 = starts["song"]
    mix[s0:s0 + song_n] += song_mix
    vocals[s0:s0 + song_n] = voc
    karaoke[s0:s0 + song_n] = kar
    m, mi = show_mouth.mouth_curve(voc.mean(axis=1), SR, song_n // FRAME)
    if over:  # せりふの間は口をせりふに任せ、そのあとが歌声
        m[:(line_at + line_n) // FRAME] = 0.0
    sl = slice(s0 // FRAME, (s0 + song_n) // FRAME)
    mouth[sl] = np.maximum(mouth[sl], m)
    mouth_info["song"] = mi
    if over:  # イントロの音量はそのまま。せりふが聞こえるか(せりふ区間の声 vs 曲)を測る
        l0 = starts["line"] + pad_n(LEAD) - s0
        w = slice(l0, l0 + len(voices["line"]))

        def rms(v):
            return float(np.sqrt(np.mean(np.square(v)) + 1e-12))
        report["line_over_intro"] = {
            "line_rms_db": round(20 * np.log10(rms(voices["line"])), 1),
            "song_rms_db_same_window": round(20 * np.log10(rms(song_mix[w])), 1),
            "line_minus_song_db": round(20 * np.log10(rms(voices["line"]) / rms(song_mix[w])), 1)}
    energy_src = mix.mean(axis=1)  # 背景用の energy は、曲を下げる前の音で測る
    duck_db = float(script["song"].get("line_duck_db", 0) or 0)
    if over and line_cfg is not None:
        # 伴奏の下げ方は、歌の部分の歌声と伴奏の差から決める
        duck_db = line_match.duck_for(line_match.lufs(placed["line"]), line_match.lufs(song_mix[w]), sung_vocal, sung_backing)
    if over and duck_db > 0:  # せりふの間だけ曲(伴奏と全体)を下げる。前後 DUCK_RAMP 秒はなだらかに
        l1, ramp = l0 + len(voices["line"]), int(DUCK_RAMP * SR)
        low = 10 ** (-duck_db / 20)
        gd = np.ones(song_n)
        gd[l0:l1] = low
        t = 0.5 * (1 + np.cos(np.pi * np.arange(ramp) / ramp))  # 1 -> 0
        lo_a = max(l0 - ramp, 0)
        down = low + (1 - low) * t            # 下げる側: 1 -> low
        gd[lo_a:l0] = down[ramp - (l0 - lo_a):]
        up_n = min(ramp, song_n - l1)
        gd[l1:l1 + up_n] = (low + (1 - low) * (1 - t))[:up_n]  # 戻す側: low -> 1
        mix[s0:s0 + song_n] -= song_mix * (1 - gd)[:, None]
        karaoke[s0:s0 + song_n] *= gd[:, None]
        sd = song_mix[w] * low
        report["line_over_intro"]["duck_db"] = duck_db
        report["line_over_intro"]["song_rms_db_same_window_ducked"] = round(20 * np.log10(rms(sd)), 1)
        report["line_over_intro"]["line_minus_song_db_ducked"] = round(20 * np.log10(rms(voices["line"]) / rms(sd)), 1)
    add_sync_beeps(mix, script["sync"], [starts["sync_head"], starts["sync_tail"]])
    pk = float(np.max(np.abs(mix)))
    report["peak_before_safety"] = pk
    if pk > 10 ** (-1.0 / 20):  # 声と曲が重なってクリップしそうなら、3 本とも同じ倍率で -1 dBFS に下げる
        k = 10 ** (-1.0 / 20) / pk
        mix, vocals, karaoke = mix * k, vocals * k, karaoke * k
        report["safety_gain_db"] = round(20 * np.log10(k), 2)
    answer_says = locate_says(script, a.answer_file, script_path.parent, voices["answer"],
                              (starts["answer"] + pad_n(LEAD)) / SR)
    energy = show_mouth.energy_curve(energy_src, SR, n_frames)

    # 5. 拍
    b = show_beats.analyze(song_mix.mean(axis=1), SR, offset_sec=s0 / SR)
    report["beats"] = b["info"]

    # 6. 書き出し
    for name, arr in (("show_mix.wav", mix), ("vocals.wav", vocals), ("karaoke.wav", karaoke)):
        sf.write(str(out / name), arr, SR, subtype="PCM_24")
    timeline = {
        "fps": FPS, "duration_sec": total / SR, "frames": n_frames, "answer_is_placeholder": placeholder,
        "sections": sorted(({"id": sid, "start": starts[sid] / SR, "end": (starts[sid] + plan_n[sid]) / SR}
                            for sid in plan_n), key=lambda d: (d["start"], d["id"] == "line")),
        "beats": b["beats"], "downbeats": b["downbeats"], "bpm": b["bpm"],
        "mouth": [round(float(v), 4) for v in mouth], "energy": [round(float(v), 4) for v in energy],
        "answer_says": answer_says, "sync": {"flash_starts": script["sync"]["flash_starts"], "flash_sec": script["sync"]["flash_sec"]},
    }
    (out / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False), encoding="utf-8")
    report["mouth"] = mouth_info
    report["peak_mix"] = float(np.max(np.abs(mix)))
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(json.dumps({"duration_sec": timeline["duration_sec"], "frames": n_frames, "bpm": b["bpm"],
                      "beats": len(b["beats"]), "placeholder": placeholder}, ensure_ascii=False))


if __name__ == "__main__":
    main()
