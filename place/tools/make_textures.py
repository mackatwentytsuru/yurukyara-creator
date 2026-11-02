"""部屋に貼る素材(つなぎ目のない画像)を、コードだけで描く。外の画像は使わない(この期間に新しく書いた物)。
  python place/tools/make_textures.py            → place/assets/textures/*.png
どれも 1 枚が約 1 m 四方(stylize_room.py が m 単位で貼る)。ノイズは、端がつながるように周期つきで作る。
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "assets" / "textures"
SIZE = 512
RNG = np.random.default_rng(20261102)


def periodic_noise(h, w, cells_y, cells_x):
    """周期つきの値ノイズ(余弦補間)。0〜1。"""
    grid = RNG.random((cells_y, cells_x))
    ys = np.linspace(0, cells_y, h, endpoint=False)
    xs = np.linspace(0, cells_x, w, endpoint=False)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    fy = (1 - np.cos((ys - y0) * np.pi)) / 2
    fx = (1 - np.cos((xs - x0) * np.pi)) / 2
    y1 = (y0 + 1) % cells_y
    x1 = (x0 + 1) % cells_x
    g00 = grid[np.ix_(y0, x0)]
    g01 = grid[np.ix_(y0, x1)]
    g10 = grid[np.ix_(y1, x0)]
    g11 = grid[np.ix_(y1, x1)]
    top = g00 * (1 - fx)[None, :] + g01 * fx[None, :]
    bot = g10 * (1 - fx)[None, :] + g11 * fx[None, :]
    return top * (1 - fy)[:, None] + bot * fy[:, None]


def fbm(h, w, base_y, base_x, octaves=4):
    total = np.zeros((h, w))
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * periodic_noise(h, w, base_y * 2**o, base_x * 2**o)
        norm += amp
        amp *= 0.5
    return total / norm


def to_image(rgb):
    return Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8), "RGB")


def tint(base, light, gain=0.8):
    """基本色 base(0〜1 の RGB)に、明るさのむら light(0〜1)を掛ける。gain が大きいほどむらが強い。"""
    return np.array(base)[None, None, :] * (1 - gain / 2 + gain * light)[:, :, None]


def wood(plank_count, base, seed_shift=0.0):
    """縦に木目が流れる板。plank_count 枚の板が横に並ぶ。"""
    h = w = SIZE
    grain = fbm(h, w, 2, 24, octaves=4)  # 縦に細長いむら
    rings = 0.5 + 0.5 * np.sin((grain * 14 + seed_shift) * np.pi)
    light = 0.55 * grain + 0.25 * rings
    img = tint(base, light)
    # 板ごとの明るさと、板の継ぎ目の細い暗い線
    plank_w = w // plank_count
    for i in range(plank_count):
        shade = 0.88 + 0.24 * RNG.random()
        img[:, i * plank_w:(i + 1) * plank_w] *= shade
        img[:, i * plank_w:i * plank_w + 2] *= 0.55
    return to_image(img)


def plaster(base, strength=0.16):
    light = fbm(SIZE, SIZE, 6, 6, octaves=5)
    fine = RNG.random((SIZE, SIZE))
    return to_image(tint(base, 0.85 * light + 0.15 * fine, gain=strength))


def fabric(base):
    h = w = SIZE
    weave = 0.5 + 0.5 * np.sin(np.arange(w) * 2 * np.pi / 4)[None, :] * np.sin(np.arange(h) * 2 * np.pi / 4)[:, None]
    light = 0.7 * fbm(h, w, 8, 8, octaves=3) + 0.3 * weave
    return to_image(tint(base, light, gain=0.45))


def glass(base):
    light = fbm(SIZE, SIZE, 3, 3, octaves=2)
    return to_image(tint(base, 0.4 + 0.6 * light, gain=0.25))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    items = {
        "floor_wood": wood(6, (0.62, 0.45, 0.30)),
        "wall_plaster": plaster((0.90, 0.88, 0.84)),
        "ceiling_plaster": plaster((0.94, 0.94, 0.93), 0.08),
        "door_wood": wood(1, (0.45, 0.30, 0.20), 1.7),
        "object_wood": wood(3, (0.50, 0.36, 0.24), 3.1),
        "fabric": fabric((0.42, 0.50, 0.62)),
        "glass": glass((0.72, 0.84, 0.92)),
        "neutral": plaster((0.80, 0.80, 0.82), 0.10),
    }
    for name, img in items.items():
        img.save(OUT / f"{name}.png", optimize=True)
        print("書いた:", OUT / f"{name}.png")


if __name__ == "__main__":
    main()
