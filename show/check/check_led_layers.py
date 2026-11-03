"""透明つきの層を明るい色に重ねて、縁を確かめる。前後の比べの絵も作る。

  python check_led_layers.py edges <straight の png> <出力の頭>   明るい 3 色に重ねた拡大の切り抜きと、縁の黒の数字
  python check_led_layers.py sheet --out <jpg> --before-char <png> --after-char <png> --before-mon <png> --after-left <png> --after-right <png>
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BRIGHT = {"黄": (240, 225, 70), "水色": (130, 230, 240), "白": (245, 245, 245)}
ZOOM = 4
CROP = 110  # 拡大する範囲の半分の大きさ
EDGE_DARK_MARGIN = 40.0
SHEET_WIDTH = 1800
LABEL_HEIGHT = 58  # 絵の幅の 3% 以上
FONT = "C:/Windows/Fonts/YuGothB.ttc"
BACK_TOP, BACK_BOTTOM = (22, 10, 26), (58, 14, 30)
MON_RECT_L = (27, 190, 608, 506)  # 3838 の絵の上の左のアップ(5680 の 40〜940 を 1.48 で割った位置)
MON_RECT_R = (2284, 190, 608, 506)
CHAR_CROP = (1459 - 230, 760, 1459 + 230, 1240)


def over(rgba, color):
    pixels = np.asarray(rgba.convert("RGBA"), dtype=np.float32)
    alpha = pixels[..., 3:4] / 255.0
    return pixels[..., :3] * alpha + np.array(color, dtype=np.float32) * (1.0 - alpha)


def edge_numbers(rgba, color):
    """半透明の縁の画素で、下の色より暗く、かつ近くの不透明の色の最も暗い値よりも暗いものを数える。"""
    pixels = np.asarray(rgba.convert("RGBA"), dtype=np.float32)
    alpha = pixels[..., 3]
    result = over(rgba, color).mean(axis=2)
    edge = (alpha > 8) & (alpha < 247)
    solid = alpha >= 247
    solid_value = np.where(solid, pixels[..., :3].mean(axis=2), 1e6)
    # 3x3 を 3 回で近く 7 画素の最小
    low = solid_value
    for _ in range(3):
        stacked = np.stack([np.roll(np.roll(low, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
        low = stacked.min(axis=0)
    limit = np.minimum(np.where(low > 1e5, 1e6, low), np.array(color, dtype=np.float32).mean())
    dark = edge & (result < limit - EDGE_DARK_MARGIN)
    return {"edge_pixels": int(edge.sum()), "dark_fringe_pixels": int(dark.sum())}


def edges(path, head):
    rgba = Image.open(path).convert("RGBA")
    alpha = np.asarray(rgba)[..., 3]
    ys, xs = np.where(alpha > 128)
    if not len(xs):
        raise SystemExit(f"キャラが写っていない: {path}")
    spots = {"髪": (int(xs.mean()), int(ys.min()) + (ys.max() - ys.min()) // 5), "スカート": (int(xs.mean()), int(ys.min()) + (ys.max() - ys.min()) * 2 // 3)}
    numbers, panels = {}, []
    for name, color in BRIGHT.items():
        numbers[name] = edge_numbers(rgba, color)
        picture = Image.fromarray(np.clip(over(rgba, color) + 0.5, 0, 255).astype(np.uint8))
        for spot, (cx, cy) in spots.items():
            # 縁が写るように、キャラの外側へずらす
            row = np.where(alpha[cy] > 128)[0]
            ex = int(row.min()) if len(row) else cx
            box = (ex - CROP, cy - CROP, ex + CROP, cy + CROP)
            panels.append(picture.crop(box).resize((CROP * 2 * ZOOM, CROP * 2 * ZOOM), Image.NEAREST))
    sheet = Image.new("RGB", (CROP * 2 * ZOOM * len(spots), CROP * 2 * ZOOM * len(BRIGHT)))
    for i, panel in enumerate(panels):
        sheet.paste(panel, ((i % len(spots)) * CROP * 2 * ZOOM, (i // len(spots)) * CROP * 2 * ZOOM))
    target = f"{head}.png"
    sheet.save(target)
    print(json.dumps({"file": target, "edge": numbers}, ensure_ascii=False))


def backdrop(size):
    w, h = size
    ramp = np.linspace(0.0, 1.0, h)[:, None, None]
    return np.broadcast_to(np.array(BACK_TOP) * (1 - ramp) + np.array(BACK_BOTTOM) * ramp, (h, w, 3)).astype(np.float32)


def on_back(rgba):
    pixels = np.asarray(rgba.convert("RGBA"), dtype=np.float32)
    alpha = pixels[..., 3:4] / 255.0
    out = pixels[..., :3] * alpha + backdrop(rgba.size) * (1.0 - alpha)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))


def label(sheet, text, xy, font):
    draw = ImageDraw.Draw(sheet)
    x, y = xy
    box = draw.textbbox((x, y), text, font=font)
    draw.rectangle((box[0] - 8, box[1] - 6, box[2] + 8, box[3] + 6), fill=(0, 0, 0))
    draw.text((x, y), text, font=font, fill=(255, 240, 120))


def sheet(args):
    before = Image.open(args.before_char).convert("RGB").crop(CHAR_CROP)
    after = on_back(Image.open(args.after_char).convert("RGBA")).crop(CHAR_CROP)
    mon = Image.open(args.before_mon).convert("RGB")
    def stretched(rect):
        x, y, w, h = rect
        return mon.crop((x, y, x + w, y + h)).resize((900, 506), Image.LANCZOS)
    left, right = on_back(Image.open(args.after_left)), on_back(Image.open(args.after_right))
    cell_h = 620
    char_w = int(before.width * cell_h / before.height)
    mon_w = (SHEET_WIDTH - char_w) // 2
    mon_h = int(mon_w * 506 / 900)
    font = ImageFont.truetype(FONT, 62)
    out = Image.new("RGB", (SHEET_WIDTH, cell_h * 2 + 12), (10, 10, 10))
    for row, (char, l, r, name) in enumerate(((before, stretched(MON_RECT_L), stretched(MON_RECT_R), "前"),
                                              (after, left, right, "後"))):
        y = row * (cell_h + 12)
        out.paste(char.resize((char_w, cell_h), Image.LANCZOS), (0, y))
        pad = (cell_h - mon_h) // 2
        out.paste(l.resize((mon_w, mon_h), Image.LANCZOS), (char_w, y + pad))
        out.paste(r.resize((mon_w, mon_h), Image.LANCZOS), (char_w + mon_w, y + pad))
        label(out, name, (16, y + 12), font)
        label(out, "左のアップ", (char_w + 16, y + 12), font)
        label(out, "右のアップ", (char_w + mon_w + 16, y + 12), font)
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    out.save(target, quality=92)
    print(target, out.size, "字の高さ", font.getbbox("前")[3] - font.getbbox("前")[1], "幅の 3%", SHEET_WIDTH * 0.03)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=("edges", "sheet"))
    parser.add_argument("paths", nargs="*")
    for name in ("out", "before-char", "after-char", "before-mon", "after-left", "after-right"):
        parser.add_argument(f"--{name}")
    args = parser.parse_args()
    if args.mode == "edges":
        edges(args.paths[0], args.paths[1])
    else:
        sheet(args)


if __name__ == "__main__":
    main()
