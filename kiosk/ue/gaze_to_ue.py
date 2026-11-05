"""会話側のサーバーの視線の受け口(web/server/gazeRelay.mjs の GET /api/gaze/now)を読み、v1 の UDP で UE の入口のレベルへ流す。
床のカメラ → gaze_bridge.py(--with-pixels)→ サーバーの UDP(GAZE_UDP_PORT)→ このファイル → UE(entrance_config.json の udp)。
サーバーを通すのは、校正の画面(kiosk/web/aim.html)の「狙い」と「記録」を、ブラウザ版と同じ手順で UE の人型にも使うため
(狙いが有効な間は、サーバーが狙いの向きを返す)。校正をしないときは、gaze_bridge.py から UE へ直接送ってもよい(形は同じ v1)。
python kiosk/ue/gaze_to_ue.py --server http://127.0.0.1:8811 [--hz 30]
旧式のキオスク(前からある UE の会話の部屋。角度を「描画のカメラを 0」として読む)へ送るとき(11-05 のテスト):
python kiosk/ue/gaze_to_ue.py --server http://127.0.0.1:8787 --ue 127.0.0.1:5321 --ue-cam-h 2.3 --ue-cam-dz -0.59
(箱の頭 → 描画のカメラの水平の距離 m と高さの差 m。gaze_bridge.to_ue_angles で、水平を 0 とする向きを直す)
"""
from __future__ import annotations

import argparse
import json
import socket
import time
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "eye_camera"))
from gaze_bridge import Geometry, to_ue_angles  # noqa: E402

CFG = json.loads((Path(__file__).resolve().parent / "entrance_config.json").read_text(encoding="utf-8"))


def to_v1(now: dict, seq: int, stale_ms: float = 1500, g: Geometry | None = None) -> dict:
    """サーバーの向き → v1。古い向き(受けてから stale_ms より前)は「いない」。g があれば UE の読み方に直す(to_ue_angles)"""
    present = bool(now.get("present")) and (now.get("ageMs") or 0) <= stale_ms
    if not present:
        return {"v": 1, "present": False, "seq": seq}
    az, el = float(now["az"]), float(now["el"])
    if g is not None:
        az, el = to_ue_angles(g, az, el)
    return {"v": 1, "present": True, "az": round(az, 2), "el": round(el, 2), "dist": now.get("dist") or 2.0,
            "n": now.get("n") or 1, "facing": now.get("facing") if now.get("facing") is not None else 1, "seq": seq}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://127.0.0.1:8787")
    ap.add_argument("--ue", default=f"{CFG['udp']['host']}:{CFG['udp']['port']}")
    ap.add_argument("--hz", type=float, default=30)
    ap.add_argument("--ue-cam-h", type=float, default=0.0, help="旧式のキオスク: 頭 → 描画のカメラの水平の距離(m)。0 = 直さない")
    ap.add_argument("--ue-cam-dz", type=float, default=0.0, help="旧式のキオスク: 描画のカメラ − 頭 の高さ(m。カメラが下なら負)")
    a = ap.parse_args()
    g = Geometry(ue_cam_h_m=a.ue_cam_h, ue_cam_dz_m=a.ue_cam_dz) if a.ue_cam_h > 0 else None
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
            sock.sendto(json.dumps(to_v1(now, seq, g=g)).encode(), (host, int(port)))
        except OSError:
            pass
        nxt += step
        time.sleep(max(0.0, nxt - time.perf_counter()))


if __name__ == "__main__":
    main()
