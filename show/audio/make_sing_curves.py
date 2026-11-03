#!/usr/bin/env python
"""歌詞の読みと語の秒から、歌う口(母音 5 つ)・息・表情の予定を作る。声の大きさで開きを決めるので、音のない所では閉じる。
使い方: make_sing_curves.py --lyrics <lyrics.json> --vocals <vocals.wav> --timeline <timeline.json> --song-start 秒 --out <出力.json>
lyrics.json の形: {"lines": [{"mood": [["sad", 0.25]], "words": [["読み", 始めの秒, 終わりの秒], ...]}, ...]}。秒は曲の頭から。
出力: {"first": コマ, "frames": n, "vowels": {"aa": [...], ...}, "breath": [...], "strength": [...], "moods": [[始めのコマ, 終わりのコマ, 名前, 重み], ...]}
"""
import argparse
import json
import pathlib
import wave

import numpy as np

FPS = 60
VOWELS = ["aa", "ih", "ou", "ee", "oh"]
ROW_A = "あかさたなはまやらわがざだばぱきゃしゃちゃにゃひゃみゃりゃぎゃじゃびゃぴゃ"
KANA_VOWEL = {
    **{c: "aa" for c in "あかさたなはまやらわがざだばぱ"},
    **{c: "ih" for c in "いきしちにひみりぎじぢびぴ"},
    **{c: "ou" for c in "うくすつぬふむゆるぐずづぶぷ"},
    **{c: "ee" for c in "えけせてねへめれげぜでべぺ"},
    **{c: "oh" for c in "おこそとのほもよろをごぞどぼぽ"},
}
SMALL = {"ゃ": "aa", "ゅ": "ou", "ょ": "oh", "ぁ": "aa", "ぃ": "ih", "ぅ": "ou", "ぇ": "ee", "ぉ": "oh"}
LIP_CLOSED = set("まみむめもばびぶべぼぱぴぷぺぽ")  # 唇を一度閉じる音
CROSS_SEC = 0.05  # 母音のつなぎ
LIP_DIP_SEC = 0.07
GAIN = {"aa": 1.0, "ih": 0.95, "ou": 0.9, "ee": 0.9, "oh": 0.95}
FLOOR_DB, TOP_DB = -22.0, -2.0  # 声の大きさの幅(ピーク基準)。ここを 0〜1 にする
ATTACK_SEC, RELEASE_SEC = 0.03, 0.05
OPEN_POWER = 1.5  # 大きな声ほど開く差を広げる
OPEN_MAX = 0.85
PHRASE_GAP_SEC = 0.22  # これより長い無音で息を吸う
INHALE_SEC = 0.32


def morae(reading):
    """読み(ひらがな)を、1 拍ごとの (母音, 唇を閉じるか) にする。ん・っ・ーは母音を前からのばす扱いの印を返す。"""
    out = []
    for ch in reading:
        if ch in SMALL and out:
            out[-1] = (SMALL[ch], out[-1][1])
        elif ch == "ん":
            out.append(("n", False))
        elif ch == "っ":
            out.append(("q", False))
        elif ch == "ー":
            out.append(("long", False))
        elif ch in KANA_VOWEL:
            out.append((KANA_VOWEL[ch], ch in LIP_CLOSED))
        else:
            raise ValueError(f"読みに知らない字: {ch} ({reading})")
    return out


def read_mono(path):
    with wave.open(str(path), "rb") as f:
        rate, channels, width, count = f.getframerate(), f.getnchannels(), f.getsampwidth(), f.getnframes()
        raw = f.readframes(count)
    if width == 3:
        data = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        values = (data[:, 0].astype(np.int32) | (data[:, 1].astype(np.int32) << 8) | (data[:, 2].astype(np.int8).astype(np.int32) << 16)) / 8388608.0
    elif width == 2:
        values = np.frombuffer(raw, np.int16) / 32768.0
    else:
        raise ValueError(f"この wav の幅は読めない: {width}")
    return values.reshape(-1, channels).mean(axis=1), rate


