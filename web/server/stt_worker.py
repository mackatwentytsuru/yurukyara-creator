"""聞き取りの係。faster-whisper を読み込んだまま待ち、1 行ずつ WAV のパスを受けて、文字を 1 行の JSON で返す。

stt.mjs が起動する。標準入力が閉じたら終わる。1 行 = WAV のパス、または「パス<タブ>手がかりの言葉」(話しかけているキャラの名前。聞き違いを減らす)、または「パス<タブ>手がかり<タブ>聞く言葉」(auto・ja・en・zh・ko。多言語の時だけ。ja 以外は手がかりを使わない)。環境変数: STT_MODEL(既定 small)・STT_DEVICE(cpu)・STT_THREADS(4)・STT_LANG(ja)。
"""
import json
import os
import sys
import time

from faster_whisper import WhisperModel

# 声でない区間を捨てる基準。no_speech_prob だけで切ると、きれいな声(0.67 の実例)まで捨てる
NO_SPEECH_LIMIT = 0.6
LOW_CONFIDENCE = -1.0
REPEATED = 2.4  # 同じ音の繰り返し(雑音で出る「ぽっぽっぽ…」)は、圧縮率が高い


def is_speech(s):
    if s.compression_ratio > REPEATED:
        return False
    return not (s.no_speech_prob > NO_SPEECH_LIMIT and s.avg_logprob < LOW_CONFIDENCE)


def hint_options(hint):
    """キャラの名前を、聞き取りの手がかりにする(「ノリー」→「乗り」「おのり」の聞き違いを減らす)。名前が無ければ何も足さない"""
    if not hint:
        return {}
    return {"initial_prompt": f"{hint}さん。{hint}。", "hotwords": hint}


SPOKEN_LANGS = ("ja", "en", "zh", "ko")


def language_for(lang):
    """聞く言葉を、faster-whisper の language にする。auto は None(自動で見分ける)。無い・知らない値は、今までの STT_LANG(既定 ja)"""
    if lang == "auto":
        return None
    if lang in SPOKEN_LANGS:
        return lang
    return os.environ.get("STT_LANG", "ja")


def is_prompt_echo(text, hint):
    """無音や雑音で、手がかりの言葉だけを返してしまった時は、聞き取れなかったことにする"""
    if not hint:
        return False
    rest = text.replace(hint, "").replace("さん", "")
    return not any(ch.isalnum() for ch in rest)


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    device = os.environ.get("STT_DEVICE", "cpu")
    model = WhisperModel(os.environ.get("STT_MODEL", "small"), device=device,
                         compute_type="int8" if device == "cpu" else "float16",
                         cpu_threads=int(os.environ.get("STT_THREADS", "4")))
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        parts = line.rstrip("\r\n").split("\t")
        path = parts[0].strip()
        hint = parts[1].strip() if len(parts) > 1 else ""
        lang = parts[2].strip() if len(parts) > 2 else ""  # 聞く言葉(auto・ja・en・zh・ko)。無い時は今までの STT_LANG
        if not path:
            continue
        t0 = time.time()
        try:
            language = language_for(lang)
            # 日本語以外(auto も)では、キャラの名前の手がかり(日本語)を使わない
            if lang not in ("", "ja"):
                hint = ""
            hints = hint_options(hint)
            # temperature=0 で、聞き取れない音でのやり直しを止める(2.8 秒の音に 45 秒かかった実例)
            kw = dict(language=language, beam_size=1, condition_on_previous_text=False, temperature=0.0)
            try:
                segments, _ = model.transcribe(path, **kw, **hints)
            except TypeError:  # 古い faster-whisper(hotwords が無い版)は、initial_prompt だけで聞く
                segments, _ = model.transcribe(path, **kw, **{k: v for k, v in hints.items() if k == "initial_prompt"})
            text = "".join(s.text for s in segments if is_speech(s)).strip()
            if is_prompt_echo(text, hint):
                text = ""
            print(json.dumps({"text": text, "ms": round((time.time() - t0) * 1000)}, ensure_ascii=False), flush=True)
        except Exception as e:  # 1 回の失敗で係を止めない(次の区間は聞ける)
            print(json.dumps({"error": str(e)[:200]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
