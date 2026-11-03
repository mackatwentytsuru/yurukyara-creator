"""LED の 1 本を重ねて作る: 背景 → 計算の効果 → キャラ → 左右のアップ。5680×1240 の ProRes か連番を出す。

例:
  python compose_led.py --timeline <timeline.json> --stage show/show_stage.json --start 54.8 --end 64 \\
      --bg plate.png --bg-center-src 0.5 --char-dir frames/ --char-key black --out master.mov --stats stats.jsonl

- 秒は全部 timeline と stage(と任意の cues)から読む。省くと LED にキャラがいる最初から最後まで。
- キャラは 3838×1240 を横 1.48 倍。ファイル名は f.<全編のコマ番号>.png。
- 左右のアップは monitor_rects の位置に等倍。枠と光る縁はここで描く。
"""
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audio_hits  # noqa: E402
import fx_plan  # noqa: E402
from fx_layers import FxRenderer, smooth  # noqa: E402
from fx_plan import CANVAS, led_plan  # noqa: E402

KNEE = 0.62  # 背景と効果の明るさの折れ点(直線)
CEILING = 0.84  # 背景と効果はここを超えない(sRGB で約 237)。全面の純白を作らない
MEAN_CAP = 105.0  # 平均の明るさの上限(sRGB、0〜255)。実写で白飛びさせない
WHITE_LEVEL = 254.0 / 255.0
LIMIT_DIV = 16
LUMA = (0.2126, 0.7152, 0.0722)
FRAME_THICK = 4.0
FRAME_GLOW = 20.0
FRAME_MARGIN = 72
READ_AHEAD = 4


def to_linear(x):
    return torch.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def to_srgb(x):
    x = x.clamp(0.0, 1.0)
    return torch.where(x <= 0.0031308, x * 12.92, 1.055 * x.clamp(min=1e-7) ** (1.0 / 2.4) - 0.055)


def knee(x):
    """折れ点より上をなめらかに圧縮する。色ごとにかける。"""
    room = CEILING - KNEE
    return torch.where(x <= KNEE, x, KNEE + room * (1.0 - torch.exp(-(x - KNEE).clamp(min=0.0) / room)))


def mean_luma(rgb):
    """sRGB の平均の明るさ(0〜255)。"""
    display = to_srgb(rgb)
    return float((display[0] * LUMA[0] + display[1] * LUMA[1] + display[2] * LUMA[2]).mean()) * 255.0


def limiter_scale(bg_small, fx_small, cap):
    """効果に掛ける倍率。平均が cap を超えないように、このコマだけから決める(なめらかで、状態を持たない)。"""
    if mean_luma(knee(bg_small + fx_small)) <= cap:
        return 1.0
    low, high = 0.0, 1.0
    for _ in range(7):
        middle = (low + high) / 2.0
        if mean_luma(knee(bg_small + fx_small * middle)) > cap:
            high = middle
        else:
            low = middle
    return low