def strength_curve(x, rate, frames):
    """コマごとの声の大きさ 0〜1。声の帯域だけを見る。"""
    hop = rate // FPS
    win = 2 * hop
    pad = np.pad(x, (win // 2, win))
    index = np.arange(frames)[:, None] * hop + np.arange(win)[None, :]
    index = index[index[:, -1] < len(pad)]
    spec = np.abs(np.fft.rfft(pad[index] * np.hanning(win), axis=1)) ** 2
    freq = np.fft.rfftfreq(win, 1 / rate)
    power = spec[:, (freq >= 150) & (freq <= 4000)].sum(axis=1)
    db = 10 * np.log10(power + 1e-12)
    db = db - np.percentile(db, 99)
    raw = np.clip((db - FLOOR_DB) / (TOP_DB - FLOOR_DB), 0, 1)
    raw = np.pad(raw, (0, frames - len(raw)))
    out = np.zeros(frames)
    up, down = 1 - np.exp(-1 / (ATTACK_SEC * FPS)), 1 - np.exp(-1 / (RELEASE_SEC * FPS))
    level = 0.0
    for i, v in enumerate(raw):
        level += (v - level) * (up if v > level else down)
        out[i] = level
    return out, raw


def vowel_tracks(lines, frames, start_sec):
    """読みの予定から、母音ごとの重み(合計 1 か 0)と、唇を閉じる量を作る。"""
    tracks = {v: np.zeros(frames) for v in VOWELS}
    lip = np.ones(frames)
    t_axis = start_sec + np.arange(frames) / FPS
    slots = []
    for line in lines:
        for reading, s, e in line["words"]:
            parts = morae(reading)
            step = (e - s) / len(parts)
            for i, (vowel, closed) in enumerate(parts):
                slots.append((s + i * step, s + (i + 1) * step, vowel, closed))
    previous = None
    for s, e, vowel, closed in slots:
        if vowel in ("long",):
            vowel = previous or "aa"
        if vowel == "q":
            vowel = previous or "ih"
        if vowel == "n":
            # 「ん」は口を軽く閉じる
            mask = (t_axis >= s) & (t_axis < e)
            lip[mask] = np.minimum(lip[mask], 0.25)
            vowel = previous or "ou"
        previous = vowel
        rise = np.clip((t_axis - (s - CROSS_SEC / 2)) / CROSS_SEC, 0, 1)
        fall = 1 - np.clip((t_axis - (e - CROSS_SEC / 2)) / CROSS_SEC, 0, 1)
        tracks[vowel] += rise * fall
        if closed:
            dip = np.exp(-(((t_axis - s) / (LIP_DIP_SEC / 2)) ** 2))
            lip = np.minimum(lip, 1 - 0.85 * dip)
    total = sum(tracks.values())
    scale = np.where(total > 1, 1 / np.maximum(total, 1e-6), 1.0)
    return {v: tracks[v] * scale for v in VOWELS}, lip


def breath_curve(strength, frames):
    """息を吸う量 0〜1。長い無音のあと、声が出る直前に山になる。"""
    voiced = strength > 0.12
    breath = np.zeros(frames)
    gap = PHRASE_GAP_SEC * FPS
    width = INHALE_SEC * FPS
    i = 0
    while i < frames:
        if voiced[i]:
            i += 1
            continue
        j = i
        while j < frames and not voiced[j]:
            j += 1
        if j - i >= gap and j < frames:
            x = np.arange(frames)
            breath = np.maximum(breath, np.exp(-(((x - (j - width * 0.3)) / (width * 0.5)) ** 2)))
        i = j
    return breath


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lyrics", required=True)
    ap.add_argument("--vocals", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--song-start", type=float, required=True, help="全編のどの秒から曲が始まるか")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    lyrics = json.loads(pathlib.Path(a.lyrics).read_text(encoding="utf-8"))
    timeline = json.loads(pathlib.Path(a.timeline).read_text(encoding="utf-8"))
    frames = timeline["frames"]
    x, rate = read_mono(a.vocals)
    strength, raw = strength_curve(x, rate, frames)
    for line in lyrics["lines"]:
        line["words"] = [[r, s + a.song_start, e + a.song_start] for r, s, e in line["words"]]
    tracks, lip = vowel_tracks(lyrics["lines"], frames, 0.0)
    # 歌詞の無い音(せりふ・返事)には母音を付けない。ページは timeline の口を使う
    first_sing = min(line["words"][0][1] for line in lyrics["lines"])
    last_sing = max(line["words"][-1][2] for line in lyrics["lines"])
    a_frame, b_frame = int(first_sing * FPS) - 6, int((last_sing + 0.6) * FPS)
    # 最後の語を伸ばす間は、最後の母音のまま
    open_amount = OPEN_MAX * strength ** OPEN_POWER * lip
    vowels = {v: [round(float(n), 3) for n in tracks[v][a_frame:b_frame] * GAIN[v] * open_amount[a_frame:b_frame]] for v in VOWELS}
    moods = []
    for line in lyrics["lines"]:
        s, e = line["words"][0][1], line["words"][-1][2]
        for name, weight in line.get("mood", []):
            moods.append([int(s * FPS), int(e * FPS), name, weight])
    for s, e, name, weight in lyrics.get("accents", []):
        moods.append([int((s + a.song_start) * FPS), int((e + a.song_start) * FPS), name, weight])
    pathlib.Path(a.out).write_text(json.dumps({
        "first": a_frame, "frames": b_frame - a_frame, "vowels": vowels,
        "breath": [round(float(v), 3) for v in breath_curve(strength, frames)],
        "strength": [round(float(v), 3) for v in strength], "moods": moods}), encoding="utf-8")

    # 確かめ: 口の開きと声の大きさの相関、声の有無での開きの差
    opening = np.sum([np.array(vowels[v]) for v in VOWELS], axis=0)
    kernel = np.hanning(7)
    level = np.convolve(raw, kernel / kernel.sum(), "same")[a_frame:b_frame]
    print(f"相関 {np.corrcoef(opening, level)[0, 1]:.3f}")
    print(f"声あり(大きさ>0.3)の開きの平均 {opening[level > 0.3].mean():.3f}、声なし(<0.05)の平均 {opening[level < 0.05].mean():.3f}(声なし {int((level < 0.05).sum())} コマ)")


if __name__ == "__main__":
    main()
