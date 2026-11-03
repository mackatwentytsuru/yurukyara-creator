#!/usr/bin/env python
"""歌詞の元(表記と読み)と書き起こしの語の秒から、make_sing_curves.py に渡す lyrics.json を作る。
書き起こしの文字と歌詞の文字を突き合わせ、合った文字の秒を目印にする。合わない所は読みの拍数で割り振る。

使い方: make_lyrics_times.py --source <歌詞の元.json> --words <measure_lyrics.py の json> --name <曲の名前> --out <lyrics.json>
歌詞の元: {"lines": [{"section": "pre", "mood": [["sad", 0.2]], "text": "ずっと 夢/ゆめ みて た"}], "accents_after_last": [[秒, 秒, 名前, 重み]]}
text は空白で区切り、「表記/読み」。読みが表記と同じなら /読み は省く。カタカナの読みは、ひらがなで書く。
"""
import argparse
import difflib
import json
import pathlib
import re

SMALL = "ゃゅょぁぃぅぇぉ"
LAST_WORD_HOLD = 1.2  # 最後の語は、次の語が無いので伸ばす秒の上限


def mora_count(reading):
    return max(1, sum(1 for ch in reading if ch not in SMALL))


def parse_lines(source):
    lines = []
    for line in source["lines"]:
        chunks = []
        for token in line["text"].split():
            shown, _, reading = token.partition("/")
            chunks.append({"shown": shown, "reading": reading or shown})
        lines.append({**line, "chunks": chunks})
    return lines


def whisper_chars(segments):
    """書き起こしを 1 文字ずつの (文字, 秒) にする。語の中は等分する。"""
    out = []
    for segment in segments:
        for word in segment["words"]:
            text = re.sub(r"\s", "", word["w"])
            for i, ch in enumerate(text):
                out.append((ch, word["s"] + (word["e"] - word["s"]) * i / max(len(text), 1)))
    return out


def anchors(lines, chars):
    """各語の始めの秒。合わなかった語は None。"""
    shown = [(i, j) for i, line in enumerate(lines) for j, c in enumerate(line["chunks"]) for _ in c["shown"]]
    text_a = "".join(c["shown"] for line in lines for c in line["chunks"])
    text_b = "".join(ch for ch, _ in chars)
    found = {}
    for block in difflib.SequenceMatcher(None, text_a, text_b, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            key = shown[block.a + k]
            found.setdefault(key, chars[block.b + k][1])
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", required=True)
    ap.add_argument("--words", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    source = json.loads(pathlib.Path(a.source).read_text(encoding="utf-8"))
    segments = json.loads(pathlib.Path(a.words).read_text(encoding="utf-8"))[a.name]
    lines = parse_lines(source)
    chars = whisper_chars(segments)
    found = anchors(lines, chars)
    flat = [(i, j, c) for i, line in enumerate(lines) for j, c in enumerate(line["chunks"])]
    times = [found.get((i, j)) for i, j, _ in flat]
    known = [k for k, t in enumerate(times) if t is not None]
    if len(known) < 2:
        raise SystemExit("書き起こしと歌詞がほとんど合わない。歌詞の元か書き起こしを確かめる")
    weights = [mora_count(c["reading"]) for _, _, c in flat]
    # 目印の間を拍数で割り振る。前後の外は目印の間の平均の速さで
    speeds = []
    for a0, a1 in zip(known, known[1:]):
        count = sum(weights[a0:a1])
        speeds.append((times[a1] - times[a0]) / count)
    mora_sec = sorted(speeds)[len(speeds) // 2]
    for a0, a1 in zip(known, known[1:]):
        step = (times[a1] - times[a0]) / sum(weights[a0:a1])
        t = times[a0]
        for k in range(a0, a1):
            times[k] = t
            t += weights[k] * step
    for k in range(known[0] - 1, -1, -1):
        times[k] = times[k + 1] - weights[k] * mora_sec
    for k in range(known[-1] + 1, len(times)):
        times[k] = times[k - 1] + weights[k - 1] * mora_sec
    # 語の順が逆転した所(書き起こしの外れ)をならす
    for k in range(1, len(times)):
        times[k] = max(times[k], times[k - 1] + 0.05)
    ends = times[1:] + [times[-1] + min(LAST_WORD_HOLD, weights[-1] * mora_sec * 3)]
    output = {"_説明": "make_lyrics_times.py が作った。秒は曲の頭から。", "lines": []}
    for k, (i, j, c) in enumerate(flat):
        if j == 0:
            line = lines[i]
            output["lines"].append({"section": line.get("section", ""), "mood": line.get("mood", []), "words": [], **({"out_word": line["out_word"]} if "out_word" in line else {})})
        # 行の間の無音は語に含めない。声の大きさで口は閉じるが、読みの枠は語の長さの上限で切る
        end = min(ends[k], times[k] + weights[k] * mora_sec * 2.5)
        output["lines"][-1]["words"].append([c["reading"], round(times[k], 2), round(end, 2)])
    last_end = output["lines"][-1]["words"][-1][2]
    output["accents"] = [[last_end + s, last_end + e, name, w] for s, e, name, w in source.get("accents_after_last", [])]
    pathlib.Path(a.out).write_text(json.dumps(output, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"語 {len(flat)}、目印 {len(known)}({100 * len(known) // len(flat)}%)、拍の長さの中央値 {mora_sec:.3f} 秒、歌の範囲 {times[0]:.2f}〜{last_end:.2f} 秒")


if __name__ == "__main__":
    main()