class Background:
    """静止画か動画。--bg-center-src は、中央の面の中心が絵の真ん中にある仮の絵を x=2159 へ寄せるためだけに使う。"""

    def __init__(self, path, size, device, center_src=None, center_dst=2159.0, video_at=0.0, gain=1.0):
        self.size, self.device, self.gain = size, device, gain
        self.process = None
        self.last = None
        self.grid = self._warp_grid(size, center_src, center_dst) if center_src is not None else None
        self.black = torch.zeros(3, size[1], size[0], device=device)
        self.still = None
        if path is None:
            self.still = self.black
        elif Path(path).suffix.lower() in (".png", ".jpg", ".jpeg"):
            image = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if image is None:
                raise FileNotFoundError(path)
            self.still = self._prepare(torch.from_numpy(image[:, :, ::-1].copy()).to(device))
        else:
            command = ["ffmpeg", "-v", "error", "-ss", str(video_at), "-i", str(path), "-vf",
                       f"scale={size[0]}:{size[1]}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
            self.process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE)

    def _warp_grid(self, size, center_src, center_dst):
        """横だけを 2 つの直線で曲げる。左の部分と右の部分の倍率が変わる。"""
        center_dst_scaled = center_dst / CANVAS[0]
        xs = (torch.arange(size[0], device=self.device, dtype=torch.float32) + 0.5) / size[0]
        left = xs / center_dst_scaled * center_src
        right = center_src + (xs - center_dst_scaled) / (1.0 - center_dst_scaled) * (1.0 - center_src)
        source = torch.where(xs < center_dst_scaled, left, right) * 2.0 - 1.0
        ys = (torch.arange(size[1], device=self.device, dtype=torch.float32) + 0.5) / size[1] * 2.0 - 1.0
        v, u = torch.meshgrid(ys, source, indexing="ij")
        return torch.stack([u, v], dim=-1).unsqueeze(0)

    def _prepare(self, rgb8):
        image = rgb8.permute(2, 0, 1).float().unsqueeze(0) / 255.0
        if self.grid is not None:
            image = F.grid_sample(image, self.grid, mode="bicubic", padding_mode="border", align_corners=False)
        elif image.shape[-2:] != (self.size[1], self.size[0]):
            image = F.interpolate(image, size=(self.size[1], self.size[0]), mode="bicubic", align_corners=False)
        return to_linear(image[0].clamp(0.0, 1.0)) * self.gain

    def next(self):
        if self.still is not None:
            return self.still
        count = self.size[0] * self.size[1] * 3
        data = self.process.stdout.read(count)
        if len(data) < count:  # 動画が尽きたら最後のコマを保つ
            if self.last is None:
                raise RuntimeError("背景の動画からコマが読めません")
            return self.last
        array = np.frombuffer(data, dtype=np.uint8).reshape(self.size[1], self.size[0], 3)
        self.last = self._prepare(torch.from_numpy(array.copy()).to(self.device))
        return self.last

    def close(self):
        if self.process:
            self.process.kill()
            self.process.wait()


class Sequence:
    """f.<全編のコマ番号>.png の連番を先読みする。無いコマは None。"""

    def __init__(self, folder):
        self.folder = Path(folder) if folder else None
        self.pool = ThreadPoolExecutor(READ_AHEAD)
        self.pending = {}

    def _read(self, frame):
        path = self.folder / f"f.{frame:04d}.png"
        return cv2.imread(str(path), cv2.IMREAD_UNCHANGED) if path.exists() else None

    def get(self, frame):
        if self.folder is None:
            return None
        for ahead in range(READ_AHEAD):
            if frame + ahead not in self.pending:
                self.pending[frame + ahead] = self.pool.submit(self._read, frame + ahead)
        return self.pending.pop(frame).result()


def rgba_tensor(image, device):
    """BGR(A) の 8bit か 16bit を 4 × 高さ × 幅 の 0〜1 へ。"""
    peak = 65535.0 if image.dtype == np.uint16 else 255.0
    if image.ndim == 2:
        image = np.stack([image, image, image], axis=2)
    rgb = torch.from_numpy(image[:, :, 2::-1].astype(np.float32).copy()).to(device) / peak
    if image.shape[2] == 4:
        alpha = torch.from_numpy(image[:, :, 3].astype(np.float32).copy()).to(device) / peak
    else:
        alpha = torch.ones_like(rgb[:, :, 0])
    return rgb.permute(2, 0, 1), alpha


def character_layer(image, size, mode, tint, device):
    """キャラの層を原寸へ伸ばす。戻りは直線の色(かぶせ済み)と透明。mode=black は黒地の測定用の連番。"""
    rgb, alpha = rgba_tensor(image, device)
    if mode == "black":
        alpha = rgb.max(dim=0).values
        color = torch.tensor(tint, dtype=torch.float32, device=device).view(3, 1, 1)
        linear = to_linear(color) * alpha
    else:
        linear = to_linear(rgb) * alpha
    stack = torch.cat([linear, alpha.unsqueeze(0)], dim=0).unsqueeze(0)
    stack = F.interpolate(stack, size=(size[1], size[0]), mode="bicubic", align_corners=False)[0].clamp(0.0, 1.0)
    return stack[:3], stack[3]


def monitor_state(stage, start, end, fps):
    return {row["frame"]: row for row in led_plan.monitor_frames(stage, start, end, fps)}


