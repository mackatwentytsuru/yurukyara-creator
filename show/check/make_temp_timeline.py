"""音の担当の timeline がまだ無いときに、映像の試しに使う仮の timeline と音を作る。
使い方: python show/check/make_temp_timeline.py <出力フォルダ> [--bpm 128]
静かなイントロ(せりふが乗る)→ サビ の形。音はクリックと低い音だけの確認用。
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

FPS = 60
RATE = 48000
PREROLL, DARK, ENTER, BOW, LISTEN, OUTRO, TAIL = 20.0, 4.0, 3.0, 5.0, 7.0, 4.0, 5.0
LINE_SEC, ANSWER_SEC = 5.0, 9.0
INTRO_SEC, SONG_SEC = 10.0, 34.0


def syllables(rng, frames, rate_hz, level):
    t = np.arange(frames) / FPS
    env = np.abs(np.sin(np.pi * rate_hz * t + rng.uniform(0, 3)))
    return np.clip(env * level * (0.7 + 0.3 * rng.random(frames)), 0, 1)


def build(bpm):
    rng = np.random.default_rng(1103)
    t = PREROLL
    sections = [{"id": "preroll", "start": 0.0, "end": t}]

    def add(section_id, length):
        nonlocal t
        sections.append({"id": section_id, "start": round(t, 4), "end": round(t + length, 4)})
        t += length

    add("dark", DARK)
    add("enter", ENTER)
    song_start = t
    sections.append({"id": "line", "start": round(t + 1.0, 4), "end": round(t + 1.0 + LINE_SEC, 4)})
    add("song", SONG_SEC)
    add("bow", BOW)
    add("listen", LISTEN)
    add("answer", ANSWER_SEC)
    add("outro", OUTRO)
    add("tail", TAIL)
    duration = t
    frames = int(round(duration * FPS))

    beat_sec = 60.0 / bpm
    song_end = song_start + SONG_SEC
    beats = [round(b, 4) for b in np.arange(song_start, song_end, beat_sec)]
    downbeats = beats[::4]

    mouth = np.zeros(frames)
    energy = np.zeros(frames)
    chorus_start = song_start + INTRO_SEC
    for section in sections:
        a, b = int(section["start"] * FPS), int(section["end"] * FPS)
        if section["id"] in ("line", "answer"):
            mouth[a:b] = syllables(rng, b - a, 3.4, 0.9)
        if section["id"] == "song":
            vocal_from = int(chorus_start * FPS)
            mouth[vocal_from:b] = syllables(rng, b - vocal_from, 2.6, 0.95)
    time = np.arange(frames) / FPS
    pulse = np.zeros(frames)
    for beat in beats:
        k = int(beat * FPS)
        span = min(frames - k, 30)
        pulse[k:k + span] = np.maximum(pulse[k:k + span], np.exp(-np.arange(span) / 8.0))
    in_song = (time >= song_start) & (time < song_end)
    in_chorus = (time >= chorus_start) & (time < song_end)
    energy[in_song] = 0.18 + 0.1 * pulse[in_song]
    energy[in_chorus] = 0.62 + 0.3 * pulse[in_chorus]
    tail_mask = (time >= song_end) & (time < song_end + 2.0)
    energy[tail_mask] = 0.4 * np.exp(-(time[tail_mask] - song_end) * 2.0)

    answer = next(s for s in sections if s["id"] == "answer")
    timeline = {
        "fps": FPS,
        "duration_sec": duration,
        "frames": frames,
        "answer_is_placeholder": True,
        "sections": sections,
        "beats": beats,
        "downbeats": downbeats,
        "bpm": bpm,
        "mouth": [round(float(v), 4) for v in mouth],
        "energy": [round(float(v), 4) for v in energy],
        "answer_says": [
            {"start": answer["start"], "expression": "surprised", "motion": "bow"},
            {"start": round(answer["start"] + 3.6, 3), "expression": "happy", "motion": "nod"},
        ],
    }
    return timeline, beats, downbeats, duration


def make_audio(beats, downbeats, duration):
    count = int(round(duration * RATE))
    mix = np.zeros(count)
    for beat in beats:
        k = int(beat * RATE)
        span = min(count - k, int(0.12 * RATE))
        tone = np.sin(2 * math.pi * 90 * np.arange(span) / RATE) * np.exp(-np.arange(span) / (0.03 * RATE))
        mix[k:k + span] += tone * (0.5 if beat in downbeats else 0.3)
    pcm = np.clip(mix, -1, 1)
    return np.stack([pcm, pcm], axis=1)


def write_wav24(path, stereo):
    import wave

    ints = (stereo * 8388607).astype(np.int32)
    raw = ints.reshape(-1).astype("<i4").tobytes()
    packed = b"".join(raw[i:i + 3] for i in range(0, len(raw), 4))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(RATE)
        w.writeframes(packed)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("--bpm", type=float, default=128)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    timeline, beats, downbeats, duration = build(args.bpm)
    (out / "timeline.json").write_text(json.dumps(timeline), encoding="utf-8")
    write_wav24(out / "show_mix.wav", make_audio(beats, downbeats, duration))
    print(json.dumps({"frames": timeline["frames"], "duration_sec": duration, "out": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
