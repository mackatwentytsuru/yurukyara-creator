"""閉じた緞帳の場面から開いた世界へ。額縁とひもは動かさず、幕だけが左右へ開く(torch)。

  開口の中の幕 : x=中心で割れて、額縁の足へ寄る(詰まる)。
  外の幕       : 額縁の足から外へ滑って出ていく。
  床           : 中心から外へ、開いた絵の床が広がる(幕より先に行く)。
  額縁・ひも   : 位置は固定。色だけが、波が通るときに開いた絵へ変わる。

入力は stage_plates.py の出力(fg_mask・inner_mask・closed_clean・warp_open)。
絵は秒(コマ番号)と 2 本の背景だけで決まる。光で隠さない。
行き来は何回でもよい: events = [(開く秒, 閉じる「戻る」の秒 か None), ...]。閉じるは開くを逆に流す
(close_sec の長さで、戻るの close_end 秒後に閉じきる)。背景は get(コマ) で読む(どのコマからでも同じ絵)。
"""
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

CANVAS = (5680, 1240)
INNER_HALF = 632.0  # 開口の半分の幅(測定: 中心 2159 から 1528 と 2790)
LEG_LEFT, LEG_RIGHT = 1324.0, 2992.0  # 額縁の外の端
UPPER_DARK = 480.0  # これより上は幕が暗く、ほぼ黒
CURTAIN_BOTTOM = 1107.0  # 幕の下の端。ここから下が床
INNER_TOP = 440.0
INNER_SEC = 1.05
OUTER_SEC = 1.35
FLOOR_SEC = 0.95
FG_SEC = 1.0
FULL_AGE = FG_SEC + 0.61  # この経過で開ききった絵になる(閉じるときはここから 0 へ戻す)
RESIDUAL_FULL = 0.34  # 開ききったとき、開口の端に残る幕の幅の割合(上)
RESIDUAL_FOOT = 0.17  # 同じ(足元)。開いた絵の、タッセルで留めた幕に近づける
HALO_REACH = 61
HALO_KEEP = 0.3  # 消した下地に残る電球の光の色(緑と青)


