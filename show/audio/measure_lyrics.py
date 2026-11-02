"""歌声の wav を faster-whisper で書き起こし、語ごとの秒を json に出す(単独で動く。リポジトリの他の物に依存しない)。
無音の所で出る幻の文字を避けるため、名前=wav@切り出しの秒 の形で歌い出しの手前から読ませる。秒は元の wav の物に直して出す。
使い方: python measure_lyrics.py --out <json> [--prompt-file 歌詞.txt] 名前=vocals.wav@秒 [...]
"""
import argparse, json
from faster_whisper import WhisperModel, decode_audio

WSR = 16000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--prompt-file")
    ap.add_argument("items", nargs="+")
    a = ap.parse_args()
    prompt = open(a.prompt_file, encoding="utf-8").read() if a.prompt_file else None
    try:
        model = WhisperModel(a.model, device="cuda", compute_type="float16")
    except Exception:
        model = WhisperModel(a.model, device="cpu", compute_type="int8")
    res = {}
    for it in a.items:
        name, rest = it.split("=", 1)
        path, _, off = rest.partition("@")
        off = float(off or 0)
        x = decode_audio(path, sampling_rate=WSR)[int(off * WSR):]
        segs, _ = model.transcribe(x, language="ja", word_timestamps=True, vad_filter=False,
                                   condition_on_previous_text=False, initial_prompt=prompt)
        res[name] = [{"start": round(s.start + off, 2), "end": round(s.end + off, 2), "text": s.text,
                      "words": [{"w": w.word, "s": round(w.start + off, 2), "e": round(w.end + off, 2)} for w in (s.words or [])]}
                     for s in segs]
        print(name, len(res[name]), "segments", flush=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
