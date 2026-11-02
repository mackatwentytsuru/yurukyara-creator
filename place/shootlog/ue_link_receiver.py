"""iPhone「撮影記録」の UE モニターが送る位置(UDP、1 コマ 1 行の JSON)を受けて、数と欠けと間隔を表示する確認用。
UE 側の Python が受けるときの見本にもなる(read_pose の形)。

  python place/shootlog/ue_link_receiver.py [--port 9000] [--seconds 0] [--log <jsonl に保存>]

1 秒ごとに: 受信数/秒、連番の欠け(seq の飛び)、コマの間隔の平均と最大(ms)、最後の位置(カメラの ARKit ワールドの x,y,z)を出す。
sent_ms は iPhone の時計なので、PC の時計と合わせてない限り「片道の遅れ」ではない(見かけの差と、その揺れだけ見る)。
"""
from __future__ import annotations

import argparse
import json
import socket
import time


def read_pose(line: str) -> dict:
    """1 行の JSON → dict。T は 16 個(列順、カメラ→ARKit ワールド)。UE 側の Python もこの形で読む。"""
    d = json.loads(line)
    t = d["T"]
    d["position"] = (t[12], t[13], t[14])
    return d


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=9000)
    ap.add_argument("--seconds", type=float, default=0, help="この秒数で終わる(0 なら止めるまで)")
    ap.add_argument("--log", default=None)
    a = ap.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
    sock.bind(("0.0.0.0", a.port))
    sock.settimeout(0.5)
    log = open(a.log, "w", encoding="utf-8") if a.log else None
    print(f"待っています: UDP {a.port}")
    start = time.time()
    last_report = start
    count = 0
    total = 0
    lost = 0
    last_seq = None
    gaps = []
    last_arrival = None
    last = None
    while True:
        now = time.time()
        if a.seconds and now - start >= a.seconds:
            break
        try:
            data, addr = sock.recvfrom(65535)
        except socket.timeout:
            data = None
        if data:
            arrival = time.time()
            for line in data.decode("utf-8", "replace").splitlines():
                if not line.strip():
                    continue
                try:
                    p = read_pose(line)
                except (ValueError, KeyError):
                    continue
                count += 1
                total += 1
                if last_seq is not None and p["seq"] > last_seq + 1:
                    lost += p["seq"] - last_seq - 1
                last_seq = p["seq"]
                if last_arrival is not None:
                    gaps.append((arrival - last_arrival) * 1000)
                last_arrival = arrival
                last = p
                if log:
                    log.write(line + "\n")
        if time.time() - last_report >= 1.0:
            dt = time.time() - last_report
            gm = (sum(gaps) / len(gaps)) if gaps else 0
            gx = max(gaps) if gaps else 0
            pos = tuple(round(v, 3) for v in last["position"]) if last else None
            print(f"{count / dt:5.1f}/s  欠け累計 {lost}  間隔 平均 {gm:5.1f} ms 最大 {gx:6.1f} ms  ok={last['ok'] if last else None}  位置 {pos}")
            count = 0
            gaps = []
            last_report = time.time()
    print(f"終わり: 受信 {total}、欠け {lost}")


if __name__ == "__main__":
    main()
