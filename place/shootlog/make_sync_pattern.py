"""LED に流す同期用の映像(黒地に、不ぞろいな間隔の白いフラッシュ)を ffmpeg で作る。

  python place/shootlog/make_sync_pattern.py --out sync_flash.mp4 [--size 5680x1240] [--fps 60] [--duration 12]
フラッシュは全面の白を 0.2 秒、間隔は不ぞろい(既定は 1.0, 2.5, 3.2, 5.5, 6.0, 8.5 秒の開始)。
最短の間隔 0.5 秒 = 毎秒 2 回以下で、点滅の安全の目安(毎秒 3 回以下)の内側。
これを a7 と iPhone の両方が撮っていれば、sync_flash.py で 2 台の時刻を合わせられる。撮影の最初と最後に 1 回ずつ流すと、時計の進みの差も測れる。
"""
from __future__ import annotations

import argparse
import subprocess


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", default="5680x1240")
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--duration", type=float, default=12.0)
    ap.add_argument("--starts", default="1.0,2.5,3.2,5.5,6.0,8.5")
    ap.add_argument("--flash-s", type=float, default=0.2)
    ap.add_argument("--codec", default="libx265")
    a = ap.parse_args()
    enable = "+".join(f"between(t,{float(s)},{float(s) + a.flash_s})" for s in a.starts.split(","))
    vf = f"drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='{enable}',format=yuv420p"
    cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s={a.size}:r={a.fps}:d={a.duration}", "-vf", vf,
           "-c:v", a.codec, "-crf", "12", "-map_metadata", "-1", a.out]
    subprocess.run(cmd, check=True)
    print("書いた:", a.out)


if __name__ == "__main__":
    main()
