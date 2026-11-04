"""入口の LED の UE の人型に、文字の質問で答えさせて口を動かす(声は出さない)。
  質問 → 会話側のサーバー POST /api/chat(interview: true。頭脳は会話側の設定のまま)→ 返事の 1 文ずつ
  → 手元の日本語の声(Windows の System.Speech。kiosk/tools/ue_link/haruka_wav.ps1)で WAV にする(鳴らさない。ファイルだけ)
  → 音の大きさ(33 ms ごと)を 0〜1 の口の開きにして、実時間で UE へ UDP {"mouth":値} を送る。
python kiosk/ue/entrance_talk.py --server http://127.0.0.1:8811 --log talk.jsonl "質問 1" "質問 2" ...
記録(1 行の JSON): 質問・返事の文・頭脳の最初の文までの時間・口を送り始めた時刻(質問からの秒)・字幕の時刻(動画の合成用)。
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "entrance_config.json").read_text(encoding="utf-8"))
HARUKA = HERE.parent / "tools" / "ue_link" / "haruka_wav.ps1"
STEP = 1 / 30


def ask(server: str, text: str, history: list) -> tuple[list[str], float | None, dict | None]:
    body = json.dumps({"text": text, "history": history[-12:], "interview": True}).encode("utf-8")
    req = urllib.request.Request(server + "/api/chat", data=body, headers={"content-type": "application/json"})
    t0 = time.time()
    says, first, usage = [], None, None
    with urllib.request.urlopen(req, timeout=60) as r:
        for raw in r:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data: "):
                continue
            try:
                ev = json.loads(line[6:])
            except ValueError:
                continue
            if ev.get("type") == "say" and ev.get("text"):
                says.append(ev["text"])
                first = first or time.time() - t0
            elif ev.get("type") == "meta" and ev.get("usage"):
                usage = ev["usage"]
            elif ev.get("type") == "error":
                raise RuntimeError(ev.get("message"))
    return says, first, usage


def to_wav(text: str, out: Path) -> None:
    tf = out.with_suffix(".txt")
    tf.write_text(text, encoding="utf-8")
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HARUKA), "-TextFile", str(tf), "-Out", str(out)],
                   check=True, capture_output=True, stdin=subprocess.DEVNULL)


def mouth_curve(path: Path) -> list[float]:
    """音の大きさ → 口の開き(0〜1)。33 ms ごと。静かな所は閉じる"""
    with wave.open(str(path)) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    n = int(sr * STEP)
    rms = np.array([np.sqrt(np.mean(x[i:i + n] ** 2)) for i in range(0, max(len(x) - n, 1), n)])
    if not len(rms):
        return []
    top = np.percentile(rms, 95) or 1.0
    v = np.clip(rms / top, 0, 1) ** 0.7
    v[rms < top * 0.08] = 0.0
    return [round(float(a), 3) for a in v]


def play(sock, addr, curve: list[float]) -> None:
    t0 = time.perf_counter()
    for i, a in enumerate(curve):
        sock.sendto(json.dumps({"mouth": a}).encode(), addr)
        wait = t0 + (i + 1) * STEP - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
    sock.sendto(b'{"mouth":0}', addr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("questions", nargs="+")
    ap.add_argument("--server", default="http://127.0.0.1:8787")
    ap.add_argument("--ue", default=f"{CFG['udp']['host']}:{CFG['udp']['port']}")
    ap.add_argument("--log", default="entrance_talk.jsonl")
    ap.add_argument("--gap", type=float, default=2.5, help="往復の間の秒")
    ap.add_argument("--start-at", type=float, default=0.0, help="字幕の時刻の基準(unix 秒)。0 なら最初の質問")
    a = ap.parse_args()
    host, port = a.ue.rsplit(":", 1)
    addr = (host, int(port))
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tmp = Path(tempfile.mkdtemp(prefix="entrance_talk_"))
    history: list = []
    base = a.start_at or time.time()
    with open(a.log, "a", encoding="utf-8") as log:
        for qi, q in enumerate(a.questions):
            t_q = time.time()
            says, first, usage = ask(a.server, q, history)
            t_mouth, subs = None, []
            for si, s in enumerate(says):
                wav = tmp / f"q{qi}_{si}.wav"
                to_wav(s, wav)
                curve = mouth_curve(wav)
                t_s = time.time()
                t_mouth = t_mouth or t_s - t_q
                play(sock, addr, curve)
                subs.append({"text": s, "start": round(t_s - base, 2), "end": round(time.time() - base, 2)})
            reply = "".join(says)
            history += [{"role": "user", "content": q}, {"role": "assistant", "content": reply}]
            rec = {"q": q, "q_at": round(t_q - base, 2), "says": says, "brain_first_say_s": round(first, 2) if first else None,
                   "mouth_send_s": round(t_mouth, 2) if t_mouth else None, "subs": subs, "usage": usage, "q_unix": round(t_q, 3)}
            log.write(json.dumps(rec, ensure_ascii=False) + "\n")
            log.flush()
            print(json.dumps(rec, ensure_ascii=False), flush=True)
            time.sleep(a.gap)


if __name__ == "__main__":
    main()