def smooth(x):
    x = torch.as_tensor(x, dtype=torch.float32).clamp(0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def ease(p):
    """すっと動き出して、ゆっくり止まる。"""
    return 1.0 - (1.0 - smooth(p)) ** 1.7


def _read_mask(path, size, device):
    image = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise FileNotFoundError(path)
    image = cv2.resize(image, size, interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    return torch.from_numpy(image).to(device)


class StageOpen:
    def __init__(self, closed, opened, plates_dir, events, fps, size, device, to_linear, close_sec=1.2, close_end=0.1):
        self.closed, self.opened = closed, opened
        if isinstance(events, (int, float)):
            events = [(float(events), None)]
        self.events = sorted(events)
        self.close_sec, self.close_end = close_sec, close_end
        self.fps = fps
        self.frame = 0
        self.width, self.height = size
        self.device = device
        plates = Path(plates_dir)
        self.fg = _soften(_read_mask(plates / "fg_mask.png", size, device), 1.6 * self.width / CANVAS[0])
        self.inner = _read_mask(plates / "inner_mask.png", size, device)
        # 幕を動かす下地は、電球の光の輪も消した所を使う(輪が幕と一緒に動かないように)
        self.halo = _halo_mask(plates / "fg_mask.png", size, device)
        clean = cv2.imdecode(np.fromfile(str(plates / "closed_clean.png"), np.uint8), cv2.IMREAD_COLOR)
        clean = cv2.resize(clean, size, interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255.0
        self.clean = to_linear(torch.from_numpy(clean.copy()).permute(2, 0, 1).to(device))
        self._build_grid()
        self._build_warp(plates / "warp_open.npy")
        keep = torch.tensor((1.0, HALO_KEEP, HALO_KEEP), device=device).view(3, 1, 1)
        above = (self.y < CURTAIN_BOTTOM).float()
        self.clean = self.clean * (keep * above + (1.0 - above))
        self.curtain_row = smooth((CURTAIN_BOTTOM - self.y) / 6.0)

    def _build_grid(self):
        xs = (torch.arange(self.width, device=self.device, dtype=torch.float32) + 0.5) * CANVAS[0] / self.width
        ys = (torch.arange(self.height, device=self.device, dtype=torch.float32) + 0.5) * CANVAS[1] / self.height
        self.y, self.x = torch.meshgrid(ys, xs, indexing="ij")
        self.dx = self.x - 2159.0
        depth = ((self.y - INNER_TOP) / (CURTAIN_BOTTOM - INNER_TOP)).clamp(0.0, 1.0)
        residual = RESIDUAL_FULL + (RESIDUAL_FOOT - RESIDUAL_FULL) * depth
        self.gap_max = INNER_HALF * (1.0 - residual)
        self.v_grid = self.y / CANVAS[1] * 2.0 - 1.0

    def _build_warp(self, path):
        """開いた絵を閉じた絵の額縁に合わせる表。"""
        field = torch.from_numpy(np.load(path)).to(self.device).permute(2, 0, 1).unsqueeze(0)
        field = F.interpolate(field, size=(self.height, self.width), mode="bicubic", align_corners=False)[0]
        u = (self.x + field[0]) / CANVAS[0] * 2.0 - 1.0
        v = (self.y + field[1]) / CANVAS[1] * 2.0 - 1.0
        self.warp_grid = torch.stack([u, v], dim=-1).unsqueeze(0)

    def _warped_open(self):
        image = self.opened.get(self.frame).unsqueeze(0)
        return F.grid_sample(image, self.warp_grid, mode="bicubic", padding_mode="border", align_corners=False)[0].clamp(min=0.0)

    def _sample_x(self, image, source_x):
        u = source_x / CANVAS[0] * 2.0 - 1.0
        grid = torch.stack([u, self.v_grid], dim=-1).unsqueeze(0)
        return F.grid_sample(image.unsqueeze(0), grid, mode="bilinear", padding_mode="border", align_corners=False)[0]

    def _inner_curtain(self, back, amount):
        """開口の中の幕。割れて足へ寄る。戻りは 幕の色 と 残す割合。"""
        gap = self.gap_max * amount
        away = self.dx.abs()
        span = (INNER_HALF - gap).clamp(min=1.0)
        source = ((away - gap) / span).clamp(0.0, 1.0) * INNER_HALF
        source_x = 2159.0 + torch.sign(self.dx) * source
        color = self._sample_x(back, source_x)
        edge = away - gap
        shade = 1.0 - 0.45 * torch.exp(-(edge.clamp(min=0.0) / 90.0))  # 割れ目の端を少し暗く(幕の厚み)
        alpha = smooth(edge / 22.0 + 0.5) * self.inner * self.curtain_row
        # 開ききる手前で、開いた絵の留めた幕へ溶ける
        alpha = alpha * (1.0 - smooth((amount - 0.82) / 0.18))
        return color * shade, alpha

    def _outer_curtain(self, back, amount):
        """外の幕。額縁の足から外へ滑る。"""
        left_move, right_move = (LEG_LEFT + 80.0) * amount, (CANVAS[0] - LEG_RIGHT + 80.0) * amount
        left = self.x < 2159.0
        source_x = torch.where(left, self.x + left_move, self.x - right_move)
        color = self._sample_x(back, source_x)
        edge = torch.where(left, (LEG_LEFT - left_move) - self.x, self.x - (LEG_RIGHT + right_move))
        shade = 1.0 - 0.4 * torch.exp(-(edge.clamp(min=0.0) / 150.0))
        # 幕の上の黒い所では、境目を広くぼかす(開いた絵の縦の切れ目を見せない)
        feather = 60.0 + 1100.0 * ((UPPER_DARK - self.y) / UPPER_DARK).clamp(0.0, 1.0)
        alpha = smooth(edge / feather + 0.5) * self.curtain_row * (1.0 - self.inner)
        alpha = alpha * (edge > -feather)
        return color * shade, alpha

    def age(self, t):
        """開き始めからの経過(秒)。閉じている間は None。閉じる間は FULL_AGE から 0 へ戻る。"""
        for open_t, back in reversed(self.events):
            if t < open_t:
                continue
            if back is not None:
                done = back + self.close_end
                if t >= done:
                    return None
                if t >= done - self.close_sec:
                    return min(t - open_t, FULL_AGE * (done - t) / self.close_sec)
            return t - open_t
        return None

    def next(self, frame):
        self.frame = frame
        closed = self.closed.get(frame)
        age = self.age(frame / self.fps)
        if age is None or age <= 0.0:
            return closed
        opened = self._warped_open()
        inner, outer, floor = ease(age / INNER_SEC), ease(age / OUTER_SEC), ease(age / FLOOR_SEC)
        if float(outer) >= 1.0 and float(inner) >= 1.0 and float(floor) >= 1.0 and age > FG_SEC + 0.6:
            return opened
        back = closed * (1.0 - self.halo) + self.clean * self.halo
        picture = opened.clone()
        color, alpha = self._outer_curtain(back, float(outer))
        picture = picture * (1.0 - alpha) + color * alpha
        color, alpha = self._inner_curtain(back, float(inner))
        picture = picture * (1.0 - alpha) + color * alpha
        reach = float(floor) * 4400.0
        floor_left = smooth((self.dx.abs() - reach) / 500.0 + 0.5) * smooth((self.y - CURTAIN_BOTTOM) / 8.0)
        picture = picture * (1.0 - floor_left) + closed * floor_left
        spread = float(ease(age / FG_SEC)) * 4200.0
        fg_old = smooth((self.dx.abs() - spread) / 700.0 + 0.5)
        fg_color = closed * fg_old + opened * (1.0 - fg_old)
        return picture * (1.0 - self.fg) + fg_color * self.fg

    def close(self):
        self.closed.close()
        self.opened.close()


def _halo_mask(path, size, device):
    mask = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_GRAYSCALE)
    grow = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (HALO_REACH, HALO_REACH)))
    soft = cv2.GaussianBlur(grow.astype(np.float32) / 255.0, (0, 0), 8.0)
    return torch.from_numpy(cv2.resize(soft, size, interpolation=cv2.INTER_AREA)).to(device)


def _soften(mask, sigma):
    if sigma <= 0.0:
        return mask
    size = int(sigma * 6) | 1
    return torch.from_numpy(cv2.GaussianBlur(mask.cpu().numpy(), (size, size), sigma)).to(mask.device)
