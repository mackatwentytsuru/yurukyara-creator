"""視線の経路の通し試験(カメラなし)。録画の代わりに、答えの分かる「動く顔の映像」を作って流し、
  映像(RTSP の送り直し) → 取り込み → 顔の検出 → 目の位置(LED の座標) → 視線の向き(UDP の JSON)
までを通し、(1) 向きの誤差(度。正解は、作った映像の元になった世界の位置から計算)、(2) 入力から出力までの遅れ、(3) 顔の見つかった割合 を出す。
  python gaze_sim.py --face-image <顔の全体が写る絵> [--seconds 16] [--high-priority] [--out result.json]
限界: 顔の絵は CG の 1 種類(実際の人・暗さ・逆光ではない)。カメラの撮像・無線の遅れは入らない。外部パラメータは仮の値(gaze_bridge.Geometry)。
"""
from __future__ import annotations

import argparse
import json
import math
import socket
import statistics
import subprocess
import threading
import time

import cv2
import numpy as np

from detect import FaceDetector, FaceTracker
from gaze_bridge import GazeBridge, Geometry, gaze_angles, world_to_pixel
from latency import CODE_BITS, DARK, FPS, crop_face, read_seq, stamp_seq
from stream import ABOVE_NORMAL, FrameReader, raise_self_priority


