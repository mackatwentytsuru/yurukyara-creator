"""計算の効果の層(torch)。光の面・空間を通る光・少しの粒・決めの光・電球。

- 値は全部、直線の光(sRGB にする前)。足し算で重ねる。
- コマ番号だけで絵が決まる。前のコマを覚えない。途中のコマから描いても同じ絵になる。
- なめらかな物は 4 分の 1 の絵で計算して広げる。粒と電球の芯だけ原寸で置く。
- 細かい模様を作らない(LED のモジュールは 80×40 px)。粒も 8 px 以上。
"""
import math

import torch
import torch.nn.functional as F

from fx_plan import ARCH, CANVAS, CLOSED_FX, EXIT_SEC, FALL_LEAD_SEC

SOFT_DIV = 4
TEAL = (0.02, 0.60, 0.56)
PINK = (0.90, 0.07, 0.36)
GOLD = (1.00, 0.60, 0.17)
WARM = (1.00, 0.82, 0.55)
FALL = (1.00, 0.56, 0.16)
CENTER_HALF_WIDTH = 430.0
CENTER_FLOOR = 0.22  # x=2159 のまわりの効果の残り
FLASH_CENTER_FLOOR = 0.55  # 決めの光は少し多く残す
PILLARS = [  # 上の x・下へ向かう傾き・広がり・色(0 青緑 1 ピンク)
    (260.0, 0.10, 0.17, 0), (860.0, -0.07, 0.20, 1), (1480.0, 0.08, 0.13, 0), (2840.0, -0.08, 0.13, 1),
    (3420.0, 0.09, 0.20, 1), (4010.0, -0.06, 0.16, 0), (4640.0, 0.10, 0.20, 1), (5290.0, -0.09, 0.18, 0),
]
SEED = 20261103
DUST_COUNT = 70
BOKEH_COUNT = 18


