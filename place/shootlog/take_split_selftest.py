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
    # 応答(RCV1)を待つ
    s.settimeout(3)
    buf = b""
    frames = -1
    end = time.time() + 2.5
    while time.time() < end:
        try:
            buf += s.recv(4096)
        except socket.timeout:
            break
        while len(buf) >= 16:
            m, buf = buf[:16], buf[16:]
            if m[:4] == b"RCV1":
                frames = struct.unpack(">I", m[4:8])[0]
        if frames == n:
            break
    s.close()
    time.sleep(0.5)
    return frames


def main():
    with tempfile.TemporaryDirectory() as td:
        p = subprocess.Popen([sys.executable, str(HERE / "pc_stream_receiver.py"), "--out", td, "--port", str(PORT), "--seconds", "12", "--split-takes"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        # つなぎの試し: テイクを作らずに RCV1 が返る
        pr = socket.create_connection(("127.0.0.1", PORT), timeout=5)
        pr.sendall(b"PRB1")
        ans = pr.recv(16)
        pr.close()
        probe_ok = ans[:4] == b"RCV1" and len(ans) == 16
        print("つなぎの試し", "合格" if probe_ok else "不合格", "空き GB", struct.unpack(">I", ans[12:16])[0] if probe_ok else None)
        acks = send_frames(12)
        send_frames(7)
        p.wait(timeout=30)
        t1 = json.loads((Path(td) / "take_001" / "summary.json").read_text(encoding="utf-8"))
        t2 = json.loads((Path(td) / "take_002" / "summary.json").read_text(encoding="utf-8"))
        ok = t1["frames"] == 12 and t2["frames"] == 7 and probe_ok and acks == 12
        print("take_001", t1["frames"], "take_002", t2["frames"], "応答のコマ数", acks, "合格" if ok else "不合格")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
