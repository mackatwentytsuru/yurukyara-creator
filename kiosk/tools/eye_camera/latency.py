"""映像の遅れ(入力 → 顔の位置が出るまで)を測る。
  selftest … 偽のカメラ(自分の中で作った映像を、手元の RTSP で送り直す)で、道具そのものと、取り込み・復号・顔の検出の遅れを測る。
             ネットワークの遅れも、本物のカメラの撮像・符号化の遅れも入らない(= 下限)。
  flash    … 本物のカメラの前で画面を白黒に切り替え、切り替えた時刻と、映像の明るさが変わった時刻の差を測る(遅れの合計)。
             カメラに画面を向けて使う。画面の表示の遅れ(画面しだい。10〜30 ms 程度)は含まれる。**実機は未実施**。
  python kiosk/tools/eye_camera/latency.py selftest --face-image <顔のある絵> [--seconds 20]
  python kiosk/tools/eye_camera/latency.py flash --seconds 40          # カメラの設定は camera_config の方法
映像は保存しない。顔の絵は、手元の物を指定する(リポジトリには入れない)。
"""
from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import threading
import time

import cv2
import numpy as np

import camera_config
from detect import FaceDetector
from stream import ABOVE_NORMAL, FrameReader, probe_size, raise_self_priority

W, H, FPS = 1280, 720, 15  # 実機(Tapo C200)の仕様に合わせる: 1080p・最大 15 fps(解像度だけ軽くしている)
DARK, BRIGHT = 40, 235


def lags_from_events(sent: list[float], arrivals: list[tuple[float, float]], threshold: float) -> list[float]:
    """sent の各時刻のあとで、最初に明るさが threshold を超えて届いたコマとの時間差(ms)。届かなければ入れない"""
    out = []
    for ts in sent:
        for t, mean in arrivals:
            if t >= ts and mean > threshold:
                out.append((t - ts) * 1000)
                break
    return out


def face_jump_lags(sent: list[tuple[float, float, float]], samples: list[tuple[float, float]]) -> list[float]:
    """sent=(時刻, 前の位置, 新しい位置)。samples=(顔の位置が出た時刻, 位置)。位置が新しい側の半分を越えた最初の時刻との差(ms)"""
    out = []
    for ts, old, new in sent:
        mid = (old + new) / 2
        for t, cx in samples:
            if t >= ts and ((cx > mid) == (new > old)) and abs(cx - new) < abs(cx - old):
                out.append((t - ts) * 1000)
                break
    return out


def summarize(xs: list[float]) -> dict:
    if not xs:
        return {"n": 0}
    xs = sorted(xs)
    return {"n": len(xs), "median_ms": round(statistics.median(xs)), "p90_ms": round(xs[min(len(xs) - 1, int(len(xs) * 0.9))]), "min_ms": round(xs[0]), "max_ms": round(xs[-1])}


def crop_face(det: FaceDetector, path: str):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    r = det.detect(img)
    if not r["found"]:
        raise SystemExit("指定した絵から顔を見つけられません")
    ih, iw = img.shape[:2]
    cx, cy, fw = r["cx"] * iw, r["cy"] * ih, r["face_w_px"]
    half = fw * 1.4
    x0, x1 = int(max(0, cx - half)), int(min(iw, cx + half))
    y0, y1 = int(max(0, cy - half * 1.2)), int(min(ih, cy + half * 1.2))
    return img[y0:y1, x0:x1].copy()


CODE_BITS, CELL = 12, 40  # コマの番号を、左上の白黒の升(12 桁)で絵の中に書く。受け取った側が読めば、何番目のコマかが分かる


def stamp_seq(frame, seq: int):
    for i in range(CODE_BITS):
        frame[0:CELL, i * CELL:(i + 1) * CELL] = 255 if (seq >> i) & 1 else 0
    return frame


