"""撮った層の連番の後始末。UE は要らない。

  python led_layers_post.py straight <元> <先>             透明つきの連番を、色と透明が別の絵(straight)にする
  python led_layers_post.py reflect <元> <先>              床の映り込み: 足の線から下で薄くする
  python led_layers_post.py shadow <元> <基準の png> <先>  灰色の床の絵と基準の比から、黒+透明の影にする
  python led_layers_post.py stats <先>                     透明の値の分布を出す(json)

MRQ の透明つき PNG は、色に透明がすでに掛かっている(黒の上に合成された形)。そのまま重ねると縁が黒くなるので割り戻す。
透明の値は直線の割合。重ねる側は直線の空間で混ぜるのが正しい(sRGB のまま混ぜても黒い縁は出ない)。
"""
import argparse
import json
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

WORKERS = 6
PNG_LEVEL = 1
FOOT_Y = 1198
REFLECT_GAIN = 0.45
REFLECT_FADE_PX = 36.0
SHADOW_GAIN = 0.6
SHADOW_BLUR_PX = 5
SHADOW_MIN_DIFF = 0.01
BIN_EDGES = [0, 1, 16, 64, 128, 192, 240, 255, 256]


def to_linear(values):
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def to_srgb(values):
    return np.where(values <= 0.0031308, values * 12.92, 1.055 * np.power(np.maximum(values, 1e-9), 1.0 / 2.4) - 0.055)


def straight(pixels):
    """MRQ の縁は、直線の値に透明が掛かった形で sRGB になっている(測定: 不透明 223 のとき透明 0.5 で 173)。直線で割り戻す。"""
    alpha = pixels[..., 3:4].astype(np.float32) / 255.0
    color = to_linear(pixels[..., :3].astype(np.float32) / 255.0)
    out = np.where(alpha > 2.0 / 255.0, np.minimum(color / np.maximum(alpha, 2.0 / 255.0), 1.0), 0.0)
    return np.dstack([np.clip(to_srgb(out) * 255.0 + 0.5, 0, 255).astype(np.uint8), pixels[..., 3]])


def do_straight(job):
    source, target = job
    pixels = np.asarray(Image.open(source).convert("RGBA"))
    Image.fromarray(straight(pixels), "RGBA").save(target, compress_level=PNG_LEVEL)


def do_reflect(job):
    source, target = job
    pixels = straight(np.asarray(Image.open(source).convert("RGBA")))
    rows = np.arange(pixels.shape[0], dtype=np.float32)
    fade = np.exp(-np.maximum(rows - FOOT_Y, 0.0) / REFLECT_FADE_PX) * REFLECT_GAIN * (rows >= FOOT_Y)
    out = pixels.copy()
    out[..., 3] = (pixels[..., 3] * fade[:, None] + 0.5).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(target, compress_level=PNG_LEVEL)


def do_shadow(job):
    source, reference, target = job
    now = to_linear(np.asarray(Image.open(source).convert("RGB"), dtype=np.float32) / 255.0).mean(axis=2)
    base = to_linear(np.asarray(Image.open(reference).convert("RGB"), dtype=np.float32) / 255.0).mean(axis=2)
    amount = np.where(base > SHADOW_MIN_DIFF, 1.0 - now / np.maximum(base, SHADOW_MIN_DIFF), 0.0)
    alpha = (np.clip(amount, 0.0, 1.0) * SHADOW_GAIN * 255.0 + 0.5).astype(np.uint8)
    out = np.zeros((*alpha.shape, 4), np.uint8)
    # カメラが床すれすれなので、影は細い線に写る。硬いと黒い線に見えるのでぼかす
    out[..., 3] = np.asarray(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(SHADOW_BLUR_PX)))
    Image.fromarray(out, "RGBA").save(target, compress_level=PNG_LEVEL)


def histogram(path):
    alpha = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    return np.histogram(alpha, bins=BIN_EDGES)[0]


def frames(folder):
    return sorted(Path(folder).glob("f.*.png"), key=lambda p: int(re.search(r"f\.(\d+)", p.name).group(1)))


def run(function, jobs):
    with ProcessPoolExecutor(WORKERS) as pool:
        list(pool.map(function, jobs, chunksize=4))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=("straight", "reflect", "shadow", "stats"))
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    if args.mode == "stats":
        with ProcessPoolExecutor(WORKERS) as pool:
            total = sum(pool.map(histogram, frames(args.paths[0]), chunksize=4))
        names = ["0", "1-15", "16-63", "64-127", "128-191", "192-239", "240-254", "255"]
        print(json.dumps({"frames": len(frames(args.paths[0])), "alpha_pixels": dict(zip(names, (int(v) for v in total)))}, ensure_ascii=False))
        return
    target = args.paths[-1]
    target.mkdir(parents=True, exist_ok=True)
    sources = frames(args.paths[0])
    if not sources:
        raise SystemExit(f"連番が無い: {args.paths[0]}")
    if args.mode == "shadow":
        run(do_shadow, [(p, args.paths[1], target / p.name) for p in sources])
    else:
        run(do_straight if args.mode == "straight" else do_reflect, [(p, target / p.name) for p in sources])
    print(args.mode, len(sources), "コマ", target)


if __name__ == "__main__":
    main()
