"""still_motion.py - 静止画 1 枚を、AI 動画なしで「計算だけ」で動かす(5680x1240・60p を直接描く)。

層に分ける:
  背景(光の柱) : 額縁を消した絵(inpaint)。ゆっくり視差でずらす + 柱の方向に流れるノイズの揺らぎ
  水鏡          : 地平線より下。行ごとの横ゆれ(下ほど大きい)+ 明るさのきらめき
  額縁          : 額縁・電球・ひもの暖色部。カメラは動かさないので位置は固定。電球だけ小さく呼吸
使い方:
  python still_motion.py --src <png> --out <mp4> --seconds 6 [--fps 60] [--preview-frames N]
出力は ffmpeg に流し込み、メタデータは付けない(-map_metadata -1)。
"""
from __future__ import annotations

import argparse
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

HORIZON_FRAC = 936 / 1240   # 水平線(原寸の y)
FRAME_BASE_FRAC = 1092 / 1240  # 額縁の足元(これより下は水鏡側の映り込み)
PARALLAX_PX = (14.0, 5.0)   # 背景のずらしの最大(x, y)
PARALLAX_PERIOD_S = 14.0
RIPPLE_MAX_PX = 7.0
BULB_BREATH = 0.07
BEAM_SHIMMER = 0.12


def load_rgb(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"cannot read {path}")
    return img


