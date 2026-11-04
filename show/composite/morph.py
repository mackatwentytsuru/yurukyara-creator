"""変身(アニメ ⇄ 別の姿)の重ね。体が小さな塊ごとに粒子になって舞い上がり、別の姿の色の粒が集まって、別の姿になる。

入力は「姿 A と姿 B の色(かぶせ済み)と透明」と進み 0〜1 だけ。計算で決まり、乱数は種を固定した計算(座標の hash)なので、
途中のコマだけを作っても、続けて作っても同じ絵になる。composite.py の compose() が呼ぶ。

形:
- 体の中心から外へ、ノイズと高さを混ぜた順に、塊(CELL 画素角)が変わる。足からでも頭からでもない(硬い横線を出さない)。
- 塊は 3 つの段を通る(q 0〜1): A が薄れて粒になる → 粒が上へ舞い上がって色が A から B へ変わる → 粒が戻って B になる。
- 粒は 2〜5 画素(1920 幅)。数は体の面積に応じる(塊 1 つに 2 粒)。粒の色は元の姿の色から混ぜるだけで、明るく光らせない(純白を出さない)。
- A と B は同じ形(同じメッシュ)でも、違う形でも構わない。塊が薄れる間は A と B を重ねて、見える面積を落としすぎない。

使い方(composite.py の外から):
  state_at(morphs, t)  … その秒の状態。("anime"|"human", None) か ("morph", 元, 先, 進み)
  morph_layer(a_color, a_alpha, b_color, b_alpha, p)  … (色, 透明)。p が 0 なら A、1 なら B をそのまま返す
"""
import cv2
import numpy as np

SEED = 20261104
CELL = 3  # 塊の一辺(画素。1920 幅)
WINDOW = 0.42  # 1 つの塊が変わりきるのに使う進みの幅(小さいほど、塊ごとのずれが大きい)
PARTICLES_PER_CELL = 2
SIZES = np.array([2, 3, 4, 5, 6])  # 直径の目安(画素、1920 幅)。実際は 2〜6 の間で小数にばらす
SIZE_WEIGHTS = np.array([0.30, 0.30, 0.20, 0.13, 0.07])
OUT = (0.04, 0.16)  # 体の中心から外へ出る距離(身長に対する割合)
FAR_FRACTION = 0.16  # 遠くまで離れて薄れる粒の割合
FAR = (0.30, 0.50)  # その粒の離れる距離(身長に対する割合)
HEAD_HOLD = 0.0  # 頭と肩の塊が変わるのを遅らせる量(順への足し。1.0 で頭が浮き、0.3 でも頭と胴の差 0.503、0.0 で 0.219 に減った)
RISE = (0.05, 0.22)  # 舞い上がる高さ(身長に対する割合の範囲)
DRIFT = 0.12  # 横に流れる幅(身長に対する割合)
ORDER_WEIGHTS = (0.62, 0.26, 0.07, 0.12)  # 順を決める: 中心からの距離・なめらかなノイズ・塊ごとのノイズ・高さ
ORDER_SPAN = (0.17, 0.72)  # 上の合計(0〜1 に直したもの)のうち、実際に来る範囲。ここを 0〜1 に伸ばす
ALPHA_FLOOR = 0.5
LAST_ORDER_RANGE = [0.0, 0.0, 0.0, 0.0]  # 直近の、順の値の最小・2%・98%・最大(調整用)


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def state_at(morphs, t):
    """変身の予定(start・end・to の並び)から、秒 t の状態を返す。最初はアニメ。"""
    state = "anime"
    for m in sorted(morphs or [], key=lambda m: m["start"]):
        if t < m["start"]:
            break
        if t < m["end"] and m["to"] != state:
            return "morph", state, m["to"], (t - m["start"]) / max(1e-6, m["end"] - m["start"])
        state = m["to"]
    return state, None


