"""カメラの首を、位置を見ながら動かす小さな道具(現地の測定用)。位置は ONVIF の正規化した値で、1.0 ≒ 約 35°(垂直)。
  python ptz_cli.py status                 いまの位置(pan・tilt)
  python ptz_cli.py tilt-to 1.0            垂直を指定の位置まで(0.1 ずつ・動くたびに位置を読む。上限は 1.0)
  python ptz_cli.py tilt-max               上の限度まで上げる(床置きで、上を向けられる限度を見るため)
  python ptz_cli.py home                   ONVIF の「家の位置」へ
安全: 1 回は 0.1 まで・位置が動かなくなったらそこで止まる・全体で 15 回まで。映像には触らない。
"""
from __future__ import annotations

import sys
import time

import camera_config
from onvif_ptz import MAX_STEP, OnvifError, OnvifPtz

SETTLE_S = 1.6  # 1 回の動きが終わるまでの待ち(実機で、0.1 の動きが約 1.5 秒)
MAX_STEPS = 15


def go_to_tilt(ptz, target: float, tol: float = 0.02, sleep=time.sleep) -> float:
    """垂直の位置を target へ近づける。動かなくなったら(限度)止める。最終の位置を返す"""
    pos = ptz.status().get("tilt")
    if pos is None:
        raise OnvifError("このカメラは位置を返しません")
    for _ in range(MAX_STEPS):
        diff = target - pos
        if abs(diff) <= tol:
            break
        ptz.nudge(0.0, max(-MAX_STEP, min(MAX_STEP, diff)))
        sleep(SETTLE_S)
        new = ptz.status()["tilt"]
        if abs(new - pos) < 0.005:  # 動かなかった = 限度
            pos = new
            break
        pos = new
    return pos


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cfg = camera_config.load()
    ptz = OnvifPtz(cfg["host"], cfg["onvif_port"], cfg["user"], cfg["password"])
    try:
        ptz.sync_clock()
        ptz.discover()
        cmd = argv[0]
        if cmd == "status":
            print(ptz.status())
        elif cmd == "tilt-to":
            print({"tilt": round(go_to_tilt(ptz, float(argv[1])), 3)})
        elif cmd == "tilt-max":
            print({"tilt": round(go_to_tilt(ptz, 1.0), 3)})
        elif cmd == "home":
            ptz.home()
            time.sleep(SETTLE_S * 2)
            print(ptz.status())
        else:
            print(__doc__)
            return 2
    except OnvifError as e:
        print(camera_config.mask(str(e), cfg), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
