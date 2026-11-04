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
import json
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
RIM_GAIN = 0.32  # LED の光がキャラの縁に回る強さ(直線)
CONTACT_SHADOW = 0.84  # 足が床に着く所の影の濃さ(直線。sRGB で約 40% 暗い)
LAND_IMPACT = 0.1
FOOT_NEAR_CM = 6.0  # 足がこの高さ(cm)上がると、靴の下の影が 1/e に薄れる
GRADE_GAIN = 0.76  # キャラを背景になじませる明るさ(直線)
GRADE_SATURATION = 0.88  # 同じ、彩度
SOFT_SIGMA = 0.7  # 色と透明を少しぼかす画素(ギザつきを減らす。実写の甘さに近づける)
EDGE_CHOKE = 0.12  # 透明の、これより薄い所を捨てる(明るい縁を減らす)
LINE_WIDTH = 0.012  # 現れる境目の光の線(身長に対する、ガウスの幅)
RIM_BLUR = 0.018  # 縁の幅(絵の高さに対する割合)
AMBIENT = 0.35  # LED の色がキャラ全体に乗る割合
LED_PROBE = (64, 14)
EXIT_GLOW_BGR = (0.55, 0.55, 0.30)  # 現れる境目の光
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
    top, bottom = rows[0] - 2.0, rows[-1] + 2.0
    front = bottom - (bottom - top) * progress
    ys = np.arange(alpha.shape[0], dtype=np.float32)[:, None, None]
    width = max(1.0, (bottom - top) * LINE_WIDTH)
    keep = np.clip((ys - front) / width + 0.5, 0.0, 1.0)
    keep = keep * keep * (3.0 - 2.0 * keep)
    return keep, np.exp(-((ys - front) / width) ** 2)


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


def contact_shadow(alpha, air=0.0):
    """靴の真下の短く濃い影。キャラの一番下の幅から決める。戻りは床の明るさに掛ける割合。
    air: 宙にいる割合(0 着地、1 いちばん高い)。高いほど薄く広い。"""
    rows = np.where(alpha.max(axis=1) > 0.5)[0]
    if rows.size == 0:
        return np.ones_like(alpha)
    bottom, tall = rows[-1], max(1.0, float(np.ptp(rows)))
    near_foot = int(max(rows[0], bottom - tall * 0.03))
    cols = np.where(alpha[near_foot:bottom + 1].max(axis=0) > 0.5)[0]
    if cols.size == 0:
        return np.ones_like(alpha)
    middle, half = (cols[0] + cols[-1]) / 2.0, max(8.0, np.ptp(cols) * (0.8 + 0.6 * air) + 3.0)
    ys, xs = np.mgrid[0:alpha.shape[0], 0:alpha.shape[1]].astype(np.float32)
    spread = max(5.0, tall * (0.022 + 0.02 * air))
    spot = np.exp(-(((xs - middle) / half) ** 4 + ((ys - bottom - tall * 0.008 - 1.0) / spread) ** 2))
    return (1.0 - CONTACT_SHADOW * (1.0 - 0.75 * air) * spot)[..., None]


def reflection_fade(alpha):
    """映り込みは足元だけ。足から離れると消す。"""
    rows = np.where(alpha.max(axis=1) > 0.5)[0]
    if rows.size == 0:
        return 1.0
    tall = max(1.0, float(np.ptp(rows)))
    distance = np.maximum(np.arange(alpha.shape[0], dtype=np.float32) - rows[-1], 0.0)
    # 靴のすぐ下は影の中なので、映り込みは少し下から始める
    start = 1.0 - np.exp(-((distance / max(3.0, tall * 0.03)) ** 2))
    return (start * np.exp(-distance / (tall * REFLECTION_FADE)))[:, None, None]


def lift_up(image, pixels):
    """絵を上へずらす(小数の画素)。"""
    matrix = np.float32([[1, 0, 0], [0, 1, -pixels]])
    return cv2.warpAffine(image, matrix, (image.shape[1], image.shape[0]), flags=cv2.INTER_LINEAR)


def grade(character):
    """舞台のキャラを背景になじませる。かぶせ済みの色のまま直線で下げる。"""
    linear = np.clip(character, 0.0, 1.0) ** GAMMA
    gray = linear.mean(axis=2, keepdims=True)
    linear = (gray + (linear - gray) * GRADE_SATURATION) * GRADE_GAIN
    return np.clip(linear, 0.0, 1.0) ** (1.0 / GAMMA)


def soften_edge(character, alpha):
    """色と透明を少しぼかし、縁の薄い所を削る(ギザつきと明るい縁を減らす)。"""
    color = cv2.GaussianBlur(character, (0, 0), SOFT_SIGMA)
    soft = cv2.GaussianBlur(alpha[..., 0], (0, 0), SOFT_SIGMA)[..., None]
    choked = np.clip((soft - EDGE_CHOKE) / (1.0 - EDGE_CHOKE), 0.0, 1.0)
    return color * np.minimum(choked / np.maximum(soft, 1e-3), 1.0), choked