def _hash(ix, iy, salt):
    """整数の座標と塩から 0〜1 の値(同じ入力なら必ず同じ)。"""
    a = (np.asarray(ix, np.int64) + (1 << 20)).astype(np.uint32)
    b = (np.asarray(iy, np.int64) + (1 << 20)).astype(np.uint32)
    h = a * np.uint32(374761393) + b * np.uint32(668265263) + np.uint32(((SEED + salt * 7919) * 2246822519) & 0xFFFFFFFF)
    h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
    h = h ^ (h >> np.uint32(16))
    return h.astype(np.float32) / np.float32(4294967295.0)


def _value_noise(x, y, spacing, salt):
    gx, gy = x / spacing, y / spacing
    ix, iy = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
    fx, fy = smooth(gx - ix), smooth(gy - iy)
    top = _hash(ix, iy, salt) * (1 - fx) + _hash(ix + 1, iy, salt) * fx
    bottom = _hash(ix, iy + 1, salt) * (1 - fx) + _hash(ix + 1, iy + 1, salt) * fx
    return top * (1 - fy) + bottom * fy


def _splat(shape, xs, ys, sizes, alphas, colors, seeds):
    """粒を丸く(縁をぼかし、粒ごとに少し楕円・向きがちがう)描き足す。戻りは (透明の合計, 色×透明の合計)。
    重なっても色は元の色の平均なので明るくならない。sizes は直径(画素、小数)。"""
    height, width = shape
    ang = seeds[0] * np.pi
    asp = 1.0 + 0.45 * seeds[1]  # 楕円の細長さ(1〜1.45)
    ca, sa = np.cos(ang), np.sin(ang)
    rad = sizes / 2.0
    reach = int(np.ceil(rad.max() * asp.max())) + 1 if len(sizes) else 1
    x0, y0 = np.floor(xs).astype(np.int64), np.floor(ys).astype(np.int64)
    idx, wts, own = [], [], []
    ids = np.arange(len(sizes))
    for oy in range(-reach, reach + 1):
        for ox in range(-reach, reach + 1):
            ix, iy = x0 + ox, y0 + oy
            dx, dy = ix + 0.5 - xs, iy + 0.5 - ys
            rx, ry = (dx * ca + dy * sa) / asp, (-dx * sa + dy * ca) * asp
            w = smooth((rad - np.sqrt(rx * rx + ry * ry) + 0.5) / 1.4)  # 縁は約 1.4 画素でぼける
            ok = (w > 0) & (ix >= 0) & (ix < width) & (iy >= 0) & (iy < height)
            idx.append((iy * width + ix)[ok]), wts.append((alphas * w)[ok]), own.append(ids[ok])
    total = np.zeros(height * width, np.float32)
    color = np.zeros((height * width, 3), np.float32)
    if not idx:
        return total.reshape(height, width), color.reshape(height, width, 3)
    index, weight, owner = np.concatenate(idx), np.concatenate(wts), np.concatenate(own)
    total = np.bincount(index, weight, height * width).astype(np.float32)
    for c in range(3):
        color[:, c] = np.bincount(index, weight * colors[owner, c], height * width)
    return total.reshape(height, width), color.reshape(height, width, 3)


def _cell_means(image, cy, cx):
    return cv2.resize(np.ascontiguousarray(image), (cx, cy), interpolation=cv2.INTER_AREA).reshape(cy, cx, -1)


