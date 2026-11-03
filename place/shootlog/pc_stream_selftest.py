"""pc_stream_receiver.py の確かめ。端末の代わりに、アプリと同じ形のパケットを送る(合成の JPEG・姿勢)。

  python place/shootlog/pc_stream_selftest.py
受け手が、コマ数・欠け・姿勢・録画のコマ番号を正しく読み、ffmpeg で動画にできるかを見る。実機の確かめではない。
"""
import json
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
HEADER = struct.Struct(">4sIIiddHHB")
out = Path(tempfile.mkdtemp(prefix="pcstream_"))
port = 19100
proc = subprocess.Popen([sys.executable, str(HERE / "pc_stream_receiver.py"), "--out", str(out), "--port", str(port), "--seconds", "6"],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(1.5)
s = socket.create_connection(("127.0.0.1", port))
OFFSET = 5000.0   # 端末の時計は PC より 5 秒進んでいる、という想定


def pong_thread():
    while True:
        try:
            b = b""
            while len(b) < 16:
                c = s.recv(16 - len(b))
                if not c:
                    return
                b += c
        except OSError:
            return
        _, echo, idx = struct.unpack(">4sdI", b)
        s.sendall(struct.pack(">4sddI", b"PON1", echo, time.time() * 1000 + OFFSET, idx))


threading.Thread(target=pong_thread, daemon=True).start()
N = 60
skip = {17, 18}   # わざと欠けさせる
for i in range(N):
    if i in skip:
        time.sleep(1 / 15)
        continue
    img = np.full((540, 960, 3), 30, np.uint8)
    cv2.putText(img, str(i), (100, 300), cv2.FONT_HERSHEY_SIMPLEX, 6, (255, 255, 255), 10)
    jpeg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 50])[1].tobytes()
    T = list(np.eye(4).T.reshape(-1))
    T[12] = i * 0.01
    K = [2800.0, 2800.0, 1920.0, 1080.0]
    rec_frame = i - 20 if i >= 20 else -1
    pkt = HEADER.pack(b"PCF1", len(jpeg), i + 1, rec_frame, 1000.0 + i / 15, time.time() * 1000 + OFFSET - 20, 960, 540, (1 if rec_frame >= 0 else 0) | 2)
    pkt += struct.pack(">20f", *T, *K) + jpeg
    s.sendall(pkt)
    time.sleep(1 / 15)
s.close()
text = proc.communicate(timeout=30)[0]
summ = json.loads((out / "summary.json").read_text(encoding="utf-8"))
rows = [json.loads(line) for line in (out / "index.jsonl").read_text(encoding="utf-8").splitlines()]
ok = (summ["frames"] == N - len(skip) and summ["seq_missing"] == len(skip) and rows[30]["rec_frame"] == rows[30]["seq"] - 1 - 20
      and abs(rows[10]["T"][12] - (rows[10]["seq"] - 1) * 0.01) < 1e-5 and rows[0]["K"][0] == 2800.0)
mp4 = out / "check.mp4"
r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "mjpeg", "-framerate", "15", "-i", str(out / "stream.mjpg"), "-pix_fmt", "yuv420p", str(mp4)], capture_output=True, text=True)
frames = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(mp4)], capture_output=True, text=True).stdout.strip()
print(json.dumps(summ, ensure_ascii=False))
print("ffmpeg の動画のコマ数:", frames)
ok = ok and frames == str(N - len(skip))
clock = summ.get("clock") or {}
corr = summ.get("latency_corrected_ms") or {}
print("時計のずれ(想定 5000):", clock.get("offset_ms"), "補正した遅れの中央(想定 20 ms 前後):", corr.get("median"))
ok = ok and abs((clock.get("offset_ms") or 0) - OFFSET) < 50 and abs((corr.get("median") or 999) - 20) < 40
print("合格" if ok else "不合格")
sys.exit(0 if ok else 1)