def draw_monitor(canvas, rect, state, image, kick, scale, device, is_right):
    """アップを 1 枚置く。縦に開く。金の細い枠と光る縁は計算で描く。"""
    x, y, w, h = [v * scale for v in rect]
    margin = FRAME_MARGIN * scale
    left, top = int(x - margin), int(y - margin)
    right, bottom = int(x + w + margin), int(y + h + margin)
    left, top, right, bottom = max(left, 0), max(top, 0), min(right, canvas.shape[2]), min(bottom, canvas.shape[1])
    middle_x, middle_y = x + w / 2.0, y + h / 2.0
    half_w, half_h = w / 2.0, max(1.0, h / 2.0 * state["open"])
    ys = torch.arange(top, bottom, device=device, dtype=torch.float32) + 0.5
    xs = torch.arange(left, right, device=device, dtype=torch.float32) + 0.5
    grid_y, grid_x = torch.meshgrid(ys, xs, indexing="ij")
    dx, dy = (grid_x - middle_x).abs() - half_w, (grid_y - middle_y).abs() - half_h
    distance = torch.hypot(dx.clamp(min=0.0), dy.clamp(min=0.0)) + torch.minimum(torch.maximum(dx, dy), torch.zeros_like(dx))
    region = canvas[:, top:bottom, left:right]
    inside = (0.5 - distance).clamp(0.0, 1.0)
    glass = torch.tensor((0.004, 0.004, 0.007), device=device).view(3, 1, 1)
    region = region * (1.0 - inside) + glass * inside
    if image is not None:
        region = _place_up_close(region, image, x, y, w, h, half_h, left, top, scale, device, inside)
    gold = torch.tensor((1.0, 0.66, 0.26), device=device).view(3, 1, 1)
    glow_size = FRAME_GLOW * scale
    edge = (1.0 - (distance.abs() / (FRAME_THICK * scale / 2.0)) ** 2).clamp(0.0, 1.0)
    glow = torch.exp(-(distance.clamp(min=0.0) / glow_size) ** 2) * (distance > 0)
    strength = state["open"] * (0.55 + 0.25 * kick + state["flash"])
    canvas[:, top:bottom, left:right] = region + gold * (edge * 0.6 + glow * 0.16) * strength


def _place_up_close(region, image, x, y, w, h, half_h, left, top, scale, device, inside):
    """アップの絵を、開いた分だけ見せる(縦の真ん中から開く)。"""
    rgb, alpha = rgba_tensor(image, device)
    linear = to_linear(rgb)
    target_w, target_h = int(round(w)), int(round(h))
    if linear.shape[-2:] != (target_h, target_w):
        stack = torch.cat([linear, alpha.unsqueeze(0)], dim=0).unsqueeze(0)
        stack = F.interpolate(stack, size=(target_h, target_w), mode="bilinear", align_corners=False)[0]
        linear, alpha = stack[:3], stack[3]
    x0, y0 = int(round(x)) - left, int(round(y)) - top
    rows, cols = region.shape[1:]
    slot_y0, slot_y1 = max(y0, 0), min(y0 + target_h, rows)
    slot_x0, slot_x1 = max(x0, 0), min(x0 + target_w, cols)
    seen = inside[slot_y0:slot_y1, slot_x0:slot_x1] * alpha[slot_y0 - y0:slot_y1 - y0, slot_x0 - x0:slot_x1 - x0]
    picture = linear[:, slot_y0 - y0:slot_y1 - y0, slot_x0 - x0:slot_x1 - x0]
    out = region.clone()
    out[:, slot_y0:slot_y1, slot_x0:slot_x1] = region[:, slot_y0:slot_y1, slot_x0:slot_x1] * (1.0 - seen) + picture * seen
    return out