def compose(plate, frames, progress=1.0, led_colors=None, lift=0.0, air=0.0, near=1.0):
    """lift: キャラを上へずらす画素。air: 宙にいる割合(0 で着地)。near: 足が床に近い割合(1 床、0 高い。靴の下の影を消す)。"""
    raw_alpha = frames["matte"].mean(axis=2, keepdims=True)
    character = np.clip(frames["with"] - (1.0 - raw_alpha) * frames["without"], 0.0, 1.0) * np.clip(raw_alpha * 8.0, 0.0, 1.0)
    character, alpha = soften_edge(character, raw_alpha)
    lifted = lift_up(alpha, lift)[..., None] if lift > 0.0 else alpha
    keep, glow = exit_mask(lifted, progress)
    shadow = shadow_ratio(frames["shadow_with"], frames["shadow_without"])[..., None]
    shadow = 1.0 - (1.0 - shadow) * progress
    contact = 1.0 - (1.0 - contact_shadow(raw_alpha, air)) * progress * near
    # キャラの外の差は床の映り込みなので、色には入れない(下の reflection で足す)
    character = grade(character)
    if led_colors is not None:
        character = rim_light(character, alpha, led_colors)
    if lift > 0.0:
        character = lift_up(character, lift)
    character = character * keep
    alpha = lifted * keep
    shaded_plate = (plate ** GAMMA * shadow) ** (1.0 / GAMMA)
    reflection = REFLECTION_STRENGTH * np.clip(frames["with"] - frames["without"], -1.0, 1.0) * progress * reflection_fade(raw_alpha)
    reflection = reflection * (1.0 - raw_alpha)  # キャラの内側の差は色なので除く
    floor = np.clip(shaded_plate + reflection, 0.0, 1.0)
    floor = (floor ** GAMMA * contact) ** (1.0 / GAMMA)  # 靴の真下は映り込みごと暗くする
    light = glow * lifted * np.array(EXIT_GLOW_BGR, dtype=np.float32)
    return np.clip(character + (1.0 - alpha) * floor + light, 0.0, 1.0)


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
    parser.add_argument("--exit-hop", type=float, default=0.0, help="飛び出す弧の高さ(画素)")
    parser.add_argument("--stats", type=Path, help="コマごとの足の位置など(jsonl)")
    parser.add_argument("--exit", nargs=2, type=int, metavar=("FIRST", "LAST"), help="足から順に現れるコマの範囲")
    parser.add_argument("--foot-height", type=Path,
                        help="コマごとの足の床からの高さ(cm)の json {コマ: cm}。本物の跳びの間、靴の下の影を高さで消す(foot_heights.py)")
    args = parser.parse_args()
    heights = {int(k): float(v) for k, v in json.loads(args.foot_height.read_text(encoding="utf-8")).items()} if args.foot_height else {}
    args.out.mkdir(parents=True, exist_ok=True)
    table = np.load(args.stmap) if args.stmap else None
    sample = read(args.root, "with", args.first, table, args.crop_only)
    height, width = sample.shape[:2]
    reader = plate_reader(args.plate, width, height, args.first)
    led = LedLight(args.led_video, args.led_start) if args.led_video else None
    stats = open(args.stats, "w", encoding="utf-8") if args.stats else None
    for index in range(args.first, args.last):
        raw = reader.stdout.read(width * height * 3)
        if len(raw) < width * height * 3:
            raise RuntimeError(f"実写が {index} コマで終わった")
        plate = np.frombuffer(raw, np.uint8).reshape(height, width, 3).astype(np.float32) / 255.0
        frames = {name: read(args.root, name, index, table, args.crop_only) for name in PASSES}
        progress = 1.0
        if args.exit:
            progress = float(np.clip((index - args.exit[0]) / max(1, args.exit[1] - args.exit[0]), 0.0, 1.0))
        lift, air = 0.0, 0.0
        if args.exit and args.exit_lift > 0.0:
            u = float(np.clip((index - args.exit[0]) / max(1, args.exit_land - args.exit[0]), 0.0, 1.0))
            arc = 4.0 * u * (1.0 - u)  # 放物線。始めは LED の足の高さ、着地で 0
            lift = float(args.exit_lift * (1.0 - u) + args.exit_hop * arc)
            air = float(lift / max(args.exit_lift + args.exit_hop, 1.0))
            if index >= args.exit_land:  # 着いた直後は影が一段濃い(重さ)
                air = -LAND_IMPACT * float(np.exp(-(index - args.exit_land) / 5.0))
        near = float(np.exp(-max(heights.get(index, 0.0), 0.0) / FOOT_NEAR_CM))
        image = compose(plate, frames, progress, led.next() if led else None, lift, air, near)
        if stats:
            raw = frames["matte"].mean(axis=2)
            rows = np.where(raw.max(axis=1) > 0.5)[0]
            row = {"frame": index, "lift": round(lift, 2), "progress": round(progress, 3), "near": round(near, 3)}
            if rows.size:
                near = int(max(rows[0], rows[-1] - np.ptp(rows) * 0.03))
                cols = np.where(raw[near:rows[-1] + 1].max(axis=0) > 0.5)[0]
                row.update(foot_y=round(float(rows[-1]) - lift, 2), foot_x=round(float((cols[0] + cols[-1]) / 2.0), 2),
                           tall=int(np.ptp(rows)), foot_half=round(float(np.ptp(cols)) / 2.0, 1))
            stats.write(json.dumps(row) + "\n")
        cv2.imwrite(str(args.out / f"f.{index:04d}.png"), (image * 255.0 + 0.5).astype(np.uint8))
    reader.kill()
    print("wrote", args.out)


if __name__ == "__main__":
    main()