def morph_layer(a_color, a_alpha, b_color, b_alpha, p):
    """A から B へ。色はかぶせ済み(色×透明)、透明は (高さ, 幅, 1)。p は 0〜1。戻りは (色, 透明) で同じ形。"""
    if p <= 0.0:
        return a_color, a_alpha
    if p >= 1.0:
        return b_color, b_alpha
    height, width = a_alpha.shape[:2]
    cover = np.maximum(a_alpha, b_alpha)[..., 0]
    rows, cols = np.where(cover > ALPHA_FLOOR)
    if rows.size == 0:  # 体が無い(どちらも写っていない)コマは、混ぜるだけ
        return a_color * (1 - p) + b_color * p, a_alpha * (1 - p) + b_alpha * p
    top, bottom, left, right = rows.min(), rows.max(), cols.min(), cols.max()
    tall = float(bottom - top + 1)
    margin_top, margin_side = int(tall * 0.6) + 8, int(tall * 0.6) + 8
    y0, y1 = max(0, top - margin_top) // CELL * CELL, min(height, bottom + int(tall * 0.3) + 12)
    x0, x1 = max(0, left - margin_side) // CELL * CELL, min(width, right + margin_side + 1)
    y1, x1 = y0 + (y1 - y0) // CELL * CELL, x0 + (x1 - x0) // CELL * CELL
    cy, cx = (y1 - y0) // CELL, (x1 - x0) // CELL
    sl = (slice(y0, y1), slice(x0, x1))
    ca, aa, cb, ab = a_color[sl], a_alpha[sl], b_color[sl], b_alpha[sl]

    # 塊ごとの値(中心の座標・透明・直線でなく見た目の色の平均)
    xc = x0 + (np.arange(cx, dtype=np.float32) + 0.5) * CELL
    yc = y0 + (np.arange(cy, dtype=np.float32) + 0.5) * CELL
    xc, yc = np.meshgrid(xc, yc)
    cell_a = _cell_means(np.maximum(aa, ab), cy, cx)[..., 0]
    body = cell_a > 0.35
    weight = np.maximum(cell_a, 1e-3)
    straight_a = _cell_means(ca, cy, cx) / np.maximum(_cell_means(aa, cy, cx), 1e-3)
    straight_b = _cell_means(cb, cy, cx) / np.maximum(_cell_means(ab, cy, cx), 1e-3)

    # 変わる順: 中心(体の重心の少し上)から外へ + ノイズ + 高さ
    mass = np.maximum(cover[sl], 0.0)
    centre_x = float((mass.sum(axis=0) * (x0 + np.arange(x1 - x0))).sum() / max(mass.sum(), 1e-3))
    centre_y = top + 0.45 * tall
    u, v = (xc - centre_x) / tall, (yc - centre_y) / tall
    radius = np.clip(np.sqrt((u / 0.28) ** 2 + (v / 0.5) ** 2) / 1.6, 0.0, 1.0)
    fine = (_value_noise(xc, yc, 16.0, 1) + 0.5 * _value_noise(xc, yc, 8.0, 2)) / 1.5
    white = _hash(np.floor(xc / CELL), np.floor(yc / CELL), 3)
    wr, wn, ww, wh = ORDER_WEIGHTS
    head = np.exp(-(((v + 0.40) / 0.15) ** 2)) * np.exp(-((u / 0.22) ** 2))  # 頭と肩のあたり(体の上 10〜25%)
    order = (wr * radius + wn * fine + ww * white + wh * (np.clip(v, -0.5, 0.5) + 0.5) + HEAD_HOLD * head) / sum(ORDER_WEIGHTS)
    LAST_ORDER_RANGE[:] = [float(order[body].min()), float(np.percentile(order[body], 2)), float(np.percentile(order[body], 98)), float(order[body].max())]
    order = np.clip((order - ORDER_SPAN[0]) / (ORDER_SPAN[1] - ORDER_SPAN[0]), 0.0, 1.0)
    q = np.clip((p - order * (1.0 - WINDOW)) / WINDOW, 0.0, 1.0)

    # 体: A が薄れ、B が現れる(途中で重なって、見える面積を落としすぎない)
    visible_a = 1.0 - smooth((q - 0.08) / 0.55)
    visible_b = smooth((q - 0.35) / 0.55)
    va = cv2.GaussianBlur(cv2.resize(visible_a, (cx * CELL, cy * CELL), interpolation=cv2.INTER_NEAREST), (0, 0), 0.7)[..., None]
    vb = cv2.GaussianBlur(cv2.resize(visible_b, (cx * CELL, cy * CELL), interpolation=cv2.INTER_NEAREST), (0, 0), 0.7)[..., None]
    body_color = va * ca + (1.0 - va) * vb * cb
    body_alpha = va * aa + (1.0 - va) * vb * ab

    # 粒
    sel = np.nonzero(body & (q > 0.0) & (q < 1.0))
    gy, gx = sel
    particles_x, particles_y, particles_size, particles_alpha, particles_color, particles_seed = [], [], [], [], [], []
    for k in range(PARTICLES_PER_CELL):
        salt = 10 + k * 17
        qq = q[sel]
        jitter = (_hash(gx + x0 // CELL, gy + y0 // CELL, salt) - 0.5) * 0.16
        qk = np.clip(qq + jitter * np.sin(np.pi * qq), 0.0, 1.0)
        hs = lambda off: _hash(gx + x0 // CELL, gy + y0 // CELL, salt + off)
        rise = tall * (RISE[0] + (RISE[1] - RISE[0]) * hs(1))
        drift = tall * DRIFT * (hs(2) - 0.5)
        phase = hs(3)
        far = hs(5) < FAR_FRACTION
        norm = np.maximum(np.hypot(u[sel], v[sel]), 0.05)
        out = tall * np.where(far, FAR[0] + (FAR[1] - FAR[0]) * hs(6), OUT[0] + (OUT[1] - OUT[0]) * hs(6))
        h = np.sin(np.pi * qk)
        swirl = tall * 0.025 * np.sin(2 * np.pi * (qk * 1.5 + phase))
        px = xc[sel] + (drift + swirl) * h + out * (u[sel] / norm) * h - x0
        py = yc[sel] - rise * h + out * (v[sel] / norm) * h * 0.6 - y0 - np.where(far, 0.25 * out, 0.0) * h
        pick = hs(4)
        base = SIZES[np.searchsorted(np.cumsum(SIZE_WEIGHTS), pick).clip(0, len(SIZES) - 1)]
        size = np.clip(base + (hs(7) - 0.5) * 1.6, 2.0, 6.0).astype(np.float32)
        alpha = smooth(qk / 0.1) * (1.0 - smooth((qk - 0.9) / 0.1)) * (1.0 - 0.45 * h) * cell_a[sel].clip(0, 1)
        alpha = alpha * np.where(far, 1.0 - 0.6 * h, 1.0)  # 遠くへ行く粒は離れるほど薄れる
        mix = smooth((qk - 0.3) / 0.4)[:, None]
        color = straight_a[sel] * (1.0 - mix) + straight_b[sel] * mix
        particles_seed.append(np.stack([hs(8), hs(9)]).astype(np.float32))
        particles_x.append(px), particles_y.append(py), particles_size.append(size)
        particles_alpha.append(alpha.astype(np.float32)), particles_color.append(color.astype(np.float32))
    total, color_sum = _splat((y1 - y0, x1 - x0), np.concatenate(particles_x), np.concatenate(particles_y), np.concatenate(particles_size),
                              np.concatenate(particles_alpha), np.concatenate(particles_color), np.concatenate(particles_seed, axis=1))
    particle_alpha = np.minimum(total, 1.0)
    particle_color = color_sum / np.maximum(total, 1e-6)[..., None] * particle_alpha[..., None]  # 色 = 重みつき平均 × 透明(元の色より明るくならない)
    particle_alpha = particle_alpha[..., None]

    out_color = np.zeros_like(a_color)
    out_alpha = np.zeros_like(a_alpha)
    out_color[sl] = particle_color + (1.0 - particle_alpha) * body_color
    out_alpha[sl] = particle_alpha + (1.0 - particle_alpha) * body_alpha
    return out_color, out_alpha


def particle_count(alpha, per_cell=PARTICLES_PER_CELL):
    """この体の面積で出る粒の数(全部の塊が一度は粒になる)。試験と報告の数字用。"""
    return int(((cv2.resize(alpha[..., 0], (alpha.shape[1] // CELL, alpha.shape[0] // CELL), interpolation=cv2.INTER_AREA) > 0.35).sum()) * per_cell)
