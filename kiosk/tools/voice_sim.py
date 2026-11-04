"""声 → 頭 → 声と口の通し試験(録音の声を入力にして、段ごとの時間を測る)。標準ライブラリだけ。別の機械(店の PC など)から、会話のサーバーを相手に動かせる。
  python voice_sim.py --server http://<アドレス>:<ポート> --wav q1.wav q2.wav ... [--interview] [--out result.json]
1 つの wav = 1 往復。順に、(1) /api/stt で文字にする (2) /api/chat で頭脳の最初の 1 文を受ける (3) /api/tts で最初の音を受ける、までの時間を出す。
  聞き取りの終わりの検出(話し終わりを待つ時間。実機では 300〜500 ms ほど)と、スピーカーから実際に鳴るまでは含まれない。
  「口が動き出す」は、読み上げの音(16 bit・24 kHz)の最初の「音のある」塊が届いた時刻で近似する(実際の口は、その音の大きさから作られる)。
  聞き取り・頭脳・読み上げは、サーバー側で動く。ネットワークの往復が入る(店の PC → サーバー)。
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.request


def post(url: str, data: bytes, ctype: str, timeout: float = 90):
    req = urllib.request.Request(url, data=data, headers={"Content-Type": ctype})
    return urllib.request.urlopen(req, timeout=timeout)


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read())


def rms16(b: bytes) -> float:
    n = len(b) // 2
    if not n:
        return 0.0
    s = 0
    for i in range(0, n * 2, 2):
        v = int.from_bytes(b[i:i + 2], "little", signed=True)
        s += v * v
    return (s / n) ** 0.5 / 32768


def one_turn(server: str, wav: bytes, history: list, cfg: dict, persona: str, interview: bool) -> dict:
    out = {}
    t0 = time.perf_counter()
    with post(server + "/api/stt", wav, "audio/wav") as r:
        stt = json.loads(r.read())
    t1 = time.perf_counter()
    text = (stt.get("text") or "").strip()
    out.update(heard=text, stt_ms=round((t1 - t0) * 1000))
    if not text:
        out["error"] = "聞き取りが空でした"
        return out
    body = {
        "history": history[-6:], "text": text, "trigger": None, "scene": cfg.get("scene", ""),
        "character": {"name": cfg.get("characterName", "見本のキャラ"), "persona": persona},
        "place": {"name": "店", "info": cfg.get("placeInfo", ""), "landmarks": []},
        "expressions": ["neutral", "happy", "sad", "surprised", "troubled"], "motions": ["nod", "bow", "wave", "think", "tilt", "shake", "shrug", "point"],
        "useShop": True, "interview": interview,
    }
    says, first_say_at = [], None
    with post(server + "/api/chat", json.dumps(body).encode(), "application/json") as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            ev = json.loads(line[5:])
            if ev.get("type") == "say":
                if first_say_at is None:
                    first_say_at = time.perf_counter()
                says.append(ev["text"])
            elif ev.get("type") == "error":
                out["error"] = ev.get("message")
    if not says:
        return out
    out.update(answer="".join(says), sentences=len(says), chat_first_say_ms=round((first_say_at - t1) * 1000))
    t2 = time.perf_counter()
    first_byte = first_voiced = None
    nbytes = 0
    with post(server + "/api/tts", json.dumps({"text": says[0]}).encode(), "application/json") as r:
        while True:
            chunk = r.read(4800)  # 100 ms 分(24 kHz・16 bit)
            if not chunk:
                break
            nbytes += len(chunk)
            now = time.perf_counter()
            if first_byte is None:
                first_byte = now
            if first_voiced is None and rms16(chunk) > 0.01:
                first_voiced = now
    if first_byte is not None:
        out.update(tts_first_byte_ms=round((first_byte - t2) * 1000), voice_bytes=nbytes)
        out["tts_first_voiced_ms"] = round((first_voiced - t2) * 1000) if first_voiced else None
        end = first_voiced or first_byte
        out["voice_in_to_first_sound_ms"] = round((end - t0) * 1000)
    history += [{"role": "user", "content": text}, {"role": "assistant", "content": out["answer"]}]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", required=True)
    ap.add_argument("--wav", nargs="+", required=True)
    ap.add_argument("--interview", action="store_true")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    server = a.server.rstrip("/")
    cfg = get_json(server + "/kiosk/config.json")
    cid = cfg.get("characterId", "sample_vrm")
    with urllib.request.urlopen(f"{server}/characters/{cid}/persona.md", timeout=20) as r:
        persona = r.read().decode("utf-8")
    try:  # 最初の 1 回が、モデルの読み込みで遅くならないよう、先に用意してもらう(実機の画面も、同じことをしている)
        post(server + "/api/stt/warm", b"{}", "application/json").read()
    except Exception:  # noqa: BLE001
        pass
    history: list = []
    rows = []
    for p in a.wav:
        with open(p, "rb") as f:
            r = one_turn(server, f.read(), history, cfg, persona, a.interview)
        r["file"] = p.replace("\\", "/").split("/")[-1]
        rows.append(r)
        print(json.dumps(r, ensure_ascii=True))  # 標準出力は、機械によって文字コードが違うので、記号にしておく(日本語は out の JSON で読む)
    tot = [r["voice_in_to_first_sound_ms"] for r in rows if r.get("voice_in_to_first_sound_ms")]
    summary = {"turns": len(rows), "ok": len(tot),
               "voice_in_to_first_sound_ms": {"median": round(statistics.median(tot)), "max": max(tot)} if tot else None,
               "stt_ms_median": round(statistics.median(r["stt_ms"] for r in rows if "stt_ms" in r)) if rows else None,
               "chat_first_say_ms_median": round(statistics.median(r["chat_first_say_ms"] for r in rows if "chat_first_say_ms" in r)) if any("chat_first_say_ms" in r for r in rows) else None,
               "tts_first_voiced_ms_median": round(statistics.median(r["tts_first_voiced_ms"] for r in rows if r.get("tts_first_voiced_ms"))) if any(r.get("tts_first_voiced_ms") for r in rows) else None}
    print("SUMMARY", json.dumps(summary, ensure_ascii=True))
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"summary": summary, "rows": rows}, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
