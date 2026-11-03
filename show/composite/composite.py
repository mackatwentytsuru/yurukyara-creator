"""実写にキャラを重ねる。素材は同じカメラで撮った 5 本の連番。

  with / without … キャラあり・なしのステージ(色)
  matte          … 真っ黒の中の真っ白のキャラ(透明)
  shadow_with / shadow_without … 灰色の床(有り無しの比が床の影)

式: 出力 = (with − (1−α)·without) + (1−α)·(実写·影 + 映り込み·(with − without))
    前の項は、ステージの色を抜いたキャラの色。後の項は、キャラの後ろの実写に影を掛け、床の映り込みの差を足した物。

実写にレンズの歪みがあるときは --stmap を渡す。色・透明・影の全部を、実写と同じ歪みにしてから重ねる。

--exit 始め 終わり(コマ)を渡すと、その間はキャラが足から順に現れる(LED の中のキャラは同じ秒に足から消える)。

使い方: python composite.py <連番の親フォルダ> <実写の動画> <出力の連番フォルダ> [--first コマ] [--last コマ] [--stmap stmap.npy] [--exit 始 終]
"""
import argparse
import subprocess
from pathlib import Path

import cv2
import numpy as np

GAMMA = 2.2
MIN_FLOOR = 0.02  # 灰色の床の明るさ(直線)がこれより暗い所は影を計算しない
SHADOW_BLUR_SIGMA = 1.2
SHADOW_STRENGTH = 0.85
REFLECTION_STRENGTH = 0.65  # キャラの床の映り込み。本物の床が光らないなら下げる
REFLECTION_FADE = 0.16  # 足から離れると消える長さ(キャラの身長に対する割合)
RIM_GAIN = 0.9  # LED の光がキャラの縁に回る強さ(直線)
CONTACT_SHADOW = 0.62  # 足が床に着く所の影の濃さ
RIM_BLUR = 0.018  # 縁の幅(絵の高さに対する割合)
AMBIENT = 0.35  # LED の色がキャラ全体に乗る割合
LED_PROBE = (64, 14)
EXIT_FADE_FROM = 0.45  # compose_led.py と同じ値
EXIT_GLOW_BGR = (0.40, 0.42, 0.16)  # 現れる境目の光
PASSES = {"with": "Comp_BeautyWith", "without": "Comp_BeautyWithout", "matte": "Comp_MatteChar",
          "shadow_with": "Comp_ShadowWith", "shadow_without": "Comp_ShadowWithout"}


def read(root, name, index, table=None, crop=None):
    path = root / PASSES[name] / f"f.{index:04d}.png"
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(path)
    if table is not None:
        image = cv2.remap(image, table[..., 0], table[..., 1], cv2.INTER_LINEAR)
    elif crop is not None:
        width, height = crop
        x0, y0 = (image.shape[1] - width) // 2, (image.shape[0] - height) // 2
        image = image[y0:y0 + height, x0:x0 + width]
    return image.astype(np.float32) / 255.0


def shadow_ratio(with_shadow, without_shadow):
    """床の暗くなった割合(直線の明るさの比。1 で影なし)。"""
    a = with_shadow.mean(axis=2) ** GAMMA
    b = without_shadow.mean(axis=2) ** GAMMA
    ratio = np.where(b > MIN_FLOOR, np.clip(a / np.maximum(b, 1e-4), 0.0, 1.0), 1.0)
    ratio = cv2.GaussianBlur(ratio, (0, 0), SHADOW_BLUR_SIGMA)
    return 1.0 - SHADOW_STRENGTH * (1.0 - ratio)


def exit_mask(alpha, progress):
    """足から順に現れる割合と、境目の光。progress が 1 なら全部。"""
    rows = np.where(alpha.max(axis=1) > 0.5)[0]
    if progress >= 1.0 or rows.size == 0:
        return np.ones_like(alpha), np.zeros_like(alpha)
    top, bottom = rows[0] - 4.0, rows[-1] + 4.0
    front = bottom - (bottom - top) * progress ** 1.25
    ys = np.arange(alpha.shape[0], dtype=np.float32)[:, None, None]
    feather = max(2.0, (bottom - top) * 0.05)
    keep = np.clip((ys - front) / feather + 0.5, 0.0, 1.0)
    keep = keep * keep * (3.0 - 2.0 * keep)
    fade = float(np.clip((progress - EXIT_FADE_FROM) / (1.0 - EXIT_FADE_FROM), 0.0, 1.0))  # LED のキャラが薄くなる分、上半身も現れる
    fade = fade * fade * (3.0 - 2.0 * fade)
    keep = 1.0 - (1.0 - keep) * (1.0 - fade)
    return keep, np.exp(-((ys - front) / (feather * 1.2)) ** 2)


