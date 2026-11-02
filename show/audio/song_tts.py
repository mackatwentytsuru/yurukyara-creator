"""ElevenLabs TTS を文字数の上限つきで呼ぶ。鍵は環境変数 ELEVENLABS_API_KEY から読み、表示しない。
使い方: python song_tts.py <out.mp3> <text> [--settings JSON]
台帳(ledger.json)に文字数と秒数を足し、合計が上限を超える呼び出しはしない。
"""
import json, os, sys, time, pathlib
import requests

VOICE = "fUjY9K2nAIwlALOwSiwc"
MODEL = "eleven_v4_turbo"
LIMIT = 400
LEDGER = pathlib.Path(os.environ.get("TTS_LEDGER", "ledger.json"))


def main():
    out, text = sys.argv[1], sys.argv[2]
    settings = None
    if "--settings" in sys.argv:
        settings = json.loads(sys.argv[sys.argv.index("--settings") + 1])
    ledger = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else []
    used = sum(r["chars"] for r in ledger)
    n = len(text)
    if used + n > LIMIT:
        sys.exit(f"上限超え: 使用済み {used} + 今回 {n} > {LIMIT}")
    body = {"text": text, "model_id": MODEL}
    if settings:
        body["voice_settings"] = settings
    t0 = time.time()
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128",
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "Content-Type": "application/json"},
        json=body, timeout=120)
    sec = round(time.time() - t0, 1)
    # 失敗しても送った分は数える(安全側)
    ledger.append({"out": os.path.basename(out), "chars": n, "text": text, "sec": sec, "status": r.status_code})
    LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
    if r.status_code != 200:
        sys.exit(f"HTTP {r.status_code}: {r.text[:300]}")
    pathlib.Path(out).write_bytes(r.content)
    print(f"ok {out} chars={n} total={used+n} sec={sec}")


main()
