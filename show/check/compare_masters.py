"""2 本の master を 1 コマずつ比べる(同じ入力で同じ絵になるかの確かめ)。
使い方: python show/check/compare_masters.py <a.mov> <b.mov>
"""
import subprocess
import sys

import numpy as np

W, H = 5680, 1240
FRAME_BYTES = W * H * 3 * 2  # yuv444p10le


def frames(path):
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "yuv444p10le", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    while True:
        raw = proc.stdout.read(FRAME_BYTES)
        if len(raw) < FRAME_BYTES:
            break
        yield np.frombuffer(raw, np.uint16).astype(np.int32)
    proc.wait()


def main():
    same = different = 0
    worst = 0
    worst_count = 0
    for i, (a, b) in enumerate(zip(frames(sys.argv[1]), frames(sys.argv[2]))):
        d = np.abs(a - b)
        if d.max() == 0:
            same += 1
            continue
        different += 1
        worst = max(worst, int(d.max()))
        worst_count = max(worst_count, int((d > 0).sum()))
        if different <= 3:
            print(f"コマ {i}: 差の最大 {d.max()}(10bit)、違う値の数 {(d > 0).sum()}")
    print(f"同じ {same} コマ、違う {different} コマ、差の最大 {worst}、1 コマで違う値の数の最大 {worst_count}")
    sys.exit(0 if different == 0 else 1)


if __name__ == "__main__":
    main()
