"""会話側のサーバーの視線の受け口(web/server/gazeRelay.mjs の GET /api/gaze/now)を読み、v1 の UDP で UE の入口のレベルへ流す。
床のカメラ → gaze_bridge.py(--with-pixels)→ サーバーの UDP(GAZE_UDP_PORT)→ このファイル → UE(entrance_config.json の udp)。
サーバーを通すのは、校正の画面(kiosk/web/aim.html)の「狙い」と「記録」を、ブラウザ版と同じ手順で UE の人型にも使うため
(狙いが有効な間は、サーバーが狙いの向きを返す)。校正をしないときは、gaze_bridge.py から UE へ直接送ってもよい(形は同じ v1)。
python kiosk/ue/gaze_to_ue.py --server http://127.0.0.1:8811 [--hz 30]
"""
from __future__ import annotations

import argparse
import json
import socket
import time
import urllib.request
from pathlib import Path

CFG = json.loads((Path(__file__).resolve().parent / "entrance_config.json").read_text(encoding="utf-8"))


def to_v1(now: dict, seq: int, stale_ms: float = 1500) -> dict:
    """サーバーの向き → v1。古い向き(受けてから stale_ms より前)は「いない」"""
    present = bool(now.get("present")) and (now.get("ageMs") or 0) <= stale_ms
    if not present:
        return {"v": 1, "present": False, "seq": seq}
    return {"v": 1, "present": True, "az": float(now["az"]), "el": float(now["el"]), "dist": now.get("dist") or 2.0,
            "n": now.get("n") or 1, "facing": now.get("facing") if now.get("facing") is not None else 1, "seq": seq}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://127.0.0.1:8787")
    ap.add_argument("--ue", default=f"{CFG['udp']['host']}:{CFG['udp']['port']}")
    ap.add_argument("--hz", type=float, default=30)
    a = ap.parse_args()
    host, port = a.ue.rsplit(":", 1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    seq = 0
    step = 1 / a.hz
    nxt = time.perf_counter()
    while True:
        try:
            with urllib.request.urlopen(a.server + "/api/gaze/now", timeout=1) as r:
                now = json.loads(r.read().decode("utf-8"))
            seq += 1
            sock.sendto(json.dumps(to_v1(now, seq)).encode(), (host, int(port)))
        except OSError:
            pass
        nxt += step
        time.sleep(max(0.0, nxt - time.perf_counter()))


if __name__ == "__main__":
    main()
