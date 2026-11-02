"""端末の代わりの試しの送り手: ゆっくり舞台の前を動くカメラの姿勢を UDP で送る。

遅れの測定用に、一定の間隔で印の番号 m を変え、送った時刻をファイルに残す。
使い方: python fake_phone_udp.py --host 127.0.0.1 --port 9000 --rate 60 --seconds 30 --hold-after 24 --log sent.jsonl
"""
import argparse
import json
import math
import socket
import time

from live_math import axes_to_T, rotator_axes

FX = 1440.0  # 横 36mm なら 27mm 相当
TARGET = (130.0, 0.0, 320.0)


def path_pose(seconds):
    """舞台の正面 15 m あたりを左右に 4 m、高さ 1 m ほど動きながら、中央の面を見る。"""
    x = 130.0 + 400.0 * math.sin(seconds * 0.5)
    y = 1500.0 + 150.0 * math.sin(seconds * 0.23)
    z = 170.0 + 50.0 * math.sin(seconds * 0.7)
    dx, dy, dz = TARGET[0] - x, TARGET[1] - y, TARGET[2] - z
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
    return (x, y, z), pitch, yaw


def packet(seconds, code=None, size=(1920, 1080)):
    position, pitch, yaw = path_pose(seconds)
    forward, right, up = rotator_axes(pitch, yaw, 3.0 * math.sin(seconds * 0.9))
    message = {"t": round(seconds, 4), "T": [round(v, 6) for v in axes_to_T(position, forward, right, up)],
               "K": [FX, FX, size[0] / 2.0, size[1] / 2.0], "w": size[0], "h": size[1]}
    if code is not None:
        message["m"] = code
    return message


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--rate", type=float, default=60.0)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--hold-after", type=float, default=None, help="この秒からカメラを止める(絵と計算を比べる用)")
    parser.add_argument("--marker-interval", type=float, default=0.5)
    parser.add_argument("--no-marker", action="store_true")
    parser.add_argument("--size", default="1920x1080", help="端末の画像の大きさ")
    parser.add_argument("--log")
    args = parser.parse_args()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    log = open(args.log, "w", encoding="utf-8") if args.log else None
    size = tuple(int(v) for v in args.size.split("x"))
    start = time.time()
    sent = 0
    code = -1
    while True:
        elapsed = time.time() - start
        if elapsed >= args.seconds:
            break
        pose_time = min(elapsed, args.hold_after) if args.hold_after is not None else elapsed
        wanted = None if args.no_marker else int(elapsed / args.marker_interval)
        if wanted is not None and wanted != code:
            code = wanted
            if log:
                log.write(json.dumps({"m": code, "wall_ms": round(time.time() * 1000.0, 2)}) + "\n")
                log.flush()
        sock.sendto(json.dumps(packet(pose_time, wanted, size), separators=(",", ":")).encode("utf-8"), (args.host, args.port))
        sent += 1
        time.sleep(max(0.0, start + sent / args.rate - time.time()))
    if log:
        log.close()
    print(f"sent {sent} packets in {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()
