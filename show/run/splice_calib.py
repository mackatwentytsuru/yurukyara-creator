#!/usr/bin/env python
"""全編の master の calib の区間を、校正の盤の映像に差しかえる(ほかのコマは再符号化しない)。
使い方: splice_calib.py <master.mov> <timeline.json> <校正の映像>
master と同じ形(FFV1、10bit)に直してからつなぐ。元の master は <master>.nocalib.mov に残す。
"""
import json
import subprocess
import sys
from pathlib import Path

FFV1 = ["-c:v", "ffv1", "-level", "3", "-g", "1", "-slices", "24", "-slicecrc", "0", "-coder", "1", "-context", "0", "-pix_fmt", "yuv444p10le"]


def run(*args):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True, stdin=subprocess.DEVNULL)


def main():
    master, timeline_path, calib = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    section = next((s for s in timeline["sections"] if s["id"] == "calib"), None)
    if section is None:
        raise SystemExit("timeline に calib の区間が無い")
    fps = timeline["fps"]
    first, last = round(section["start"] * fps), round(section["end"] * fps)
    count = last - first
    work = master.parent
    part = work / "_calib_ffv1.mov"
    run("-i", str(calib), "-frames:v", str(count), "-an", *FFV1, "-r", str(fps), str(part))
    frames = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(part)],
                            capture_output=True, text=True, check=True).stdout.strip()
    if int(frames.split(",")[0]) != count:
        raise SystemExit(f"校正の映像のコマ数が足りない: {frames} / {count}")
    original = master.with_suffix(".nocalib.mov")
    master.rename(original)
    listing = work / "_splice.txt"
    name = original.as_posix()
    listing.write_text(f"file '{name}'\noutpoint {first / fps:.6f}\nfile '{part.as_posix()}'\nfile '{name}'\ninpoint {last / fps:.6f}\n", encoding="utf-8")
    run("-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-map_metadata", "-1", "-video_track_timescale", "60000", str(master))
    print(f"差しかえた: {first}〜{last} コマ")


main()
