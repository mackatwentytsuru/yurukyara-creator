"""動いている受け手に命令を送る。

  位置合わせ(簡単): python live_ctl.py recenter --pos 130 1600 150 --yaw -90   今の端末の姿勢が、UE のこの位置と向きになる
  位置合わせ(LED の 4 隅): python live_ctl.py align <撮影のフォルダ>   校正と同じ ARKit のセッションのときだけ正しい
  映像の秒: python live_ctl.py media --seconds 20
"""
import argparse
import json
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def align_message(shoot_dir):
    sys.path[:0] = [str(ROOT / "show" / "composite")]
    from shoot_track import align_stage
    from shootlib import load_shoot
    corners = load_shoot(shoot_dir).meta.get("calibration", {}).get("corners", [])
    faces = sorted({c.get("face", "A") for c in corners})
    if not faces:
        raise SystemExit("この撮影に LED の 4 隅の記録が無い")
    rotation, translation, residuals = align_stage(shoot_dir, faces)
    print("面ごとのずれ cm:", json.dumps(residuals, ensure_ascii=False))
    return {"cmd": "align", "rotation": rotation.tolist(), "translation_cm": translation.tolist()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=["recenter", "align", "media"])
    parser.add_argument("shoot", nargs="?")
    parser.add_argument("--pos", nargs=3, type=float)
    parser.add_argument("--yaw", type=float, default=-90.0)
    parser.add_argument("--seconds", type=float, default=0.0)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    args = parser.parse_args()
    if args.cmd == "recenter":
        if not args.pos:
            raise SystemExit("--pos が要る")
        message = {"cmd": "recenter", "pos": args.pos, "yaw": args.yaw}
    elif args.cmd == "align":
        if not args.shoot:
            raise SystemExit("撮影のフォルダが要る")
        message = align_message(args.shoot)
    else:
        message = {"cmd": "media", "seconds": args.seconds}
    socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(json.dumps(message).encode("utf-8"), (args.host, args.port))
    print("sent", args.cmd)


if __name__ == "__main__":
    main()
