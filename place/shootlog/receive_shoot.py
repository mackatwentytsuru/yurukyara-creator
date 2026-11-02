"""iPhone「撮影記録」から AirDrop で Mac に届いた shoot_<日時>.zip を、PC の J: に取りこんで広げる。

  python place/shootlog/receive_shoot.py [--minutes 240] [--dest <取りこみ先。既定は環境変数 SHOOTLOG_DEST、なければ ./shoots>]

Mac の ~/Downloads で一番新しい shoot_*.zip(同じ名前が重なると shoot_xxx 2.zip のようになる)を探し、scp で運び、
<dest>/<日時>/ に広げて、中身(video.mov・frames.jsonl・meta.json)があるか、コマ数が合うか確かめる。
撮った映像はリポジトリに入れない(リポジトリの外に置く。例: SHOOTLOG_DEST=work/shoots)。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

FIND = r"""
import re, sys, time
from pathlib import Path
d = Path.home() / "Downloads"
since = time.time() - float(sys.argv[1]) * 60
c = [p for p in d.iterdir() if re.fullmatch(r"shoot_\d{8}-\d{6}(?: \d+| \(\d+\))?\.zip", p.name) and p.stat().st_mtime >= since]
if not c:
    sys.exit(2)
print(max(c, key=lambda p: p.stat().st_mtime).name)
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--minutes", type=float, default=240)
    ap.add_argument("--dest", default=os.environ.get("SHOOTLOG_DEST", "./shoots"))
    ap.add_argument("--host", default="pc3")
    a = ap.parse_args()

    r = subprocess.run(["ssh", a.host, f"python3 - {a.minutes}"], input=FIND, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0 or not r.stdout.strip():
        print("Mac の ~/Downloads に shoot_*.zip が無い(AirDrop で受け取ったか確かめる)")
        sys.exit(2)
    name = r.stdout.strip().splitlines()[-1]
    stamp = name.removeprefix("shoot_").split(".")[0].split(" ")[0]
    dest = Path(a.dest) / stamp
    dest.mkdir(parents=True, exist_ok=True)
    zpath = dest / "shoot.zip"
    subprocess.run(["scp", "-q", f"{a.host}:Downloads/{name}", str(zpath)], check=True)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(dest)
    inner = [p for p in dest.iterdir() if p.is_dir()]
    root = inner[0] if inner and not (dest / "meta.json").exists() else dest
    if root != dest:   # zip は撮影フォルダごと入っている → 1 つ上げる
        for p in root.iterdir():
            p.replace(dest / p.name)
        root.rmdir()
    zpath.unlink()
    meta = json.loads((dest / "meta.json").read_text(encoding="utf-8"))
    lines = sum(1 for _ in open(dest / "frames.jsonl", encoding="utf-8"))
    st = meta["stats"]
    print(f"取りこんだ: {dest}")
    print(f"  映像 {st['width']}x{st['height']}、{st['frames']} コマ(frames.jsonl {lines} 行)、約 {st['averageFps']:.1f} fps、{st['durationSeconds']:.1f} 秒")
    print(f"  捨てたコマ {st['droppedFrames']}、追跡が正常でないコマ {st['trackingNotNormalFrames']}")
    cal = meta["calibration"]
    print(f"  校正: 床 {'あり' if cal.get('floor') else 'なし'}、LED の角 {len(cal['corners'])}/4")
    if lines != st["frames"]:
        print("警告: frames.jsonl の行数が映像のコマ数と違う")
        sys.exit(3)


if __name__ == "__main__":
    main()
