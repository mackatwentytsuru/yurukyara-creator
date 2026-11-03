"""受け手の --split-takes の確かめ: 2 回つないで、take_001・take_002 に分かれ、summary.json が読めること。

  python place/shootlog/take_split_selftest.py
"""
import json
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = 19100
HDR = struct.Struct(">4sIIiddHHB")


def send_frames(n, seq0=1):
    s = socket.create_connection(("127.0.0.1", PORT), timeout=5)
    for i in range(n):
        payload = b"\x00\x00\x00\x01" + bytes(200)
        floats = struct.pack(">20f", *([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] + [3000, 3000, 1920, 1080]))
        s.sendall(HDR.pack(b"HEV1", len(payload), seq0 + i, -1, 100.0 + i / 30, time.time() * 1000, 1920, 1080, 6) + floats + payload)
        time.sleep(0.01)
    time.sleep(0.2)
    s.close()
    time.sleep(0.5)


def main():
    with tempfile.TemporaryDirectory() as td:
        p = subprocess.Popen([sys.executable, str(HERE / "pc_stream_receiver.py"), "--out", td, "--port", str(PORT), "--seconds", "8", "--split-takes"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        send_frames(12)
        send_frames(7)
        p.wait(timeout=30)
        t1 = json.loads((Path(td) / "take_001" / "summary.json").read_text(encoding="utf-8"))
        t2 = json.loads((Path(td) / "take_002" / "summary.json").read_text(encoding="utf-8"))
        ok = t1["frames"] == 12 and t2["frames"] == 7
        print("take_001", t1["frames"], "take_002", t2["frames"], "合格" if ok else "不合格")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
