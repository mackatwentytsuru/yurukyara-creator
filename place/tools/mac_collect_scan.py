#!/usr/bin/env python3
"""Mac の ~/Downloads に AirDrop で届いた「場所スキャン」の 4 ファイルを 1 つのフォルダに集める。
使い方(Mac で): python3 mac_collect_scan.py <出力フォルダ> [何分前までを見るか=180]
- 届いた名前は room_mesh.usdz / room_mesh 2.usdz のように重なることがある。各ファイルは一番新しい物を取る。
- 集めた先の名前は room_mesh.usdz・room_parametric.usdz・room.json・landmarks_hint.json にそろえる。
- 4 つの更新時刻が 10 分以上離れていたら、別々の撮影が混ざった疑いとして警告(終了コード 3)。
- 必須(room_mesh.usdz・room.json・landmarks_hint.json)が無ければ終了コード 2。
標準ライブラリだけ。"""
import re
import shutil
import sys
import time
from pathlib import Path

WANTED = {
    'room_mesh': '.usdz',
    'room_parametric': '.usdz',
    'room': '.json',
    'landmarks_hint': '.json',
}
REQUIRED = ('room_mesh', 'room', 'landmarks_hint')
MIXED_SECONDS = 600


def newest_candidates(downloads: Path, since: float) -> dict:
    found = {}
    for path in downloads.iterdir():
        for base, ext in WANTED.items():
            # 「room_mesh.usdz」「room_mesh 2.usdz」「room_mesh (1).usdz」
            if re.fullmatch(rf'{re.escape(base)}(?: \d+| \(\d+\))?{re.escape(ext)}', path.name):
                mtime = path.stat().st_mtime
                if mtime >= since and (base not in found or mtime > found[base][1]):
                    found[base] = (path, mtime)
    return found


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    dest = Path(sys.argv[1]).expanduser()
    minutes = float(sys.argv[2]) if len(sys.argv) > 2 else 180
    found = newest_candidates(Path.home() / 'Downloads', time.time() - minutes * 60)
    missing = [b for b in REQUIRED if b not in found]
    if missing:
        print(f'足りない: {", ".join(b + WANTED[b] for b in missing)}(~/Downloads の過去 {minutes:.0f} 分に無い)')
        return 2
    dest.mkdir(parents=True, exist_ok=True)
    for base, (path, mtime) in found.items():
        shutil.copy2(path, dest / (base + WANTED[base]))
        print(f'集めた: {path.name} -> {base + WANTED[base]}({time.strftime("%H:%M:%S", time.localtime(mtime))})')
    times = [m for _, m in found.values()]
    if max(times) - min(times) > MIXED_SECONDS:
        print('警告: ファイルの時刻が 10 分以上離れている。別々の撮影が混ざっていないか確かめること。')
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
