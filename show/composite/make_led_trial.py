"""合成の試しの LED 映像を作る。全編の映像ができるまでの代わり。

背景の絵の明るさを timeline.json の energy で変え、透明 PNG の連番のキャラを重ねる。
キャラあり・なし・途中で消える版の 3 本を作る(2840x620、30p)。

使い方: python make_led_trial.py <timeline.json> <背景 png> <キャラの連番フォルダ> <出力フォルダ> --fade 始め秒 終わり秒
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

W, H = 2840, 620
FPS = 30
DARK_SECTIONS = {"preroll", "dark", "tail"}
LOW_GAIN = 0.25
ENERGY_GAIN = 0.75


def gains(timeline):
    """30p の 1 コマごとの明るさ。暗いセクションは 0。"""
    energy = np.array(timeline["energy"], dtype=np.float32)
    source_fps = timeline["fps"]
    frames = int(timeline["duration_sec"] * FPS)
    values = LOW_GAIN + ENERGY_GAIN * energy[np.minimum((np.arange(frames) * source_fps / FPS).astype(int), energy.size - 1)]
    for section in timeline["sections"]:
        if section["id"] in DARK_SECTIONS:
            values[int(section["start"] * FPS):int(section["end"] * FPS)] = 0.0
    return values


def character_frames(folder):
    """透明 PNG を、行って戻る順に読む(premultiplied の色とアルファ)。"""
    loaded = []
    for path in sorted(Path(folder).glob("f_*.png")):
        rgba = np.asarray(Image.open(path).convert("RGBA").resize((W, H)), dtype=np.float32) / 255.0
        loaded.append((rgba[..., :3] * rgba[..., 3:], rgba[..., 3:]))
    return loaded + loaded[-2:0:-1]


def open_writer(path):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                             "-r", str(FPS), "-i", "-", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "16",
                             "-bf", "0", "-g", "30", "-an", "-map_metadata", "-1", str(path)], stdin=subprocess.PIPE)


def fade_alpha(seconds, fade):
    return float(np.clip(1.0 - (seconds - fade[0]) / (fade[1] - fade[0]), 0.0, 1.0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("background", type=Path)
    parser.add_argument("frames", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--fade", nargs=2, type=float, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    timeline = json.loads(args.timeline.read_text(encoding="utf-8"))
    background = np.asarray(Image.open(args.background).convert("RGB").resize((W, H)), dtype=np.float32) / 255.0
    character = character_frames(args.frames)
    writers = {name: open_writer(args.out / f"led_{name}.mp4") for name in ("with", "without", "fade")}
    for index, gain in enumerate(gains(timeline)):
        color, alpha = character[index % len(character)]
        plain = background * gain
        lit = color * max(gain, 0.0) ** 0.5
        strengths = {"with": 1.0 if gain > 0 else 0.0, "without": 0.0,
                     "fade": fade_alpha(index / FPS, args.fade) if gain > 0 else 0.0}
        for name, writer in writers.items():
            mix = plain * (1 - alpha * strengths[name]) + lit * strengths[name]
            writer.stdin.write((mix.clip(0, 1) * 255).astype(np.uint8).tobytes())
    for writer in writers.values():
        writer.stdin.close()
        if writer.wait() != 0:
            raise RuntimeError("映像を書けない")
    print("wrote", args.out)


if __name__ == "__main__":
    main()
