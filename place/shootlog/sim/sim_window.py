"""カットの一部(コマ first〜last)だけを切り出した撮影フォルダを作る。長いカットを 3 通りの追跡で合成するとき、撮る量と合成の時間を減らすため。

  python place/shootlog/sim/sim_window.py --dir <カットの撮影フォルダ> --tag e0_m10 --first 100 --last 160 --out <出力フォルダ>
出力: truth.json・track.json(どちらも切り出して f を 0 から振り直した物)、cut.json(ショーの始めの秒を ずらした物)、plate.mp4(カメラのまねを通した映像の同じ区間)。
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--tag", required=True, help="track_<tag>.json と shoot_<tag>/ を使う")
    ap.add_argument("--first", type=int, required=True)
    ap.add_argument("--last", type=int, required=True)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    truth = json.loads((a.dir / "truth.json").read_text(encoding="utf-8"))
    track = json.loads((a.dir / f"track_{a.tag}.json").read_text(encoding="utf-8"))
    cut = json.loads((a.dir / "cut.json").read_text(encoding="utf-8"))

    def cut_rows(rows):
        return [{**r, "f": i} for i, r in enumerate(rows[a.first:a.last])]

    truth["rows"] = cut_rows(truth["rows"])
    track["rows"] = cut_rows(track["rows"])
    cut["show_start"] = cut["show_start"] + a.first / 30.0
    cut["window"] = [a.first, a.last]
    for name, obj in (("truth.json", truth), ("track.json", track), ("cut.json", cut)):
        (a.out / name).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(a.dir / f"shoot_{a.tag}" / "video.mp4"), "-vf", f"select='between(n,{a.first},{a.last - 1})',setpts=N/30/TB", "-r", "30",
                    "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-threads", "6", str(a.out / "plate.mp4")], check=True, stdin=subprocess.DEVNULL)
    print("書いた:", a.out, f"{a.last - a.first} コマ ショーの始め {cut['show_start']:.3f} 秒")


if __name__ == "__main__":
    main()
