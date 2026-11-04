"""仮想の iPad のふりをして、受け手(pc_stream_receiver.py --split-takes)へ本物のソケットで HEV1(HEVC)と CAL1 を送り、
本物の pc_to_frames.py で撮影フォルダにする。

  python place/shootlog/sim/sim_send.py --hevc <stream.hevc> --rows <ARKit の記録 json> [--cal <CAL1 の JSON>] --rx <受け手の出力> --out <撮影フォルダ>
電文はアプリ(PCStream.swift)と同じ形。HEVC は 1 コマ = 1 アクセスユニット(AUD で切る)。受け手と pc_to_frames はメイン PC の Python で動かす(サブ機は使わない)。
"""
from __future__ import annotations

import argparse
import json
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sim_common import REPO  # noqa: E402

SHOOTLOG = REPO / "place" / "shootlog"
HEADER = struct.Struct(">4sIIiddHHB")
PORT = 19177


def split_access_units(data: bytes):
    """Annex B の列を、AUD(NAL 種別 35)ごとの塊(= 1 コマ)に切る。"""
    starts = []
    i = 0
    n = len(data)
    while True:
        j = data.find(b"\x00\x00\x01", i)
        if j < 0 or j + 3 >= n:
            break
        nal_type = (data[j + 3] >> 1) & 0x3F
        begin = j - 1 if j > 0 and data[j - 1] == 0 else j
        if nal_type == 35:
            starts.append(begin)
        i = j + 3
    starts.append(n)
    return [data[a:b] for a, b in zip(starts, starts[1:])]


def cal_packet(session, rays, accepted=True):
    doc = {"arSessionId": session, "rays": rays, "accepted": accepted, "latestDots": len({r["dot"] for r in rays})}
    body = json.dumps(doc).encode("utf-8")
    return b"CAL1" + struct.pack(">I", len(body)) + body


def rays_to_cal(rays):
    """real_dots_check.emulate_app のレイ({dot, o, d})→ CAL1 のレイ。"""
    return [{"face": "A", "id": f"dot{r['dot']}", "dot": int(r["dot"]), "origin": [float(v) for v in r["o"]],
             "direction": [float(v) for v in r["d"]]} for r in rays]


def send_take(rx_dir: Path, aus, rows, cal_rays=None, session="SIM-1", port=PORT):
    """受け手を起動し、CAL1(つないだ直後・途中・止める直前)と HEV1 を送る。受け手が全部書いたと答えるまで待つ。戻り: テイクのフォルダ。"""
    proc = subprocess.Popen([sys.executable, str(SHOOTLOG / "pc_stream_receiver.py"), "--out", str(rx_dir), "--port", str(port), "--seconds", "900", "--split-takes", "--bind", "127.0.0.1"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        s = socket.create_connection(("127.0.0.1", port), timeout=10)
        cal = cal_packet(session, rays_to_cal(cal_rays)) if cal_rays else None
        if cal:
            s.sendall(cal)
        n = min(len(aus), len(rows))
        for i in range(n):
            r = rows[i]
            floats = struct.pack(">20f", *(list(r["T"]) + list(r["K"])))
            s.sendall(HEADER.pack(b"HEV1", len(aus[i]), i + 1, -1, r["ar_ts"], time.time() * 1000, 1920, 1080, 2 | (4 if i == 0 else 0)) + floats + aus[i])
            if cal and i == n // 2:
                s.sendall(cal)
            time.sleep(0.002)
        if cal:
            s.sendall(cal)
        s.settimeout(3)
        buf, acked, end = b"", -1, time.time() + 20
        while time.time() < end and acked < n:
            try:
                buf += s.recv(4096)
            except socket.timeout:
                break
            while len(buf) >= 16:
                m, buf = buf[:16], buf[16:]
                if m[:4] == b"RCV1":
                    acked = struct.unpack(">I", m[4:8])[0]
        s.close()
        time.sleep(1.5)
    finally:
        proc.terminate()      # 自分で起動した受け手だけを止める
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
    takes = sorted(Path(rx_dir).glob("take_*"))
    if not takes:
        raise RuntimeError("受け手がテイクを書かなかった")
    return takes[-1], n


def run_pc_to_frames(take_dir: Path, out_dir: Path):
    r = subprocess.run([sys.executable, str(SHOOTLOG / "pc_to_frames.py"), "--rx", str(take_dir), "--out", str(out_dir)], capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hevc", required=True, type=Path)
    ap.add_argument("--rows", required=True, type=Path)
    ap.add_argument("--cal", type=Path, help="CAL1 に載せるレイ({dot,o,d} の json)")
    ap.add_argument("--rx", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    rows = json.loads(a.rows.read_text(encoding="utf-8"))
    aus = split_access_units(a.hevc.read_bytes())
    cal = json.loads(a.cal.read_text(encoding="utf-8")) if a.cal else None
    take, n = send_take(a.rx, aus, rows, cal)
    print(f"送った: {n} コマ(アクセスユニット {len(aus)}、行 {len(rows)})→ {take}")
    print(run_pc_to_frames(take, a.out))


if __name__ == "__main__":
    main()