def smooth(x):
    x = torch.as_tensor(x).clamp(0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


class FxRenderer:
    def __init__(self, plan, scale=1.0, device="cuda"):
        self.plan = plan
        self.device = torch.device(device)
        self.scale = scale
        self.width, self.height = int(round(CANVAS[0] * scale)), int(round(CANVAS[1] * scale))
        self.soft_w, self.soft_h = self.width // SOFT_DIV, self.height // SOFT_DIV
        self.generator = torch.Generator(device="cpu").manual_seed(SEED)
        self._build_grid()
        self._build_haze()
        self._build_particles()
        self._build_bulbs()
        self.colors = {name: self._color(value) for name, value in (("teal", TEAL), ("pink", PINK), ("gold", GOLD), ("warm", WARM), ("fall", FALL))}

    def _color(self, rgb):
        return torch.tensor(rgb, dtype=torch.float32, device=self.device).view(3, 1, 1)

    def _rand(self, *shape):
        return torch.rand(*shape, generator=self.generator).to(self.device)

    def _build_grid(self):
        """座標はいつも 5680×1240 の画素。scale を変えても絵の形は同じ。"""
        xs = (torch.arange(self.soft_w, device=self.device, dtype=torch.float32) + 0.5) * CANVAS[0] / self.soft_w
        ys = (torch.arange(self.soft_h, device=self.device, dtype=torch.float32) + 0.5) * CANVAS[1] / self.soft_h
        self.x_line, self.y_line = xs, ys
        self.y, self.x = torch.meshgrid(ys, xs, indexing="ij")
        away = ((self.x - self.plan.center_x) / CENTER_HALF_WIDTH).abs() ** 4
        hollow = torch.exp(-away)
        self.center_mask = 1.0 - (1.0 - CENTER_FLOOR) * hollow
        self.flash_mask = 1.0 - (1.0 - FLASH_CENTER_FLOOR) * hollow

    def _build_haze(self):
        """繰り返せる霞のノイズ。周波数の空間で低い成分だけ残す。形は固定で、時間でずらす。"""
        rows, cols = 128, 512
        spectrum = torch.fft.rfft2(torch.randn(rows, cols, generator=self.generator))
        fy = torch.fft.fftfreq(rows).view(-1, 1) * rows
        fx = torch.fft.rfftfreq(cols).view(1, -1) * cols / 3.0  # 横に長い筋にする
        falloff = 1.0 / (1.0 + (fx * fx + fy * fy) / 9.0) ** 1.3
        field = torch.fft.irfft2(spectrum * falloff, s=(rows, cols))
        field = (field - field.mean()) / field.std()
        self.haze = field.view(1, 1, rows, cols).to(self.device)
        self.haze_u = self.x / CANVAS[0]
        self.haze_v = self.y / CANVAS[1]

    def _haze_at(self, t, scale_u, scale_v, speed_u, speed_v):
        """霞の値(0 が平均)。端は繰り返しでつながる。"""
        u = (self.haze_u * scale_u + t * speed_u) % 1.0
        v = (self.haze_v * scale_v + t * speed_v) % 1.0
        pad = torch.cat([self.haze, self.haze[:, :, :, :1]], dim=3)
        pad = torch.cat([pad, pad[:, :, :1, :]], dim=2)
        grid = torch.stack([u * 2.0 - 1.0, v * 2.0 - 1.0], dim=-1).unsqueeze(0)
        return F.grid_sample(pad, grid, mode="bilinear", padding_mode="border", align_corners=True)[0, 0]

    def _build_particles(self):
        count = DUST_COUNT + BOKEH_COUNT
        self.p_x = self._rand(count) * CANVAS[0]
        self.p_y = self._rand(count) * CANVAS[1]
        self.p_fall = 10.0 + self._rand(count) * 28.0
        self.p_sway = 8.0 + self._rand(count) * 26.0
        self.p_sway_rate = 0.15 + self._rand(count) * 0.35
        self.p_phase = self._rand(count) * 2.0 * math.pi
        self.p_twinkle = 0.25 + self._rand(count) * 0.6
        dust = 4.0 + self._rand(DUST_COUNT) * 3.5  # 標準偏差。半値幅で 9〜17 px
        bokeh = 14.0 + self._rand(BOKEH_COUNT) * 14.0
        self.p_sigma = torch.cat([dust, bokeh])
        self.p_level = torch.cat([0.35 + self._rand(DUST_COUNT) * 0.5, 0.05 + self._rand(BOKEH_COUNT) * 0.05])

    def _build_bulbs(self):
        self.b_x = torch.tensor([b["x"] for b in self.plan.bulbs], dtype=torch.float32, device=self.device)
        self.b_y = torch.tensor([b["y"] for b in self.plan.bulbs], dtype=torch.float32, device=self.device)
        flow = torch.tensor(self.plan.flow, dtype=torch.float32, device=self.device)
        # 流れ落ちる光は電球 2 つに 1 つから出す
        self.s_x, self.s_y, self.s_flow = self.b_x[::2], self.b_y[::2], flow[::2]
        count = self.s_x.numel()
        # 等間隔の棒に見せないよう、太さ・長さ・落ち方・強さをそろえない
        jitter = self._rand(count) - 0.5
        if not self.plan.measured_bulbs:  # 本物の電球の座標なら、そこから落とす
            self.s_x = self.s_x + jitter * 90.0
        self.s_width = (18.0 + self._rand(count) * 34.0) if self.plan.measured_bulbs else (70.0 + self._rand(count) * 120.0)
        self.s_trail = 300.0 + self._rand(count) * 420.0
        self.s_power = 1.7 + self._rand(count) * 1.2
        self.s_level = 0.25 + self._rand(count) ** 2 * 0.75

    def _splat(self, canvas, xs, ys, sigmas, levels, div):
        """ガウスの粒を置く(canvas は 高さ × 幅、div は 5680 に対する縮み)。同じ広さごとに分けず、一番広い枠で計算する。"""
        keep = levels > 1e-4
        xs, ys, sigmas, levels = xs[keep] / div, ys[keep] / div, sigmas[keep] / div, levels[keep]
        if xs.numel() == 0:
            return canvas
        reach = max(2, int(math.ceil(float(sigmas.max()) * 3.0)))
        offsets = torch.arange(-reach, reach + 1, device=self.device)
        ix, iy = xs.floor().long(), ys.floor().long()
        dx = offsets.view(1, -1) - (xs - ix).view(-1, 1)
        dy = offsets.view(1, -1) - (ys - iy).view(-1, 1)
        wx = torch.exp(-dx * dx / (2.0 * sigmas.view(-1, 1) ** 2))
        wy = torch.exp(-dy * dy / (2.0 * sigmas.view(-1, 1) ** 2))
        weight = wy.unsqueeze(2) * wx.unsqueeze(1) * levels.view(-1, 1, 1)
        px = ix.view(-1, 1, 1) + offsets.view(1, 1, -1)
        py = iy.view(-1, 1, 1) + offsets.view(1, -1, 1)
        rows, cols = canvas.shape
        inside = (px >= 0) & (px < cols) & (py >= 0) & (py < rows)
        positions = (py * cols + px)[inside]
        return canvas.view(-1).index_add(0, positions, weight[inside]).view(rows, cols)

    def _plane(self, frame, t, level):
        """光の面。大きくてなめらかな色の変化。下の縁に強く出し、本物の床の反射を誘う。"""
        plan = self.plan
        u, v = self.x / 1000.0, self.y / 1000.0
        kick, snare = float(plan.track["kick"][frame]), float(plan.track["snare"][frame])
        teal_wave = 0.5 + 0.5 * torch.sin(2.3 * u + 1.7 * torch.sin(1.3 * v + 0.11 * t) + 0.21 * t)
        pink_wave = 0.5 + 0.5 * torch.sin(1.9 * u + 2.1 + 1.5 * torch.sin(1.7 * v - 0.09 * t) - 0.17 * t)
        gold_wave = 0.5 + 0.5 * torch.sin(1.1 * u - 0.8 + 1.1 * torch.sin(2.1 * v + 0.07 * t) + 0.08 * t)
        haze = 1.0 + 0.22 * self._haze_at(t, 1.0, 1.0, 0.006, -0.012)
        height = 0.16 + 0.84 * smooth((self.y - 500.0) / 740.0) ** 1.6
        breath = 0.88 + 0.12 * float(plan.breath[frame])
        amount = level * breath * (0.050 + 0.030 * kick)
        # 青緑とピンクを足すと灰色に濁るので、同じ所に重ねない
        teal_part = smooth(teal_wave * 1.5 - 0.25)
        pink_part = smooth(pink_wave * 1.5 - 0.3) * (1.0 - teal_part)
        # スネアはピンクの面を持ち上げる(キックは下の縁、スネアは上まで)
        out = self.colors["teal"] * teal_part + self.colors["pink"] * pink_part * (1.0 + 1.1 * snare)
        out = out + self.colors["gold"] * 0.3 * smooth(gold_wave * 1.5 - 0.7) * (1.0 - teal_part)
        floor_mix = self.colors["teal"] * teal_part + self.colors["pink"] * pink_part
        bottom = torch.exp(-(CANVAS[1] - self.y) / 105.0)
        return (out * height * haze.clamp(min=0.2) * amount + floor_mix * bottom * level * (0.05 + 0.17 * kick)) * self.center_mask

    def _pillars(self, frame, t, level):
        """空間を通る光。上から落ちる柱を霞で揺らす。拍では少し動く程度。"""
        plan = self.plan
        snare, kick = float(plan.track["snare"][frame]), float(plan.track["kick"][frame])
        haze = (1.0 + 0.42 * self._haze_at(t, 1.6, 0.8, 0.012, -0.03)).clamp(min=0.15)
        names = ("teal", "pink")
        total = torch.zeros_like(self.colors["teal"] * self.x)
        drop = 0.18 + 0.82 * (1.0 - self.y / CANVAS[1]).clamp(min=0.0) ** 1.1
        for index, (top, slope, spread, tint) in enumerate(PILLARS):
            sign = 1.0 if index % 2 == 0 else -1.0
            sway = 26.0 * math.sin(0.23 * t + index * 1.7) + 14.0 * sign * snare
            middle = top + sway + slope * self.y
            width = 60.0 + spread * self.y
            beam = torch.exp(-((self.x - middle) / width) ** 2) * (60.0 / width) ** 0.45
            total = total + self.colors[names[tint]] * beam
        amount = level * (0.055 + 0.034 * snare + 0.010 * kick)
        return total * drop * haze * amount * self.center_mask

    def _fall(self, t):
        """「出る」の手前、電球の光が下の縁へ流れ落ちる。全部が出る秒に下へ着く。"""
        plan = self.plan
        out = torch.zeros_like(self.colors["teal"] * self.x)
        for at in plan.out_times:
            if not at - FALL_LEAD_SEC <= t <= at + 0.35:
                continue
            start = at - FALL_LEAD_SEC + FALL_LEAD_SEC * 0.75 * self.s_flow
            progress = ((t - start) / (at - start)).clamp(min=0.0)
            front = self.s_y + (CANVAS[1] + 60.0 - self.s_y) * progress.clamp(max=1.0) ** self.s_power
            ahead = (self.y_line.view(1, -1) - front.view(-1, 1)) / 130.0
            behind = (front.view(-1, 1) - self.y_line.view(1, -1)) / self.s_trail.view(-1, 1)
            shape = torch.where(ahead > 0, torch.exp(-ahead * ahead), torch.exp(-behind.clamp(min=0.0)))
            shape = shape * smooth((self.y_line.view(1, -1) - self.s_y.view(-1, 1)) / 160.0 + 0.3)
            active = smooth(progress / 0.08) * (1.0 - smooth((t - at) / 0.35)) * self.s_level
            across = torch.exp(-((self.x_line.view(1, -1) - self.s_x.view(-1, 1)) / self.s_width.view(-1, 1)) ** 2)
            field = (shape * active.view(-1, 1)).t() @ across
            haze = (1.0 + 0.16 * self._haze_at(t, 2.2, 0.7, 0.0, -0.25)).clamp(min=0.5)
            out = out + self.colors["fall"] * field * haze * (0.21 if self.plan.measured_bulbs else 0.14) * self.flash_mask
        return out

    def _floor_wave(self, t):
        """流れ落ちた光が下の縁を両側へ広がる。出る秒から。"""
        plan = self.plan
        age = plan.last_flash_age(t, plan.out_times)
        if age is None or age > 4.5:
            return None
        legs = torch.minimum((self.x - plan.center_x + ARCH["half_w"]).abs(), (self.x - plan.center_x - ARCH["half_w"]).abs())
        reach = age * 3400.0
        filled = smooth((reach - legs) / 700.0 + 0.5)
        crest = torch.exp(-((reach - legs) / 340.0) ** 2)
        tall = 70.0 + 110.0 * min(age, 1.2)
        rise = float(smooth(torch.tensor(age * plan.fps / 3.0 + 0.5)))
        bottom = torch.exp(-(CANVAS[1] - self.y) / tall)
        fade = math.exp(-age / 0.95) * rise
        return (self.colors["warm"] * crest * 0.30 + self.colors["gold"] * crest * 0.2
                + self.colors["teal"] * filled * 0.22) * bottom * fade * self.flash_mask

    def _flash(self, frame, kind, tint):
        """led_plan の式の輪と光(出るは外へ、戻るは内へ)。"""
        keys = self.plan.flash[kind]
        ring, light, core = (float(keys[n][frame]) for n in ("ring", "light", "core"))
        if ring <= 0.0 and light <= 0.0 and core <= 0.0:
            return None
        radius, width = float(keys["radius"][frame]), float(keys["width"][frame])
        distance = torch.sqrt(((self.x - self.plan.center_x) / 1.48) ** 2 + (self.y - self.plan.foot_y) ** 2)
        band = torch.exp(-((distance - radius) / (width * 3.0 + 110.0)) ** 2)
        wash = smooth((self.y - 200.0) / 1040.0) ** 2
        field = self.colors[tint] * (band * ring * 0.16 + wash * light * 0.05)
        if core > 0.0:
            mixed = self.colors["pink"] * 0.7 + self.colors["warm"] * 0.3  # 薄い暖色は灰色に濁る
            field = field + mixed * torch.exp(-(distance / 330.0) ** 2) * core * 0.26
        return field * self.flash_mask

    def _exit_floor(self, t):
        """足元の光が床へ伸びる。足が移り始めると中央から横へ広がり、絵の下の端へ流れる。"""
        age = self.plan.exit_age(t)
        if age is None:
            return None
        rise = float(smooth(torch.tensor(age / EXIT_SEC)))
        fade = 1.0 if age < EXIT_SEC else math.exp(-(age - EXIT_SEC) / 0.55)
        center = self.plan.center_x
        foot = self.plan.foot_y
        halfway = 90.0 + 760.0 * rise + 1500.0 * max(0.0, age - EXIT_SEC)
        along = torch.exp(-((self.x - center) / halfway) ** 2)
        depth = torch.exp(-(((self.y - (foot + 8.0)) / 36.0) ** 2))
        below = smooth((self.y - (foot - 40.0)) / 60.0)
        # 足からまっすぐ前(絵の下)へ伸びる帯。本物の床の反射につなげる
        beam = torch.exp(-((self.x - center) / (70.0 + 170.0 * rise)) ** 2) * below
        return (self.colors["teal"] * along * depth * 0.42 + self.colors["warm"] * beam * 0.55) * rise * fade

    def _crash(self, frame, t):
        crash, finale = float(self.plan.track["crash"][frame]), float(self.plan.finale[frame])
        if crash < 1e-3 and finale < 1e-3:
            return None
        # 全面を同じ色で塗ると黄土色にのっぺりする。下に寄せ、大きな波で濃淡を付ける
        low = smooth((self.y - 420.0) / 820.0) ** 1.5
        wave = 0.5 + 0.5 * torch.sin(self.x / 1000.0 * 2.6 + 1.3 * torch.sin(self.y / 1000.0 * 1.4 + 0.1 * t) + 0.4 * t)
        wash = low * (0.3 + 0.7 * wave)
        return self.colors["gold"] * wash * (crash * 0.05 + finale * 0.34) * self.flash_mask

    def _soft_bulbs(self, frame):
        levels = torch.as_tensor(self.plan.bulb_table[frame], device=self.device)
        sigma = torch.full_like(levels, 30.0)
        halo = self._splat(torch.zeros(self.soft_h, self.soft_w, device=self.device), self.b_x, self.b_y, sigma,
                           levels * levels * 0.28, CANVAS[0] / self.soft_w)
        return self.colors["gold"] * halo

    def _soft_layer(self, frame, t, level):
        scene = CLOSED_FX + (1.0 - CLOSED_FX) * float(self.plan.opened[frame])
        layer = (self._plane(frame, t, level) + self._pillars(frame, t, level)) * scene + self._soft_bulbs(frame)
        for extra in (self._fall(t), self._floor_wave(t), self._exit_floor(t), self._flash(frame, "out", "teal"),
                      self._flash(frame, "back", "pink"), self._crash(frame, t)):
            if extra is not None:
                layer = layer + extra
        return layer

    def _dust_motion(self, frame, t):
        """粒の位置。決めの瞬間に下の中央から外へ押され、ゆっくり戻る。"""
        plan = self.plan
        xs = self.p_x + self.p_sway * torch.sin(self.p_sway_rate * t + self.p_phase)
        ys = (self.p_y + self.p_fall * t) % (CANVAS[1] + 120.0) - 60.0
        age = plan.last_flash_age(t, plan.all_flash)
        if age is not None and age < 14.0:
            amount = (1.0 - math.exp(-age / 0.3)) * math.exp(-age / 2.6) * 620.0
            dx, dy = xs - plan.center_x, ys - plan.foot_y
            reach = torch.sqrt(dx * dx + dy * dy).clamp(min=80.0)
            push = torch.exp(-reach / 1800.0) * amount
            xs, ys = xs + dx / reach * push, ys + dy / reach * push * 0.6
        return xs, ys

    def _sharp_layer(self, frame, t, level):
        """粒と電球の芯。原寸で置く。1 チャンネルの強さと色で返す。"""
        plan = self.plan
        div = CANVAS[0] / self.width
        kick = float(plan.track["kick"][frame])
        xs, ys = self._dust_motion(frame, t)
        twinkle = 0.65 + 0.35 * torch.sin(self.p_twinkle * t + self.p_phase * 3.0)
        edge = smooth((ys + 40.0) / 120.0) * smooth((CANVAS[1] + 40.0 - ys) / 120.0)
        away = ((xs - plan.center_x) / CENTER_HALF_WIDTH).abs() ** 4
        hollow = 1.0 - (1.0 - 0.3) * torch.exp(-away)
        levels = self.p_level * twinkle * edge * hollow * level * (0.75 + 0.25 * kick + 0.5 * float(plan.finale[frame]))
        canvas = self._splat(torch.zeros(self.height, self.width, device=self.device), xs, ys, self.p_sigma, levels, div)
        bulbs = torch.as_tensor(plan.bulb_table[frame], device=self.device)
        core = self._splat(torch.zeros(self.height, self.width, device=self.device), self.b_x, self.b_y,
                           torch.full_like(bulbs, 7.0), bulbs * 0.85, div)
        return canvas, core

    def render(self, frame):
        """このコマの効果(3 × 高さ × 幅、直線の光)。"""
        plan = self.plan
        t = frame / plan.fps
        gain = float(plan.gain[frame])
        if gain <= 0.0:  # 待ち・同期・暗転の終わりは真っ黒。残光も出さない
            return torch.zeros(3, self.height, self.width, device=self.device)
        gate = min(1.0, gain * 4.0)
        level = gain * (0.72 + 0.28 * float(plan.on_stage[frame]))
        soft = self._soft_layer(frame, t, level).unsqueeze(0)
        soft = F.interpolate(soft, size=(self.height, self.width), mode="bicubic", align_corners=False)[0].clamp(min=0.0)
        dust, core = self._sharp_layer(frame, t, level)
        return (soft + self.colors["gold"] * dust + self.colors["warm"] * core) * gate
