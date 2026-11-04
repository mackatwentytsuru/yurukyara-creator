"""曲が流れている中で、声が聞き取れるかの机上の試験(聞き取りの文字の誤り率を、声と曲の大きさの比ごとに出す)。
  python kiosk/tools/stt_music_test.py --music <曲の wav か mp3> --server http://127.0.0.1:8843 --out result.json
手順: (1) Windows の日本語の声(Haruka)で、インタビューの質問を作る → (2) 曲(ループ)を、声に対する大きさの比(SMR dB)を変えて混ぜる
     → (3) サーバーの /api/stt(faster-whisper)で文字にする → (4) 文字の誤り率(正解との編集距離 ÷ 正解の文字数)を出す。
限界: 声は合成音声(きれいで、残響も口の動きもない)なので、本物のマイク・部屋より**楽観的**。曲は 1 曲だけ。実機(録音機を入口に置いた音)で必ず測り直す。
SMR は、声の RMS ÷ 曲の RMS(dB)。+∞ は曲なし。小さいほど曲が大きい。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import urllib.request
import wave
from pathlib import Path

import numpy as np

SR = 16000
PHRASES = [
    "自己紹介をしてください",
    "ここはどんなお店ですか",
    "今日は何時まで開いていますか",
    "ステージの画面と、ここの画面は何が違うんですか",
    "緊張していますか",
    "お店に来る前に知っておけたら嬉しいことは何ですか",
    "どうやって私の方を見ているんですか",
    "最後に、見ている人に一言お願いします",
]
SMRS = [None, 10, 5, 0, -5]


def synth(text: str, out: Path) -> None:
    ps = (
        "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$s.SelectVoice('Microsoft Haruka Desktop'); $f=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono); "
        f"$s.SetOutputToWaveFile('{out}',$f); $s.Speak('{text}'); $s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)


def read_wav(p: Path) -> np.ndarray:
    with wave.open(str(p), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def write_wav(p: Path, x: np.ndarray) -> None:
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def load_music(path: str, tmp: Path) -> np.ndarray:
    out = tmp / "music16k.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR), str(out)], check=True)
    return read_wav(out)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)) + 1e-9)


def mix(speech: np.ndarray, music: np.ndarray, smr_db) -> np.ndarray:
    pad = int(SR * 0.6)  # 声の前後に、曲だけの間を少し置く(曲が先に流れている状態)
    n = len(speech) + 2 * pad
    bed = np.resize(music, n)
    sp = np.concatenate([np.zeros(pad, np.float32), speech, np.zeros(pad, np.float32)])
    if smr_db is None:
        out = sp
    else:
        gain = rms(speech) / (rms(bed) * 10 ** (smr_db / 20))
        out = sp + bed * gain
    peak = np.abs(out).max()
    return out / peak * 0.9 if peak > 0.9 else out


def norm(t: str) -> str:
    return "".join(ch for ch in t if ch.isalnum())


def edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def transcribe(server: str, wav: Path) -> str:
    req = urllib.request.Request(server + "/api/stt", data=wav.read_bytes(), headers={"Content-Type": "audio/wav"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read()).get("text", "")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--music", required=True)
    ap.add_argument("--server", default="http://127.0.0.1:8787")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="sttmusic_"))
    music = load_music(a.music, tmp)
    speeches = []
    for i, t in enumerate(PHRASES):
        p = tmp / f"s{i}.wav"
        synth(t, p)
        speeches.append(read_wav(p))
    rows = []
    for smr in SMRS:
        errs, total, samples = 0, 0, []
        for t, sp in zip(PHRASES, speeches):
            m = tmp / "mix.wav"
            write_wav(m, mix(sp, music, smr))
            got = transcribe(a.server, m)
            e = edit_distance(norm(t), norm(got))
            errs += e
            total += len(norm(t))
            if len(samples) < 3:
                samples.append({"正解": t, "聞き取り": got})
        rows.append({"SMR_dB": "曲なし" if smr is None else smr, "文字の誤り率": round(errs / total, 3), "例": samples})
        print(rows[-1]["SMR_dB"], rows[-1]["文字の誤り率"])
    if a.out:
        Path(a.out).write_text(json.dumps({"質問の数": len(PHRASES), "結果": rows, "注意": "合成音声・曲 1 曲。本物のマイクと部屋では悪くなる(楽観的な値)"}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
