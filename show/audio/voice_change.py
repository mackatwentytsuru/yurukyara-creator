"""歌声を ElevenLabs の Voice Changer(speech-to-speech)で別の声(既定は Yui)に変える。
**まだ呼んでいない**(本物の曲の歌声ができてから)。--go を付けない限り、見積もりを出すだけで API は呼ばない。
料金は音声の長さだけ(公式: 1 分 = 1000 文字ぶん)。台帳(ledger.json。show_tts と同じ形)に
{"kind": "voice_change", "sec_audio": 秒, "chars": 文字換算} を足し、次の 2 つを守る。
  - Voice Changer に使う音声の合計 8 秒まで
  - 文字換算を含めた台帳の合計 400 まで
401/403(鍵が読み上げの権限だけのとき)が出たら、1 回でやめる。鍵は環境変数 ELEVENLABS_API_KEY から読み、表示しない。
使い方: python voice_change.py --in 歌声.wav --out 変換後.mp3 --ledger ledger.json [--go]
"""
import argparse, json, math, os, pathlib, sys
import requests
import soundfile as sf

VOICE = "fUjY9K2nAIwlALOwSiwc"
MODEL = "eleven_multilingual_sts_v2"
MAX_SEC = 8.0
LIMIT = 400


def chars_for(sec):
    return math.ceil(sec * 1000 / 60)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ledger", default=os.environ.get("TTS_LEDGER"))
    ap.add_argument("--voice", default=VOICE)
    ap.add_argument("--go", action="store_true", help="これを付けたときだけ API を呼ぶ")
    a = ap.parse_args()
    info = sf.info(a.src)
    sec = info.frames / info.samplerate
    lp = pathlib.Path(a.ledger)
    ledger = json.loads(lp.read_text(encoding="utf-8")) if lp.exists() else []
    used_sec = sum(r.get("sec_audio", 0.0) for r in ledger if r.get("kind") == "voice_change")
    used_chars = sum(r["chars"] for r in ledger)
    need = chars_for(sec)
    print(f"音声 {sec:.2f} 秒 → 文字換算 {need}。Voice Changer 使用済み {used_sec:.2f} 秒 / {MAX_SEC}、台帳 {used_chars} / {LIMIT}")
    if used_sec + sec > MAX_SEC or used_chars + need > LIMIT:
        sys.exit("上限超えのため呼ばない")
    if not a.go:
        print("見積もりだけ(--go が無いので呼ばない)")
        return
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("環境変数 ELEVENLABS_API_KEY が無い")
    with open(a.src, "rb") as f:
        r = requests.post(f"https://api.elevenlabs.io/v1/speech-to-speech/{a.voice}?output_format=mp3_44100_128",
                          headers={"xi-api-key": key}, data={"model_id": MODEL},
                          files={"audio": (os.path.basename(a.src), f)}, timeout=300)
    ledger.append({"kind": "voice_change", "out": os.path.basename(a.out), "sec_audio": round(sec, 2),
                   "chars": need, "text": "(voice changer)", "status": r.status_code})
    lp.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")  # 失敗も数える
    if r.status_code in (401, 403):
        sys.exit(f"HTTP {r.status_code}: 権限なし。1 回でやめる。報告する")
    if r.status_code != 200:
        sys.exit(f"HTTP {r.status_code}: {r.text[:300]}")
    pathlib.Path(a.out).write_bytes(r.content)
    print("ok", a.out)


if __name__ == "__main__":
    main()