def make_dither(device, shape):
    """帯の段を消す揺らぎ(三角分布、1 段ぶん)。暗いなめらかな面に必要。"""
    generator = torch.Generator(device="cpu").manual_seed(7)
    tile = torch.rand(1, 512, 512, generator=generator) - torch.rand(1, 512, 512, generator=generator)
    rows, cols = shape
    repeat = tile.repeat(1, rows // 512 + 2, cols // 512 + 2)
    return repeat.to(device) / 255.0


def open_writer(out, size, fps, first_frame):
    if "%" in str(out):
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        tail = ["-start_number", str(first_frame), str(out)]
    else:
        tail = ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0", "-color_primaries", "bt709",
                "-color_trc", "bt709", "-colorspace", "bt709", "-vf", "scale=in_range=pc:out_color_matrix=bt709:out_range=tv",
                "-map_metadata", "-1", str(out)]
    command = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{size[0]}x{size[1]}",
               "-r", str(fps), "-i", "-"] + tail
    return subprocess.Popen(command, stdin=subprocess.PIPE)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--start", type=float, help="始めの秒。省くと LED にキャラがいる最初")
    parser.add_argument("--end", type=float, help="終わりの秒。省くと LED にキャラがいる最後")
    parser.add_argument("--bg", help="背景の静止画か動画。省くと黒")
    parser.add_argument("--bg-at", type=float, default=0.0, help="背景の動画の、始めのコマの秒")
    parser.add_argument("--bg-center-src", type=float, help="仮の絵の中心の割合(0〜1)を x=2159 へ寄せる")
    parser.add_argument("--char-dir", help="キャラの連番のフォルダ")
    parser.add_argument("--char-key", choices=("alpha", "black"), default="alpha")
    parser.add_argument("--char-tint", default="0.55,0.42,0.50", help="黒地の連番を塗る色(sRGB)")
    parser.add_argument("--mon-left", help="左のアップの連番のフォルダ")
    parser.add_argument("--mon-right", help="右のアップの連番のフォルダ。省くと左と同じ")
    parser.add_argument("--no-fx", action="store_true", help="効果を切る(比べる用)")
    parser.add_argument("--cues", help="秒の追加(電球など)。fx_plan.py の先頭の説明を見る")
    parser.add_argument("--bulbs", help="電球の位置 [{x, y}, ...]")
    parser.add_argument("--hits", help="打点 [{t, band, strength}, ...]。省くと音から取る")
    parser.add_argument("--mean-cap", type=float, default=MEAN_CAP)
    parser.add_argument("--scale", type=float, default=1.0, help="試しの縮小(座標は 5680 のまま)")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--out", help=".mov(ProRes)か、%%04d の入った png の連番")
    parser.add_argument("--stats", help="コマごとの記録(jsonl)")
    parser.add_argument("--still", type=float, nargs="*", help="この秒だけ png を --still-dir へ書いて終わる")
    parser.add_argument("--still-dir")
    return parser.parse_args()


def frame_stats(frame, final, char_alpha, elapsed):
    display = to_srgb(final)
    luma = display[0] * LUMA[0] + display[1] * LUMA[1] + display[2] * LUMA[2]
    white = (display.min(dim=0).values >= WHITE_LEVEL)
    row = {"frame": frame, "mean": round(float(luma.mean()) * 255.0, 2), "white_pct": round(float(white.float().mean()) * 100.0, 4),
           "peak": round(float(display.max()) * 255.0, 1)}
    if char_alpha is not None:
        row["white_pct_no_char"] = round(float((white & (char_alpha < 0.02)).float().mean()) * 100.0, 4)
    width = final.shape[2]
    # A と C は左右のスクリーンに隠れない所だけを測る
    zones = {"A": (945, 1279), "B_side": (1279, 1729), "B_side2": (2589, 3039), "C": (4290, 5680)}
    for name, (a, b) in zones.items():
        a, b = int(a * width / CANVAS[0]), int(b * width / CANVAS[0])
        row[name] = round(float(luma[:, a:b].mean()) * 255.0, 3)
    low = int(final.shape[1] * 0.85)
    row["bottom"] = round(float(luma[low:].mean()) * 255.0, 3)
    row["sec"] = round(elapsed, 4)
    return row