def path_point(t: float, depth: tuple = (1.0, 3.2), period: float = 30.0) -> np.ndarray:
    """客の目の世界の位置(m)の経路: 左右に ±0.7 m、奥行きを depth の間でゆっくり往復(period 秒で 1 往復)、目の高さ 1.5〜1.75 m"""
    z = (depth[0] + depth[1]) / 2 + (depth[1] - depth[0]) / 2 * -math.cos(2 * math.pi * t / period)
    return np.array([0.7 * math.sin(t * 0.5), 1.62 + 0.12 * math.sin(t * 0.37 + 1.0), z])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--face-image", required=True)
    ap.add_argument("--seconds", type=float, default=16)
    ap.add_argument("--geometry", default="")
    ap.add_argument("--size", default="1920x1080", help="映像の大きさ(実機の stream1 は 1920x1080、stream2 は 1280x720)")
    ap.add_argument("--high-priority", action="store_true")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    if a.high_priority:
        raise_self_priority()
    g = Geometry.load(a.geometry)
    W, H = (int(x) for x in a.size.split("x"))
    g.width, g.height = W, H  # 試験の映像の大きさ
    base = FaceDetector()
    det = FaceTracker(base)
    face = crop_face(base, a.face_image)
    fd = base.detect(face)
    if not fd["found"]:
        raise SystemExit("顔の絵から目が見つかりません")
    face_ipd = fd["ipd_px"]
    eye_in_face = (fd["eye_x"] * face.shape[1], fd["eye_y"] * face.shape[0])

    port, usock = 18555, socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    usock.bind(("127.0.0.1", 19101))
    usock.settimeout(0.2)
    url = f"rtsp://127.0.0.1:{port}/live"
    reader = FrameReader(url, W, H, extra_in_args=["-rtsp_flags", "listen"], high_priority=a.high_priority)
    time.sleep(1.0)
    sender = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0", "-g", str(FPS), "-pix_fmt", "yuv420p",
         "-flush_packets", "1", "-muxdelay", "0", "-f", "rtsp", "-rtsp_transport", "tcp", url],
        stdin=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=ABOVE_NORMAL if a.high_priority else 0,
    )
    seq_sent: dict[int, float] = {}
    truth: dict[int, np.ndarray] = {}
    stop = threading.Event()
    n_frames = int(a.seconds * FPS)

    def send_loop():
        t0 = time.perf_counter() + 0.5
        for i in range(n_frames):
            target = t0 + i / FPS
            now = time.perf_counter()
            if now < target:
                time.sleep(target - now)
            p = path_point(i / FPS, period=a.seconds * 1.0)
            u, v, ipd_px = world_to_pixel(g, p)
            scale = ipd_px / face_ipd
            fw, fh = max(8, int(face.shape[1] * scale)), max(8, int(face.shape[0] * scale))
            frame = np.full((H, W, 3), DARK, np.uint8)
            ff = cv2.resize(face, (fw, fh), interpolation=cv2.INTER_AREA)
            x0, y0 = int(u - eye_in_face[0] * scale), int(v - eye_in_face[1] * scale)
            sx0, sy0 = max(0, -x0), max(0, -y0)
            x0c, y0c = max(0, x0), max(0, y0)
            x1c, y1c = min(W, x0 + fw), min(H, y0 + fh)
            if x1c > x0c and y1c > y0c:
                frame[y0c:y1c, x0c:x1c] = ff[sy0:sy0 + (y1c - y0c), sx0:sx0 + (x1c - x0c)]
            stamp_seq(frame, i % (1 << CODE_BITS))
            key = i % (1 << CODE_BITS)
            truth[key] = p
            seq_sent[key] = time.perf_counter()
            try:
                sender.stdin.write(frame.tobytes())
            except (BrokenPipeError, OSError):
                break
        time.sleep(0.6)
        stop.set()

    threading.Thread(target=send_loop, daemon=True).start()
    bridge = GazeBridge(g=g, sink=("127.0.0.1", 19101), packet="full")
    rows, last = [], 0
    udp_t: list[tuple[float, dict]] = []

    def drain():
        while True:
            try:
                data, _ = usock.recvfrom(4096)
            except socket.timeout:
                if stop.is_set():
                    return
                continue
            udp_t.append((time.perf_counter(), json.loads(data.decode())))

    rx = threading.Thread(target=drain, daemon=True)
    rx.start()
    frame_keys = []
    while not stop.is_set():
        fr = reader.latest(last)
        if fr is None:
            time.sleep(0.002)
            continue
        last, arrived, frame = fr
        key = read_seq(frame)
        r = det.detect(frame)
        now = time.perf_counter()
        msg = bridge.update(now, r, age_ms=(now - arrived) * 1000)
        rows.append((key, now, r, msg))
        frame_keys.append(key)
    rx.join(timeout=2)
    reader.close()
    sender.terminate()
    # 評価: 向きの誤差(度)と、送ってから UDP に出るまでの遅れ
    yaw_err, pitch_err, lags, found = [], [], [], 0
    udp_by_t = {round(m["t"], 4): t_rx for t_rx, m in udp_t}
    for key, now, r, msg in rows:
        if not msg["found"] or key not in truth:
            continue
        # EMA で遅れて追従するので、誤差は「そのコマの正解」に対して測る(平滑化の遅れ込みの実際の誤差)
        ty, tp = gaze_angles(g.eye_pos, truth[key])
        yaw_err.append(abs(msg["yaw_deg"] - ty))
        pitch_err.append(abs(msg["pitch_deg"] - tp))
        found += 1
        t_rx = udp_by_t.get(round(msg["t"], 4))
        if t_rx and key in seq_sent:
            lags.append((t_rx - seq_sent[key]) * 1000)
    total = len(rows)
    bins = {}
    for key, now, r, msg in rows:
        if key in truth:
            b = f"{math.floor(truth[key][2] * 2) / 2:.1f}-{math.floor(truth[key][2] * 2) / 2 + 0.5:.1f}m"
            c = bins.setdefault(b, [0, 0])
            c[1] += 1
            c[0] += bool(r["found"])
    q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(len(xs) * p))] if xs else None  # noqa: E731
    res = {
        "frames": total,
        "face_found_rate": round(sum(1 for _, _, r, _ in rows if r["found"]) / total, 3) if total else None,
        "found_rate_by_distance": {k: f"{v[0]}/{v[1]}" for k, v in sorted(bins.items())},
        "yaw_err_deg": {"median": round(statistics.median(yaw_err), 2), "p90": round(q(yaw_err, 0.9), 2)} if yaw_err else None,
        "pitch_err_deg": {"median": round(statistics.median(pitch_err), 2), "p90": round(q(pitch_err, 0.9), 2)} if pitch_err else None,
        "input_to_gaze_message_ms": {"median": round(statistics.median(lags)), "p90": round(q(lags, 0.9))} if lags else None,
        "note": "合成の映像(CG の顔 1 種類)・外部パラメータは仮・カメラの遅れなし。誤差は、平滑化(ema)の遅れを含む",
    }
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.out:
        open(a.out, "w", encoding="utf-8").write(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
