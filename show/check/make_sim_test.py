"""同期を測るテスト映像と音を作る。30 分の 1 秒ごとに灰色の明るさが乱数で変わり、決まった秒に白く光って音が鳴る。

使い方: python make_sim_test.py <出力 mp4> <出力 wav> [秒]
"""
import subprocess
import sys

import numpy as np

FPS_LED = 60
STEP = 2  # 60p の 2 コマごとに変える(30p の 1 コマ)
SEED = 20261103
FLASH_EVERY_SEC = 3
FLASH_FIRST_SEC = 2
FLASH_STEPS = 2
AUDIO_RATE = 48000
BEEP_SEC = 0.1
BEEP_HZ = 1000.0


def flash_times(seconds):
    return np.arange(FLASH_FIRST_SEC, seconds - 0.2, FLASH_EVERY_SEC)


def levels(seconds):
    rng = np.random.default_rng(SEED)
    count = int(seconds * FPS_LED / STEP)
    values = rng.integers(20, 150, count).astype(np.uint8)
    for t in flash_times(seconds):
        at = int(round(t * FPS_LED / STEP))
        values[at:at + FLASH_STEPS] = 255
    return values


def write_video(path, values):
    frames = np.repeat(values, STEP)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "4x4",
                             "-r", str(FPS_LED), "-i", "-", "-vf", "scale=2840:620:flags=neighbor,format=yuv420p",
                             "-c:v", "libx264", "-crf", "16", "-bf", "0", "-g", "30", "-an", path],
                            stdin=subprocess.PIPE)
    for value in frames:
        proc.stdin.write(bytes([value]) * 16)
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("映像を書けない")


def write_sound(path, seconds):
    samples = np.zeros(int(seconds * AUDIO_RATE), dtype=np.float32)
    beep = (0.5 * np.sin(2 * np.pi * BEEP_HZ * np.arange(int(BEEP_SEC * AUDIO_RATE)) / AUDIO_RATE)).astype(np.float32)
    for t in flash_times(seconds):
        at = int(t * AUDIO_RATE)
        samples[at:at + beep.size] = beep
    stereo = np.repeat(samples, 2).tobytes()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(AUDIO_RATE), "-ac", "2", "-i", "-",
                    "-c:a", "pcm_s24le", path], input=stereo, check=True)


if __name__ == "__main__":
    length = float(sys.argv[3]) if len(sys.argv) > 3 else 20.0
    write_video(sys.argv[1], levels(length))
    write_sound(sys.argv[2], length)
    print("wrote", sys.argv[1], sys.argv[2])