def build_masks(img: np.ndarray):
    """額縁側(暖色・カーテン)のマスクと、電球の連結成分を返す。"""
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hh, ss, vv = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    warm = (hh >= 5) & (hh <= 28) & (ss > 90) & (vv > 60)
    # カーテン: アーチの中だけ見る(柱のピンクと混ざらないように範囲を限る)
    curtain = np.zeros_like(warm)
    x0, x1 = int(w * 0.265), int(w * 0.525)
    y0, y1 = int(h * 0.38), int(h * 0.90)
    sub = ((hh[y0:y1, x0:x1] >= 170) | (hh[y0:y1, x0:x1] <= 6)) & (ss[y0:y1, x0:x1] > 120) & (vv[y0:y1, x0:x1] > 40)
    curtain[y0:y1, x0:x1] = sub
    near_warm = cv2.dilate(warm.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
    core = near_warm & (vv > 170)   # 電球の白い芯(彩度が低く暖色に入らない)
    fg = (warm | curtain | core)
    fg[int(h * FRAME_BASE_FRAC):, :] = False
    fg = fg.astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    fg = cv2.dilate(fg, np.ones((5, 5), np.uint8))
    fg[int(h * FRAME_BASE_FRAC):, :] = 0
    # 電球: 暖色で特に明るい所
    bulbs = (core & (vv > 215)).astype(np.uint8)
    bulbs[int(h * FRAME_BASE_FRAC):, :] = 0
    bulbs = cv2.dilate(bulbs, np.ones((9, 9), np.uint8))
    n, labels = cv2.connectedComponents(bulbs)
    return fg, n, labels


def make_background(img: np.ndarray, fg: np.ndarray) -> np.ndarray:
    """額縁を消した背景。1/4 の大きさで inpaint して戻し、額縁の外は元のまま。"""
    h, w = img.shape[:2]
    grow = cv2.dilate(fg, np.ones((15, 15), np.uint8))
    s = 4
    small = cv2.resize(img, (w // s, h // s), interpolation=cv2.INTER_AREA)
    msmall = cv2.resize(grow, (w // s, h // s), interpolation=cv2.INTER_NEAREST)
    msmall = cv2.dilate(msmall, np.ones((3, 3), np.uint8))
    filled = cv2.inpaint(small, msmall, 5, cv2.INPAINT_TELEA)
    filled = cv2.GaussianBlur(filled, (0, 0), 2.0)
    filled = cv2.resize(filled, (w, h), interpolation=cv2.INTER_CUBIC)
    a = cv2.GaussianBlur(grow, (0, 0), 3.0).astype(np.float32)[..., None] / 255.0
    bg = img.astype(np.float32) * (1 - a) + filled.astype(np.float32) * a
    return bg


def plates_mask(plates: Path, size: tuple[int, int]) -> np.ndarray:
    """stage_plates.py の額縁の範囲を、開いた絵の位置へ写す。暖色の判定では、ひもが途切れる。"""
    mask = cv2.cvtColor(load_rgb(plates / "fg_mask.png"), cv2.COLOR_BGR2GRAY)
    field = np.load(plates / "warp_open.npy")
    field = cv2.resize(field, size, interpolation=cv2.INTER_CUBIC)
    xs, ys = np.meshgrid(np.arange(size[0], dtype=np.float32), np.arange(size[1], dtype=np.float32))
    moved = cv2.remap(mask, xs - field[..., 0], ys - field[..., 1], cv2.INTER_LINEAR)
    return cv2.dilate((moved > 64).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))


class Motion:
    def __init__(self, img: np.ndarray, seed: int = 11, extra_fg: np.ndarray | None = None):
        self.img = img
        self.h, self.w = img.shape[:2]
        fg, n, labels = build_masks(img)
        if extra_fg is not None:
            fg = cv2.max(fg, extra_fg)
        self.fg_alpha = (cv2.GaussianBlur(fg, (0, 0), 1.2).astype(np.float32) / 255.0)[..., None]
        self.bg = make_background(img, fg)
        self.fg_img = img.astype(np.float32)
        self.labels = labels
        rng = np.random.default_rng(seed)
        self.phase = rng.uniform(0, 2 * np.pi, n).astype(np.float32)
        self.phase[0] = 0.0
        self.bulb_on = np.ones(n, np.float32)
        self.bulb_on[0] = 0.0
        # 柱の揺らぎ用の波(柱は右上から左下へ流れる向き。波は柱に沿って長く、横に短い)
        self.waves = []
        for _ in range(6):
            ang = np.deg2rad(rng.uniform(15, 35))   # 柱の傾き付近
            k = rng.uniform(2.0, 5.0) * 2 * np.pi / self.w  # 横方向の細かさ
            self.waves.append((ang, k, rng.uniform(0.03, 0.09), rng.uniform(0, 2 * np.pi)))
        self.y_h = int(self.h * HORIZON_FRAC)
        # 水鏡用の座標
        ys = np.arange(self.y_h, self.h, dtype=np.float32)
        self.water_depth = (ys - self.y_h) / max(1, self.h - self.y_h)
        self.water_xs = np.arange(self.w, dtype=np.float32)[None, :].repeat(len(ys), 0)
        self.water_ys = ys[:, None].repeat(self.w, 1)
        self.lum_bg = cv2.cvtColor(np.clip(self.bg, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0

    def shimmer_field(self, t: float) -> np.ndarray:
        """低解像度で作って広げる。平均 0、振幅は約 ±1。"""
        sw, sh = self.w // 8, self.h // 8
        xs = np.arange(sw, dtype=np.float32)[None, :] * 8
        ys = np.arange(sh, dtype=np.float32)[:, None] * 8
        f = np.zeros((sh, sw), np.float32)
        for i, (ang, k, om, ph) in enumerate(self.waves):
            u = xs * np.cos(ang) + ys * np.sin(ang)
            f += np.sin(k * u * (1 + 0.3 * i) + om * 2 * np.pi * t + ph + 0.4 * np.sin(0.7 * t + i))
        f /= len(self.waves) * 0.6
        return cv2.resize(f, (self.w, self.h), interpolation=cv2.INTER_LINEAR)

    def render(self, t: float) -> np.ndarray:
        h, w = self.h, self.w
        ph = 2 * np.pi * t / PARALLAX_PERIOD_S
        dx = PARALLAX_PX[0] * np.sin(ph)
        dy = PARALLAX_PX[1] * np.sin(ph * 0.5 + 1.0)
        m = np.float32([[1, 0, dx], [0, 1, dy]])
        bg = cv2.warpAffine(self.bg, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        # 柱のノイズの揺らぎ: 明るい所ほど強く
        weight = np.clip(self.lum_bg * 4.0, 0.0, 1.0)
        weight = cv2.warpAffine(weight, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        gain = 1.0 + BEAM_SHIMMER * self.shimmer_field(t) * weight
        bg = bg * gain[..., None]
        # 水鏡: 水平線より下だけ、行ごとの横ゆれ
        y0 = self.y_h
        d = self.water_depth
        amp = RIPPLE_MAX_PX * (0.15 + 0.85 * d)
        wav = (np.sin(2 * np.pi * (self.water_ys / (14.0 + 40.0 * d[:, None])) + 1.6 * t * 2 * np.pi * 0.35 + 0.002 * self.water_xs)
               + 0.5 * np.sin(2 * np.pi * (self.water_ys / (7.0 + 20.0 * d[:, None])) - 2.3 * t + 0.004 * self.water_xs))
        mapx = (self.water_xs + amp[:, None] * wav).astype(np.float32)
        mapy = (self.water_ys + 0.8 * np.sin(0.9 * t + 0.01 * self.water_xs)).astype(np.float32)
        strip = cv2.remap(bg, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        sparkle = 1.0 + 0.05 * wav * d[:, None]
        bg[y0:] = strip * sparkle[..., None]
        # 額縁の層: 位置は固定。電球だけ呼吸
        g = 1.0 + BULB_BREATH * np.sin(2 * np.pi * t / 5.0 + self.phase)
        g = np.where(self.bulb_on > 0, g, 1.0).astype(np.float32)
        gmap = cv2.GaussianBlur(g[self.labels], (0, 0), 3.0)
        fgl = self.fg_img * gmap[..., None]
        out = fgl * self.fg_alpha + bg * (1 - self.fg_alpha)
        return np.clip(out, 0, 255).astype(np.uint8)


CURTAIN_TOP = 300
CURTAIN_BOTTOM = 1105
CURTAIN_SWAY_PX = 20.0
CURTAIN_SHADE = 0.22
FLOOR_SHIMMER = 0.05


class CurtainMotion:
    """閉じた緞帳を動かす。額縁・ひもは固定し、幕を低い周波数の波で揺らし、波の密な所を暗くする。

    plate は持ち上げた絵、clean は額縁を消した絵、fg は額縁の範囲(どれも stage_plates.py の出力)。
    上は吊られていて動かず、下ほど大きく動く。コマ番号だけで絵が決まる。
    """

    WAVES = 6

    def __init__(self, plate: np.ndarray, clean: np.ndarray, fg: np.ndarray, seed: int = 5):
        self.plate, self.clean = plate.astype(np.float32), clean.astype(np.float32)
        self.h, self.w = plate.shape[:2]
        self.alpha = (cv2.GaussianBlur(fg, (0, 0), 1.2).astype(np.float32) / 255.0)[..., None]
        rng = np.random.default_rng(seed)
        self.k = rng.uniform(2.0, 9.0, self.WAVES) * 2 * np.pi / self.w
        self.rate = rng.uniform(0.09, 0.26, self.WAVES) * 2 * np.pi
        self.phase = rng.uniform(0, 2 * np.pi, self.WAVES)
        self.tilt = rng.uniform(-0.0012, 0.0012, self.WAVES)
        self.gain = 1.0 / np.arange(1, self.WAVES + 1) ** 0.5
        self.gain /= self.gain.sum()
        sw, sh = self.w // 8, self.h // 8
        self.xs = (np.arange(sw, dtype=np.float32)[None, :] * 8)
        self.ys = (np.arange(sh, dtype=np.float32)[:, None] * 8)
        self.hang = np.clip((self.ys - CURTAIN_TOP) / (CURTAIN_BOTTOM - CURTAIN_TOP), 0.0, 1.0) ** 1.3
        self.full_x, self.full_y = np.meshgrid(np.arange(self.w, dtype=np.float32), np.arange(self.h, dtype=np.float32))
        self.floor = (self.full_y >= CURTAIN_BOTTOM)[..., None]

    def _fields(self, t: float):
        """横のずれ(画素)と、波の傾き(明るさに使う)。"""
        move = np.zeros((self.ys.size, self.xs.size), np.float32)
        slope = np.zeros_like(move)
        for k, rate, phase, tilt, gain in zip(self.k, self.rate, self.phase, self.tilt, self.gain):
            angle = k * self.xs + rate * t + phase + tilt * self.ys * self.xs.size / 200.0
            move += gain * np.sin(angle)
            slope += gain * np.cos(angle) * (k / self.k.max())
        move = move * self.hang * CURTAIN_SWAY_PX * 2.0
        slope = slope * (0.35 + 0.65 * self.hang)
        size = (self.w, self.h)
        return cv2.resize(move, size, interpolation=cv2.INTER_CUBIC), cv2.resize(slope, size, interpolation=cv2.INTER_CUBIC)

    def render(self, t: float) -> np.ndarray:
        move, slope = self._fields(t)
        back = cv2.remap(self.clean, self.full_x + move, self.full_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        back = back * (1.0 + CURTAIN_SHADE * slope)[..., None]
        out = self.plate * self.alpha + back * (1.0 - self.alpha)
        shimmer = 1.0 + FLOOR_SHIMMER * np.sin(0.006 * self.full_x + 1.1 * t)[..., None]
        out = np.where(self.floor, self.plate * shimmer, out)
        return np.clip(out, 0, 255).astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--open-plates", help="開いた絵を動かすとき: stage_plates.py の出力で額縁とひもを守る")
    ap.add_argument("--curtain-plates", help="緞帳を動かす: stage_plates.py の出力のフォルダ。--src は使わない")
    ap.add_argument("--src")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=float, default=6.0)
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--preview-frames", type=int, default=0, help="N>0 なら PNG を N 枚だけ out の隣に出して終わる")
    a = ap.parse_args()
    if a.curtain_plates:
        plates = Path(a.curtain_plates)
        fg = cv2.cvtColor(load_rgb(plates / "fg_mask.png"), cv2.COLOR_BGR2GRAY)
        mo = CurtainMotion(load_rgb(plates / "closed_lift.png"), load_rgb(plates / "closed_clean.png"), fg)
    else:
        source = load_rgb(Path(a.src))
        extra = plates_mask(Path(a.open_plates), (source.shape[1], source.shape[0])) if a.open_plates else None
        mo = Motion(source, extra_fg=extra)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    n = int(round(a.seconds * a.fps))
    if a.preview_frames:
        for i in range(a.preview_frames):
            t = (n - 1) * i / max(1, a.preview_frames - 1) / a.fps
            fr = mo.render(t)
            ok, buf = cv2.imencode(".png", fr)
            buf.tofile(str(out.with_name(f"{out.stem}_pv{i}.png")))
        return
    t0 = time.time()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{mo.w}x{mo.h}",
           "-r", str(a.fps), "-i", "-", "-map_metadata", "-1", "-c:v", "libx264", "-crf", "14", "-preset", "medium",
           "-pix_fmt", "yuv420p", str(out)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(mo.render(i / a.fps).tobytes())
    p.stdin.close()
    rc = p.wait()
    print(f"frames={n} rc={rc} sec={time.time() - t0:.1f}")


if __name__ == "__main__":
    main()