class LedLight:
    """LED の映像から、左右の面の色を読む(後ろから当たる光)。全編の秒に合わせて順に読む。"""

    def __init__(self, path, start_frame):
        self.size = LED_PROBE[0] * LED_PROBE[1] * 3
        self.process = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-ss", f"{start_frame / 30.0:.4f}", "-i", str(path), "-vf",
             f"scale={LED_PROBE[0]}:{LED_PROBE[1]}:flags=area", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
            stdout=subprocess.PIPE, stdin=subprocess.DEVNULL)

    def next(self):
        raw = self.process.stdout.read(self.size)
        if len(raw) < self.size:
            return None
        image = np.frombuffer(raw, np.uint8).reshape(LED_PROBE[1], LED_PROBE[0], 3).astype(np.float32) / 255.0
        middle = LED_PROBE[0] * 2159 // 5680  # 中央の面の中心の左と右
        return image[:, :middle].mean(axis=(0, 1)) ** GAMMA, image[:, middle:].mean(axis=(0, 1)) ** GAMMA


def rim_light(character, alpha, colors):
    """キャラの縁へ、左から左の色、右から右の色を回す。全体にも少しだけ色を乗せる。"""
    rows = np.where(alpha.max(axis=1) > 0.5)[0]
    cols = np.where(alpha.max(axis=0) > 0.5)[0]
    if rows.size == 0 or cols.size == 0:
        return character
    left, right = colors
    sigma = max(1.0, np.ptp(rows) * RIM_BLUR)
    edge = np.clip(alpha[..., 0] - cv2.GaussianBlur(alpha[..., 0], (0, 0), sigma), 0.0, 1.0) * 2.0
    width = np.arange(alpha.shape[1], dtype=np.float32)
    side = np.clip((width - cols[0]) / max(1.0, np.ptp(cols)), 0.0, 1.0)[None, :, None]
    # 面の平均は青緑とピンクが混ざって灰色に寄る。色の差だけを強める
    left = np.maximum(left - left.min() * 0.75, 0.0)
    right = np.maximum(right - right.min() * 0.75, 0.0)
    hue = left * (1.0 - side) + right * side
    linear = np.clip(character, 0.0, 1.0) ** GAMMA
    linear = linear * (1.0 - AMBIENT * 0.5 + AMBIENT * hue / max(float(hue.mean()), 0.03) * 0.5)
    power = min(1.0, float(hue.mean()) * 60.0)  # LED が暗いときは回さない
    linear = linear + edge[..., None] * hue / max(float(hue.max()), 1e-3) * RIM_GAIN * power
    return np.clip(linear, 0.0, 1.0) ** (1.0 / GAMMA)


def contact_shadow(alpha):
    """足元の接地の影。キャラの一番下の幅から決める。戻りは床の明るさに掛ける割合。"""
    rows = np.where(alpha.max(axis=1) > 0.5)[0]
    if rows.size == 0:
        return np.ones_like(alpha)
    bottom, tall = rows[-1], max(1.0, float(np.ptp(rows)))
    near_foot = int(max(rows[0], bottom - tall * 0.05))
    cols = np.where(alpha[near_foot:bottom + 1].max(axis=0) > 0.5)[0]
    if cols.size == 0:
        return np.ones_like(alpha)
    middle, half = (cols[0] + cols[-1]) / 2.0, max(4.0, np.ptp(cols) * 0.75)
    ys, xs = np.mgrid[0:alpha.shape[0], 0:alpha.shape[1]].astype(np.float32)
    spot = np.exp(-(((xs - middle) / half) ** 2 + ((ys - bottom - tall * 0.004) / (tall * 0.02)) ** 2))
    return (1.0 - CONTACT_SHADOW * spot)[..., None]


def reflection_fade(alpha):
    """映り込みは足元だけ。足から離れると消す。"""
    rows = np.where(alpha.max(axis=1) > 0.5)[0]
    if rows.size == 0:
        return 1.0
    distance = np.arange(alpha.shape[0], dtype=np.float32) - rows[-1]
    return np.exp(-np.maximum(distance, 0.0) / (max(1.0, float(np.ptp(rows))) * REFLECTION_FADE))[:, None, None]


