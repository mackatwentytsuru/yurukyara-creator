"""黒の 10 秒が、納品と同じ形式で真っ黒+無音かを確かめる。使い方: python show/check/check_black.py <mov>"""
import json
import subprocess
import sys

import numpy as np

W, H, FRAMES = 5680, 1240, 600


def main():
    path = sys.argv[1]
    probe = ["ffprobe", "-v", "error", "-count_packets", "-show_entries", "stream=codec_type,codec_name,codec_tag_string,pix_fmt,width,height,r_frame_rate,nb_read_packets,sample_rate,channels", "-of", "json", path]
    streams = {s["codec_type"]: s for s in json.loads(subprocess.run(probe, capture_output=True, text=True, check=True).stdout)["streams"]}
    v, a = streams["video"], streams["audio"]
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=710:155,format=gray", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    peak = int(np.frombuffer(raw, np.uint8).max())
    sound = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-f", "s32le", "-"], capture_output=True, check=True).stdout
    loud = int(np.abs(np.frombuffer(sound, np.int32)).max())
    ok = (v["codec_name"] == "hevc" and v["codec_tag_string"] == "hvc1" and v["pix_fmt"] == "yuv420p10le" and v["width"] == W and v["height"] == H
          and v["r_frame_rate"] == "60/1" and int(v["nb_read_packets"]) == FRAMES and a["codec_name"] == "pcm_s24le" and a["sample_rate"] == "48000" and peak <= 1 and loud == 0)
    print(json.dumps({"ok": ok, "frames": v["nb_read_packets"], "peak_luma": peak, "peak_audio": loud}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
