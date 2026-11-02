"""読み上げ(ElevenLabs)をキャッシュと文字数の上限つきで呼ぶ。
- 文 + 声 + モデル + 設定のハッシュ名の wav を cache_dir に置く。同じ文は 2 度頼まない。
- 台帳(ledger.json。song_tts.py と同じ形)に文字数を足し、合計が LIMIT を超える呼び出しはしない。
- 鍵は環境変数 ELEVENLABS_API_KEY から読み、表示しない。
"""
import hashlib, json, os, pathlib, subprocess, time
import requests

LIMIT = 400
OUT_SR = 48000


class TtsBudgetError(RuntimeError):
    pass


def cache_key(text, voice, model, settings):
    raw = json.dumps([text, voice, model, settings], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def _ledger_read(path):
    p = pathlib.Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


def synth(text, voice, model, cache_dir, ledger_path, settings=None, limit=LIMIT):
    """text を読み上げた 48kHz モノの wav のパスを返す。cache にあれば API は呼ばない。"""
    cache = pathlib.Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    key = cache_key(text, voice, model, settings)
    wav = cache / f"{key}.wav"
    if wav.exists():
        return wav, False
    if not ledger_path:
        raise TtsBudgetError("台帳がない: --ledger か環境変数 TTS_LEDGER を指定する(上限の管理に必要)")
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise TtsBudgetError("環境変数 ELEVENLABS_API_KEY が無い")
    ledger = _ledger_read(ledger_path)
    used = sum(r["chars"] for r in ledger)
    if used + len(text) > limit:
        raise TtsBudgetError(f"上限超え: 使用済み {used} + 今回 {len(text)} > {limit}")
    body = {"text": text, "model_id": model}
    if settings:
        body["voice_settings"] = settings
    t0 = time.time()
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        headers={"xi-api-key": api_key, "Content-Type": "application/json"}, json=body, timeout=120)
    sec = round(time.time() - t0, 1)
    # 失敗しても送った分は数える(安全側)。呼んだ直後に台帳へ書く
    ledger.append({"out": f"{key}.wav", "chars": len(text), "text": text, "sec": sec, "status": r.status_code})
    pathlib.Path(ledger_path).write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
    if r.status_code != 200:
        raise TtsBudgetError(f"HTTP {r.status_code}: {r.text[:300]}")
    mp3 = cache / f"{key}.mp3"
    mp3.write_bytes(r.content)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", str(OUT_SR),
                    "-c:a", "pcm_s24le", str(wav)], check=True)
    return wav, True
