"""受け手(pc_stream_receiver.py)が、端末なしで受けて書けるかの確認。標準ライブラリだけ(どの PC でも動く)。

  python rx_probe.py --host 127.0.0.1 --port 9100 [--frames 90]
  python rx_probe.py --host <受け手の IP> --seconds 120 --payload-kb 75      # 負荷の試験: 本番と同じ重さ(18 Mbps なら 1 コマ 75 KB・30 fps)で、その秒数だけ送る
端末の送りと同じ形の電文(HEV1 の偽の映像・CAL1 の校正)を送り、受け手の応答(RCV1)で「書いたコマ数」が送った数に追いつくかを見る。
受け手を動かす PC を決めたときと、現地で受け手を起動したあとの「つなぎの確認」に使う(本物の端末の前に、受け手の側だけを確かめる)。
終了コード: 0 = 全部書けた / 1 = 書けなかった・つながらない。
"""
from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time

HEADER = struct.Struct(">4sIIiddHHB")
FPS = 30.0


def frame_packet(i, payload_bytes=64):
    payload = b"\x00\x00\x00\x01" + bytes(payload_bytes)
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    floats = struct.pack(">20f", *(identity + [3065.0, 3065.0, 1898.0, 1054.0]))
    flags = 2 | (4 if i == 0 else 0)
    return HEADER.pack(b"HEV1", len(payload), i + 1, -1, 1000.0 + i / FPS, time.time() * 1000, 1920, 1080, flags) + floats + payload


def cal_packet():
    body = json.dumps({"arSessionId": "PROBE", "rays": None, "accepted": False, "latestDots": 0}).encode("utf-8")
    return b"CAL1" + struct.pack(">I", len(body)) + body


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9100)
    ap.add_argument("--frames", type=int, default=90)
    ap.add_argument("--seconds", type=float, default=0.0, help="指定すると、この秒数ぶんのコマを実時間で送る")
    ap.add_argument("--payload-kb", type=float, default=0.0, help="1 コマの中身の大きさ(KB)。0 なら小さい偽の中身")
    a = ap.parse_args()
    try:
        s = socket.create_connection((a.host, a.port), timeout=5)
    except OSError as e:
        print(f"つながらない: {a.host}:{a.port}({e})。受け手が動いているか、防火壁で止まっていないかを見る")
        return 1
    if a.seconds > 0:
        a.frames = int(a.seconds * FPS)
    size = int(a.payload_kb * 1024) if a.payload_kb > 0 else 64
    s.sendall(cal_packet())
    t0 = time.time()
    for i in range(a.frames):
        s.sendall(frame_packet(i, size))
        wait = t0 + (i + 1) / FPS - time.time()
        if wait > 0:
            time.sleep(wait)
    sent_sec = time.time() - t0
    s.settimeout(1.0)
    buf, acked, end = b"", -1, time.time() + 10
    while time.time() < end and acked < a.frames - 2:
        try:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
        except socket.timeout:
            continue
        while len(buf) >= 16:
            m, buf = buf[:16], buf[16:]
            if m[:4] == b"RCV1":
                acked = struct.unpack(">I", m[4:8])[0]
    s.close()
    ok = acked >= a.frames - 2
    mbps = a.frames * (size + 100) * 8 / max(0.001, sent_sec) / 1e6
    print(f"送った {a.frames}・受け手が書いたと答えた {acked}({sent_sec:.1f} 秒、約 {mbps:.1f} Mbps) → {'書けた' if ok else '書けていない'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