def lift_up(image, pixels):
    """絵を上へずらす(小数の画素)。"""
    matrix = np.float32([[1, 0, 0], [0, 1, -pixels]])
    return cv2.warpAffine(image, matrix, (image.shape[1], image.shape[0]), flags=cv2.INTER_LINEAR)


def compose(plate, frames, progress=1.0, led_colors=None, lift=0.0):
    """lift: キャラを上へずらす画素。LED の足は床より少し高いので、出る間は合わせ、着地で 0 にする。"""
    alpha = frames["matte"].mean(axis=2, keepdims=True)
    lifted = lift_up(alpha, lift)[..., None] if lift > 0.0 else alpha
    keep, glow = exit_mask(lifted, progress)
    shadow = shadow_ratio(frames["shadow_with"], frames["shadow_without"])[..., None]
    shadow = 1.0 - (1.0 - shadow * contact_shadow(alpha)) * progress
    # キャラの外の差は床の映り込みなので、色には入れない(下の reflection で足す)
    character = np.clip(frames["with"] - (1.0 - alpha) * frames["without"], 0.0, 1.0) * np.clip(alpha * 8.0, 0.0, 1.0)
    if led_colors is not None:
        character = rim_light(character, alpha, led_colors)
    if lift > 0.0:
        character = lift_up(character, lift)
    character = character * keep
    glow = glow * lifted
    alpha = lifted * keep
    shaded_plate = (plate ** GAMMA * shadow) ** (1.0 / GAMMA)
    reflection = REFLECTION_STRENGTH * (frames["with"] - frames["without"]) * progress * reflection_fade(alpha)
    light = glow * np.array(EXIT_GLOW_BGR, dtype=np.float32)
    return np.clip(character + (1.0 - alpha) * (shaded_plate + reflection) + light, 0.0, 1.0)


def plate_reader(path, width, height, first):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{first / 30.0:.4f}", "-i", str(path), "-f", "rawvideo",
                             "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE, stdin=subprocess.DEVNULL,
                            bufsize=width * height * 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("plate", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--first", type=int, default=0)
    parser.add_argument("--last", type=int, default=600)
    parser.add_argument("--stmap", type=Path, help="make_stmap.py の stmap.npy")
    parser.add_argument("--crop-only", nargs=2, type=int, metavar=("W", "H"),
                        help="歪みをかけず、広く描いた絵の真ん中を切るだけ(歪みなしとの比べ用)")
    parser.add_argument("--led-video", type=Path, help="LED の映像(全編の秒)。色をキャラの縁へ回す")
    parser.add_argument("--led-start", type=int, default=0, help="--first のコマに当たる、LED の映像のコマ(30p)")
    parser.add_argument("--exit-lift", type=float, default=0.0, help="出る間、キャラを上へずらす画素(LED の足と合わせる)")
    parser.add_argument("--exit-land", type=int, help="ずらしが 0 になるコマ(着地)")
    parser.add_argument("--exit", nargs=2, type=int, metavar=("FIRST", "LAST"), help="足から順に現れるコマの範囲")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    table = np.load(args.stmap) if args.stmap else None
    sample = read(args.root, "with", args.first, table, args.crop_only)
    height, width = sample.shape[:2]
    reader = plate_reader(args.plate, width, height, args.first)
    led = LedLight(args.led_video, args.led_start) if args.led_video else None
    for index in range(args.first, args.last):
        raw = reader.stdout.read(width * height * 3)
        if len(raw) < width * height * 3:
            raise RuntimeError(f"実写が {index} コマで終わった")
        plate = np.frombuffer(raw, np.uint8).reshape(height, width, 3).astype(np.float32) / 255.0
        frames = {name: read(args.root, name, index, table, args.crop_only) for name in PASSES}
        progress = 1.0
        if args.exit:
            progress = float(np.clip((index - args.exit[0]) / max(1, args.exit[1] - args.exit[0]), 0.0, 1.0))
        lift = 0.0
        if args.exit and args.exit_lift > 0.0:
            fall = np.clip((index - args.exit[0]) / max(1, args.exit_land - args.exit[0]), 0.0, 1.0)
            lift = float(args.exit_lift * (1.0 - fall * fall))  # だんだん速く落ちて、着地で 0
        image = compose(plate, frames, progress, led.next() if led else None, lift)
        cv2.imwrite(str(args.out / f"f.{index:04d}.png"), (image * 255.0 + 0.5).astype(np.uint8))
    reader.kill()
    print("wrote", args.out)


if __name__ == "__main__":
    main()