class Composer:
    def __init__(self, args):
        self.args = args
        self.device = args.device if torch.cuda.is_available() or args.device == "cpu" else "cpu"
        hits, self.hits_source = audio_hits.load_hits(args.timeline, args.hits)
        self.plan = fx_plan.load_plan(args.timeline, args.stage, hits, args.cues, args.bulbs)
        self.size = (int(round(CANVAS[0] * args.scale)), int(round(CANVAS[1] * args.scale)))
        self.fx = None if args.no_fx else FxRenderer(self.plan, args.scale, self.device)
        self.background = Background(args.bg, self.size, self.device, args.bg_center_src, self.plan.center_x, args.bg_at)
        self.character = Sequence(args.char_dir)
        self.mon_left = Sequence(args.mon_left)
        self.mon_right = Sequence(args.mon_right) if args.mon_right else None
        self.tint = [float(v) for v in args.char_tint.split(",")]
        self.dither = make_dither(self.device, (self.size[1], self.size[0]))
        start, end = led_plan.show_range(self.plan.timeline, self.plan.stage)
        self.start = args.start if args.start is not None else start
        self.end = args.end if args.end is not None else end
        self.fps = self.plan.fps
        self.monitors = monitor_state(self.plan.stage, self.start - 1.0, self.end + 1.0, self.fps)

    def draw(self, frame):
        """このコマの絵(直線、3 × 高さ × 幅)と、キャラの透明。"""
        background = self.background.next()
        if self.fx is not None:
            fx = self.fx.render(frame)
            small = (self.size[1] // LIMIT_DIV, self.size[0] // LIMIT_DIV)
            scale = limiter_scale(F.adaptive_avg_pool2d(background.unsqueeze(0), small)[0],
                                  F.adaptive_avg_pool2d(fx.unsqueeze(0), small)[0], self.args.mean_cap)
            final = knee(background + fx * scale)
        else:
            scale = 1.0
            final = background.clone()
        char_alpha = None
        image = self.character.get(frame)
        if image is not None:
            color, char_alpha = character_layer(image, self.size, self.args.char_key, self.tint, self.device)
            final = final * (1.0 - char_alpha) + color
        self._draw_monitors(final, frame)
        return final, char_alpha, scale

    def _draw_monitors(self, final, frame):
        state = self.monitors.get(frame)
        if state is None:
            return
        kick = float(self.plan.track["kick"][frame])
        rects = self.plan.stage["monitor_rects"]
        left = self.mon_left.get(frame)
        right = self.mon_right.get(frame) if self.mon_right else left
        draw_monitor(final, rects[0], state, left, kick, self.args.scale, self.device, False)
        draw_monitor(final, rects[1], state, right, kick, self.args.scale, self.device, True)

    def encode(self, final, frame):
        rows, cols = final.shape[1:]
        wobble = self.dither[:, (frame * 37) % 509:, (frame * 91) % 509:][:, :rows, :cols]
        display = (to_srgb(final) + wobble * 0.75 * (final.max(dim=0, keepdim=True).values < 0.5)).clamp(0.0, 1.0)
        return (display.permute(1, 2, 0) * 65535.0 + 0.5).to(torch.int32).cpu().numpy().astype(np.uint16).tobytes()

    def run(self):
        first, last = int(round(self.start * self.fps)), int(round(self.end * self.fps))
        writer = open_writer(self.args.out, self.size, self.fps, first) if self.args.out else None
        stats = open(self.args.stats, "w", encoding="utf-8") if self.args.stats else None
        began = time.time()
        for frame in range(first, last):
            t0 = time.perf_counter()
            with torch.no_grad():
                final, alpha, scale = self.draw(frame)
                data = self.encode(final, frame)
            if writer:
                writer.stdin.write(data)
            if stats:
                row = frame_stats(frame, final, alpha, time.perf_counter() - t0)
                row["limit"] = round(scale, 3)
                stats.write(json.dumps(row) + "\n")
            if (frame - first) % 120 == 0:
                print(f"{frame} / {last}  {(time.time() - began) / max(1, frame - first + 1):.3f} 秒/コマ", flush=True)
        total = time.time() - began
        if writer:
            writer.stdin.close()
            if writer.wait() != 0:
                raise RuntimeError("ffmpeg が失敗しました")
        if stats:
            stats.close()
        self.background.close()
        print(json.dumps({"frames": last - first, "sec": round(total, 1), "sec_per_frame": round(total / max(1, last - first), 4),
                          "hits_source": self.hits_source, "device": self.device}, ensure_ascii=False))

    def stills(self, seconds, folder):
        Path(folder).mkdir(parents=True, exist_ok=True)
        for second in seconds:
            frame = int(round(second * self.fps))
            with torch.no_grad():
                t0 = time.perf_counter()
                final, alpha, scale = self.draw(frame)
                row = frame_stats(frame, final, alpha, time.perf_counter() - t0)
                data = (to_srgb(final).permute(1, 2, 0) * 255.0 + 0.5).to(torch.uint8).cpu().numpy()
            cv2.imwrite(str(Path(folder) / f"s_{frame:05d}.png"), data[:, :, ::-1])
            row["limit"] = round(scale, 3)
            print(json.dumps(row))


def main():
    args = parse_args()
    composer = Composer(args)
    if args.still is not None:
        composer.stills(args.still, args.still_dir)
    else:
        composer.run()


if __name__ == "__main__":
    main()
