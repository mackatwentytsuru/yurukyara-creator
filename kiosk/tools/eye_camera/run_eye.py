"""見守りカメラ(Tapo C200 など RTSP のカメラ)を、キャラの「目」として使う本体: 映像を取り込み、顔の位置を出し、(任意で)首を人の方へ向ける。
  python kiosk/tools/eye_camera/run_eye.py --seconds 30 --out run.jsonl                # camera_config のカメラ(stream1)
  python kiosk/tools/eye_camera/run_eye.py --source stream2 --seconds 30 --out run.jsonl   # 軽い方の映像
  python kiosk/tools/eye_camera/run_eye.py --file movie.mp4 --realtime --ptz dry         # 動画ファイル(カメラなし)。首は「命令を表示するだけ」
視線の橋へ送る: --send 127.0.0.1:5331(会話側のサーバーの GAZE_UDP_PORT か、UE の 5321)--geometry gaze_geometry.json [--with-pixels(校正の記録のとき)]
  python kiosk/tools/eye_camera/run_eye.py --seconds 36000 --send 127.0.0.1:5331 --geometry gaze_geometry.json --with-pixels
首振り: --ptz off(既定。動かさない) / dry(動かす命令を表示だけ) / on(ONVIF で実際に動かす。動かしすぎない決まりは follow.py)
出力: コマごとの JSONL(顔の位置・目の間隔・検出の時間)と、最後のまとめ。映像は保存しない。アドレス・アカウントは表示しない。
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time

import camera_config
from detect import FaceDetector, FaceTracker
from follow import Follower
from gaze_bridge import GazeBridge, Geometry
from onvif_ptz import OnvifError, OnvifPtz
from stream import FrameReader, probe_size, raise_self_priority


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="stream1", help="カメラの映像の名前(stream1=高画質 / stream2=軽い)")
    ap.add_argument("--file", default="", help="カメラの代わりに動画ファイル(試験用)")
    ap.add_argument("--realtime", action="store_true", help="ファイルを実時間で流す")
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--out", default="")
    ap.add_argument("--ptz", choices=["off", "dry", "on"], default="off")
    ap.add_argument("--detect-width", type=int, default=0)
    ap.add_argument("--high-priority", action="store_true")
    ap.add_argument("--send", default="", help="視線の橋の送り先 host:port(v1 の UDP)。空なら送らない")
    ap.add_argument("--geometry", default="", help="gaze_geometry.json(カメラの置き場所・向き・キャラの目の位置。校正の結果)")
    ap.add_argument("--with-pixels", action="store_true", help="v1 に目の中点と目の間隔の画素も付ける(校正の画面が点を記録するとき)")
    a = ap.parse_args()

    cfg = None
    if a.ptz == "on" or not a.file:
        try:
            cfg = camera_config.load()
        except camera_config.ConfigError as e:
            print(str(e), file=sys.stderr)
            return 2
    src = a.file or camera_config.rtsp_url(cfg, a.source)
    try:
        w, h = probe_size(src, rtsp_tcp=True)
    except Exception as e:  # noqa: BLE001
        print(camera_config.mask(str(e), cfg), file=sys.stderr)
        return 3

    ptz = None
    if a.ptz == "on":
        ptz = OnvifPtz(cfg["host"], cfg["onvif_port"], cfg["user"], cfg["password"])
        try:
            ptz.sync_clock()
            ptz.discover()
        except OnvifError as e:
            print(camera_config.mask(str(e), cfg), file=sys.stderr)
            return 4

    if a.high_priority:
        raise_self_priority()
    det = FaceTracker(FaceDetector(detect_width=a.detect_width))  # 追跡 + 探索(遠い顔)
    reader = FrameReader(src, w, h, realtime=a.realtime, high_priority=a.high_priority)
    follower = Follower()
    bridge = None
    if a.send:
        host, port = a.send.rsplit(":", 1)
        g = Geometry.load(a.geometry or None)
        g.width, g.height = w, h  # 画素の式は、実際の映像の大きさで
        bridge = GazeBridge(g=g, sink=(host, int(port)), packet="v1", with_pixels=a.with_pixels)
    out = open(a.out, "w", encoding="utf-8") if a.out else None
    t0 = time.perf_counter()
    last, first_arrival = 0, None
    recs, actions = [], 0
    try:
        while time.perf_counter() - t0 < a.seconds and not (reader.ended and reader.latest(last) is None):
            fr = reader.latest(last)
            if fr is None:
                time.sleep(0.002)
                continue
            last, arrived, frame = fr
            first_arrival = first_arrival or arrived
            r = det.detect(frame)
            now = time.perf_counter()
            r.update(seq=last, t=round(arrived - first_arrival, 3), proc_ms=round((now - arrived) * 1000, 1))
            recs.append(r)
            if bridge:
                bridge.update(now, r, age_ms=r["proc_ms"])
            if out:
                out.write(json.dumps(r, ensure_ascii=False) + "\n")
            act = follower.update(now, r["found"], r.get("cx", 0.5), r.get("cy", 0.5)) if a.ptz != "off" else None
            if act:
                actions += 1
                print(f"[首] t={r['t']:.1f}s {act.kind} pan={act.pan:+.2f} tilt={act.tilt:+.2f} ", flush=True)
                if ptz:
                    try:
                        ptz.home() if act.kind == "home" else ptz.nudge(act.pan, act.tilt)
                    except OnvifError as e:
                        print("[首] 失敗: " + camera_config.mask(str(e), cfg), flush=True)
    finally:
        if ptz:
            try:
                ptz.stop()  # どんな終わり方でも、最後に止める
            except OnvifError:
                pass
        reader.close()
        if out:
            out.close()

    dets = [r["det_ms"] for r in recs]
    found = [r for r in recs if r["found"]]
    span = (recs[-1]["t"] - recs[0]["t"]) if len(recs) > 1 else 0
    summary = {
        "frame_size": [w, h],
        "frames_processed": len(recs),
        "processed_fps": round((len(recs) - 1) / span, 1) if span else None,
        "face_found_rate": round(len(found) / len(recs), 3) if recs else None,
        "detector_ms": {"median": round(statistics.median(dets), 1), "p90": round(pct(dets, 0.9), 1)} if dets else {},
        "arrival_to_position_ms": {"median": round(statistics.median(r["proc_ms"] for r in recs), 1), "p90": round(pct([r["proc_ms"] for r in recs], 0.9), 1)} if recs else {},
        "ipd_px_median": round(statistics.median(r["ipd_px"] for r in found), 1) if found else None,
        "ptz_actions": actions,
        "ptz_mode": a.ptz,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