def read_seq(frame) -> int:
    v = 0
    for i in range(CODE_BITS):
        if frame[CELL // 4:3 * CELL // 4, i * CELL + CELL // 4:i * CELL + 3 * CELL // 4].mean() > 127:
            v |= 1 << i
    return v


def selftest(a) -> dict:
    """送るときにコマの番号を絵に書き、受け取ったコマの番号から、そのコマを送った時刻との差を測る。
    差は、取り込み(ffmpeg の復号)・手元の符号化と送受信・取り出しまでの合計。顔の検出が終わった時刻との差も出す。"""
    if a.high_priority:
        raise_self_priority()
    det = FaceDetector(detect_width=a.detect_width)
    face = crop_face(det, a.face_image) if a.face_image else None
    port = 18554
    url = f"rtsp://127.0.0.1:{port}/live"
    arrivals: list[tuple[float, float]] = []  # (到着時刻, 明るさ)(flash 法の検算用)
    seq_arrival: dict[int, float] = {}

    def on_frame(t, f):
        arrivals.append((t, float(f[::16, ::16].mean())))
        seq_arrival[read_seq(f)] = t

    reader = FrameReader(url, W, H, extra_in_args=["-rtsp_flags", "listen"], on_frame=on_frame, high_priority=a.high_priority)
    time.sleep(1.0)
    sender = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0", "-g", str(FPS), "-pix_fmt", "yuv420p",
         "-flush_packets", "1", "-muxdelay", "0", "-f", "rtsp", "-rtsp_transport", "tcp", url],
        stdin=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=ABOVE_NORMAL if a.high_priority else 0,
    )
    seq_sent: dict[int, float] = {}
    sent_flash: list[float] = []
    stop = threading.Event()
    period, flash_len = 4.0, 0.8
    n_frames = int(a.seconds * FPS)

    def make_frame(bright: bool, x: float):
        f = np.full((H, W, 3), BRIGHT if bright else DARK, np.uint8)
        if face is not None:
            fh = int(H * 0.5)
            fw = int(face.shape[1] * fh / face.shape[0])
            ff = cv2.resize(face, (fw, fh), interpolation=cv2.INTER_AREA)
            x0, y0 = int(W * x - fw / 2), int(H * 0.5 - fh / 2)
            f[y0:y0 + fh, x0:x0 + fw] = ff
        return f

    def send_loop():
        t_start = time.perf_counter() + 0.5
        was_bright = False
        for i in range(n_frames):
            target = t_start + i / FPS
            now = time.perf_counter()
            if now < target:
                time.sleep(target - now)
            phase = (i / FPS) % period
            bright = phase < flash_len
            frame = stamp_seq(make_frame(bright, 0.5), i % (1 << CODE_BITS))
            t_send = time.perf_counter()
            try:
                sender.stdin.write(frame.tobytes())
            except (BrokenPipeError, OSError):
                break
            seq_sent[i % (1 << CODE_BITS)] = t_send
            if bright and not was_bright:
                sent_flash.append(t_send)
            was_bright = bright
        time.sleep(0.5)
        stop.set()

    th = threading.Thread(target=send_loop, daemon=True)
    th.start()
    e2e: list[float] = []
    dets: list[float] = []
    found = total = 0
    last = 0
    while not stop.is_set():
        fr = reader.latest(last)
        if fr is None:
            time.sleep(0.002)
            continue
        last, arrived, frame = fr
        r = det.detect(frame)
        t_done = time.perf_counter()
        total += 1
        dets.append(r["det_ms"])
        found += bool(r["found"])
        sent_at = seq_sent.get(read_seq(frame))
        if sent_at is not None:
            e2e.append((t_done - sent_at) * 1000)
    th.join(timeout=2)
    try:
        sender.stdin.close()
    except OSError:
        pass
    sender.terminate()
    reader.close()
    arrive_lag = [(seq_arrival[k] - t) * 1000 for k, t in seq_sent.items() if k in seq_arrival]
    return {
        "mode": "selftest(手元の RTSP。ネットワークと本物のカメラの遅れは含まない)",
        "frame_size": [W, H],
        "fps": FPS,
        "arrival_lag_by_frame_number": summarize(arrive_lag),
        "flash_method_check": summarize(lags_from_events(sent_flash[1:], arrivals, (DARK + BRIGHT) / 2)),  # 最初の 1 回は、受け取り側がまだ立ち上がり中なので除く
        "detector_ms": {"median": round(statistics.median(dets), 1), "p90": round(sorted(dets)[int(len(dets) * 0.9)], 1)} if dets else {},
        "frames_processed": total,
        "face_found_rate": round(found / total, 3) if (total and face is not None) else None,
        "input_to_face_position_ms": summarize(e2e),
    }


def flash(a) -> dict:
    import tkinter as tk

    cfg = camera_config.load()
    src = a.url or camera_config.rtsp_url(cfg)
    w, h = probe_size(src)
    arrivals: list[tuple[float, float]] = []
    reader = FrameReader(src, w, h, on_frame=lambda t, f: arrivals.append((t, float(f[::16, ::16].mean()))))
    root = tk.Tk()
    root.attributes("-fullscreen", True)
    root.configure(bg="black")
    sent: list[float] = []
    state = {"on": False, "n": 0}
    t_end = time.perf_counter() + a.seconds

    def tick():
        if time.perf_counter() > t_end:
            root.destroy()
            return
        state["on"] = not state["on"]
        root.configure(bg="white" if state["on"] else "black")
        root.update_idletasks()
        root.update()
        if state["on"]:
            sent.append(time.perf_counter())
        root.after(int(1500 + 700 * ((state["n"] * 7) % 3)), tick)
        state["n"] += 1

    root.after(2500, tick)
    root.mainloop()
    reader.close()
    means = [m for _, m in arrivals]
    if not means:
        return {"error": "映像が届きませんでした"}
    lo, hi = np.percentile(means, 5), np.percentile(means, 95)
    return {"mode": "flash(本物のカメラ。画面の表示の遅れを含む)", "frame_size": [w, h], "contrast": [round(lo), round(hi)], "flash_lag_arrival": summarize(lags_from_events(sent, arrivals, (lo + hi) / 2)) if hi - lo > 20 else "画面がカメラに映っていません(明暗の差が小さい)"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("selftest")
    s.add_argument("--face-image", default="")
    s.add_argument("--seconds", type=float, default=20)
    s.add_argument("--detect-width", type=int, default=0)
    s.add_argument("--high-priority", action="store_true", help="測定の間だけ優先度を上げる(ほかの重い仕事が動いている機械で、遅れを実際より大きく測らないため)")
    f = sub.add_parser("flash")
    f.add_argument("--seconds", type=float, default=40)
    f.add_argument("--url", default="", help="RTSP の URL を直接指定(省略すると camera_config から)")
    a = ap.parse_args()
    try:
        res = selftest(a) if a.cmd == "selftest" else flash(a)
    except camera_config.ConfigError as e:
        raise SystemExit(str(e))
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
