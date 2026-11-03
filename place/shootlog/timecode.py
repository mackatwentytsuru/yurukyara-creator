"""画面に出す「機械で読めるコマ番号(タイムコード)」の帯と、カメラの映像から読む道具。ゲンロックの代わり。

帯 = 18 個のセルが横に並ぶ: 先頭が白(基準)・次が黒(基準)・残り 16 個がコマ番号の Gray コード(上位から)。面の上端と下端に 1 本ずつ置く。
 - Gray コードなので、露出の間に画面が切り替わっても、ずれるのは 1 ビットだけ(その位置は「どっちつかず」と分かる)。
 - 上と下の帯の番号の差は、ローリングシャッターで画面の上から下まで読む間に進んだコマ数。
読み取りは、盤から求めた面→画像の射影(ホモグラフィー)で帯の各セルの中心の明るさを、白・黒の基準で 0〜1 にして 0.5 で分ける。
使い方は timecode_selftest.py と read_timecode.py。
"""
from __future__ import annotations

import numpy as np

BITS = 16
CELLS = BITS + 2


def gray_encode(n: int) -> int:
    return n ^ (n >> 1)


def gray_decode(g: int) -> int:
    n = 0
    while g:
        n ^= g
        g >>= 1
    return n


def make_strips(face_w: int, face_h: int, tc_h: int, x0: int | None = None) -> list[dict]:
    """帯の置き場所(面の画素)。セルは一辺 tc_h の正方形。上端と下端。"""
    width = CELLS * tc_h
    if x0 is None:
        x0 = max(0, (face_w - width) // 2)
    return [{"name": "top", "x": x0, "y": 0, "cell": tc_h}, {"name": "bottom", "x": x0, "y": face_h - tc_h, "cell": tc_h}]


def draw(img: np.ndarray, n: int, strips: list[dict]) -> np.ndarray:
    """面の画像(グレー、H×W)に、コマ番号 n の帯を描く(上書き)。"""
    g = gray_encode(n % (1 << BITS))
    for s in strips:
        c = s["cell"]
        x, y = s["x"], s["y"]
        img[y:y + c, x:x + CELLS * c] = 0
        img[y:y + c, x:x + c] = 255                      # 白の基準
        for b in range(BITS):                              # 上位ビットから
            if (g >> (BITS - 1 - b)) & 1:
                img[y:y + c, x + (2 + b) * c:x + (3 + b) * c] = 255
    return img


def cell_points(strip: dict) -> np.ndarray:
    """各セルの中心(面の画素)(CELLS,2)。"""
    c = strip["cell"]
    return np.array([[strip["x"] + (i + 0.5) * c, strip["y"] + 0.5 * c] for i in range(CELLS)], float)


def decode(gray_img: np.ndarray, H_face_to_img: np.ndarray, strip: dict, patch_frac: float = 0.25, amb: float = 0.2):
    """カメラの画像(グレー)から、帯のコマ番号を読む。戻り: (番号 or None, 明るさの 0〜1 の配列, 混ざったビット数)。
    混ざったビットが 0 個なら整数、1 個なら「次のコマの寄与の割合」を足した小数(露出の中のどこで切り替わったか。ミリ秒より細かい位相)、2 個以上は読めない(None)。"""
    import cv2
    pts = cell_points(strip).reshape(-1, 1, 2)
    uv = cv2.perspectiveTransform(pts, H_face_to_img).reshape(-1, 2)
    h, w = gray_img.shape[:2]
    vals = []
    for (u, v), (pu, pv) in zip(uv, pts.reshape(-1, 2)):
        # セルの中心の周りの小さな範囲(面の座標 ±patch_frac セル)の平均
        c = strip["cell"]
        corners = np.array([[pu + dx * c * patch_frac, pv + dy * c * patch_frac] for dx in (-1, 1) for dy in (-1, 1)], np.float32).reshape(-1, 1, 2)
        cu = cv2.perspectiveTransform(corners, H_face_to_img).reshape(-1, 2)
        x0, y0 = np.floor(cu.min(0)).astype(int), np.floor(cu.min(0)).astype(int)
        x0, y0 = max(int(cu[:, 0].min()), 0), max(int(cu[:, 1].min()), 0)
        x1, y1 = min(int(cu[:, 0].max()) + 1, w), min(int(cu[:, 1].max()) + 1, h)
        if x1 <= x0 or y1 <= y0:
            return None, np.zeros(CELLS), CELLS
        vals.append(float(gray_img[y0:y1, x0:x1].mean()))
    vals = np.array(vals)
    white, black = vals[0], vals[1]
    if white - black < 20:
        return None, np.zeros(CELLS), CELLS
    norm = (vals - black) / (white - black)
    bit_norm = norm[2:]
    amb_idx = [i for i, v in enumerate(bit_norm) if 0.1 < v < 0.9]   # 露出の間に切り替わったビット(混ざった明るさ)
    n_amb = len(amb_idx)
    if n_amb == 0:
        g = 0
        for v in bit_norm:
            g = (g << 1) | int(v > 0.5)
        return float(gray_decode(g)), norm, 0
    if n_amb == 1:
        i = amb_idx[0]
        cands = []
        for b in (0, 1):
            g = 0
            for j, v in enumerate(bit_norm):
                g = (g << 1) | (b if j == i else int(v > 0.5))
            cands.append(gray_decode(g))
        lo, hi = min(cands), max(cands)
        if (hi - lo) % (1 << BITS) not in (1, (1 << BITS) - 1):
            return None, norm, 1
        n_hi = cands[1] if cands[1] != lo else cands[0]
        frac_hi = bit_norm[i] if cands[1] == n_hi else 1.0 - bit_norm[i]   # 混ざった割合 = 次のコマの寄与(露出の中での切り替わりの位置)
        return lo + float(frac_hi), norm, 1
    return None, norm, n_amb
