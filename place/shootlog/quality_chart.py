"""端末どうし(iPad と iPhone など)の画質の比べ用の絵を作り、撮った 1 コマから数字を出す。

  python place/shootlog/quality_chart.py make  --out chart_5120x1440.png
  python place/shootlog/quality_chart.py measure --frame 撮ったコマ.png --name iPad --out-json iPad.json
  python place/shootlog/quality_chart.py sheet --a iPad.json --b iPhone.json --out 比べ.png

絵(5120×1440 のモニターに全画面): 左=色の見本 24 枚+灰色の段階、中央=放射状の星(解像)+斜めの縁+日本語の文字(小さい順)、
右=ChArUco の盤(位置合わせ・画角の比べ)。2 台を「同じ位置から、同じ絵を、露出を固定して」撮り、同じ領域を等倍で並べる。
測る物: 縁の立ち上がり(10〜90% の幅、画素)、平らな灰色のばらつき(雑音)、色の見本の平均の色、盤の角の検出数。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 5120, 1440
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# ColorChecker 風の 24 色(sRGB。目で見る比べ用の近似値)
PATCHES = [
    (115, 82, 68), (194, 150, 130), (98, 122, 157), (87, 108, 67), (133, 128, 177), (103, 189, 170),
    (214, 126, 44), (80, 91, 166), (193, 90, 99), (94, 60, 108), (157, 188, 64), (224, 163, 46),
    (56, 61, 150), (70, 148, 73), (175, 54, 60), (231, 199, 31), (187, 86, 149), (8, 133, 161),
    (243, 243, 242), (200, 200, 200), (160, 160, 160), (122, 122, 121), (85, 85, 85), (52, 52, 52),
]
FLAT_GRAY = (128, 128, 128)
FONT_CANDIDATES = [r"C:\Windows\Fonts\YuGothM.ttc", r"C:\Windows\Fonts\meiryo.ttc", r"C:\Windows\Fonts\msgothic.ttc"]

# 測る領域(絵の中の位置。測るときも同じ式を使う)
EDGE_BOX = (2100, 700, 2300, 900)        # 斜めの縁の四角(その中の縁)
FLAT_BOX = (800, 1000, 1100, 1200)       # 平らな灰色
PATCH0 = (300, 150)                      # 色の見本の左上
PATCH_SIZE = 150
BOARD_ORIGIN = (3800, 180)               # 盤の左上


def font(size: int):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size, index=0)
    return ImageFont.load_default()


def make_board(w=900, h=900):
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_1000)
    b = cv2.aruco.CharucoBoard((9, 9), 0.1, 0.075, d)
    img = b.generateImage((w, h), marginSize=0, borderBits=1)
    return img


def make() -> np.ndarray:
    im = Image.new("RGB", (W, H), (40, 40, 44))
    dr = ImageDraw.Draw(im)
    # 色の見本 6×4
    for i, c in enumerate(PATCHES):
        r, k = divmod(i, 6)
        x, y = PATCH0[0] + k * (PATCH_SIZE + 10), PATCH0[1] + r * (PATCH_SIZE + 10)
        dr.rectangle([x, y, x + PATCH_SIZE, y + PATCH_SIZE], fill=c)
    # 灰色の段階(0〜255 を 11 段)
    for i in range(11):
        v = round(255 * i / 10)
        x = PATCH0[0] + i * 80
        dr.rectangle([x, 880, x + 76, 960], fill=(v, v, v))
    dr.rectangle(FLAT_BOX, fill=FLAT_GRAY)
    dr.text((FLAT_BOX[0], FLAT_BOX[1] - 36), "平らな灰色(雑音を測る)", fill=(230, 230, 230), font=font(28))
    # 放射状の星(中央)
    cx, cy, R = 1800, 520, 330
    yy, xx = np.mgrid[0:2 * R, 0:2 * R]
    ang = np.arctan2(yy - R, xx - R)
    rad = np.hypot(yy - R, xx - R)
    star = (np.sin(48 * ang) > 0).astype(np.uint8) * 255
    star[rad > R] = 40
    star_rgb = np.stack([star] * 3, -1)
    arr = np.array(im)
    arr[cy - R:cy + R, cx - R:cx + R] = star_rgb
    im = Image.fromarray(arr)
    dr = ImageDraw.Draw(im)
    # 斜めの縁(5 度傾けた四角)
    sq = np.full((200, 200, 3), 30, np.uint8)
    sq[30:170, 30:170] = 235
    M = cv2.getRotationMatrix2D((100, 100), 5, 1.0)
    sq = cv2.warpAffine(sq, M, (200, 200), borderValue=(30, 30, 30), flags=cv2.INTER_AREA)
    arr = np.array(im)
    arr[EDGE_BOX[1]:EDGE_BOX[3], EDGE_BOX[0]:EDGE_BOX[2]] = sq
    im = Image.fromarray(arr)
    dr = ImageDraw.Draw(im)
    # 文字(大きさ違い)
    y = 80
    for sz in (56, 40, 30, 24, 20, 16):
        dr.text((2500, y), f"サンプル AaBb 0123456789 ({sz}px)", fill=(240, 240, 240), font=font(sz))
        y += sz + 24
    # 盤
    arr = np.array(im)
    b = make_board()
    x0, y0 = BOARD_ORIGIN
    arr[y0:y0 + b.shape[0], x0:x0 + b.shape[1]] = np.stack([b] * 3, -1)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def find_chart(gray: np.ndarray):
    """撮ったコマの中の盤を見つけ、絵の座標 → コマの座標のホモグラフィーを返す(盤の 4 隅の角から)。"""
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_1000)
    b = cv2.aruco.CharucoBoard((9, 9), 0.1, 0.075, d)
    det = cv2.aruco.CharucoDetector(b)
    cc, ci, _, _ = det.detectBoard(gray)
    if ci is None or len(ci) < 12:
        return None, 0
    # 盤の角の絵の上の位置(盤 900 px・9 マス → 100 px 刻み)
    obj = np.array([[(i % 8 + 1) * 100 + BOARD_ORIGIN[0], (i // 8 + 1) * 100 + BOARD_ORIGIN[1]] for i in ci.flatten()], np.float32)
    H_, _ = cv2.findHomography(obj, cc.reshape(-1, 2), cv2.RANSAC, 3.0)
    return H_, len(ci)


def edge_width(gray: np.ndarray, Hm):
    """斜めの縁の 10〜90% の立ち上がりの幅(コマの画素)。縁を横切る直線の明るさの平均から出す。"""
    corners = np.array([[EDGE_BOX[0], EDGE_BOX[1]], [EDGE_BOX[2], EDGE_BOX[1]], [EDGE_BOX[2], EDGE_BOX[3]], [EDGE_BOX[0], EDGE_BOX[3]]], np.float32).reshape(-1, 1, 2)
    pts = cv2.perspectiveTransform(corners, Hm).reshape(-1, 2)
    x0, y0 = np.floor(pts.min(0)).astype(int)
    x1, y1 = np.ceil(pts.max(0)).astype(int)
    roi = gray[y0:y1, x0:x1].astype(np.float32)
    if roi.size == 0:
        return None
    # 縁のなす向きは約 5 度。右の縁(明 → 暗)を、行ごとの位置合わせで重ねる。
    h, w = roi.shape
    mid = w // 2
    prof = []
    for r in range(h):
        row = roi[r, mid:]
        if row.size < 8:
            continue
        lo, hi = row[-5:].mean(), row[:5].mean()
        if hi - lo < 40:
            continue
        n = (row - lo) / (hi - lo)
        pos = np.interp(0.5, n[::-1], np.arange(len(n))[::-1]) if n[0] > 0.5 > n[-1] else None
        if pos is None:
            continue
        prof.append((r, pos, n))
    if len(prof) < 10:
        return None
    # 10% と 90% を横切る位置(線形補間)の差の中央値
    widths = []
    for _, _, n in prof:
        # n は明(1)→暗(0)。単調でない雑音を避けるため、最初に 0.9 を下回る所と、最初に 0.1 を下回る所を補間で求める
        i90 = np.where(n < 0.9)[0]
        i10 = np.where(n < 0.1)[0]
        if not len(i90) or not len(i10) or i90[0] == 0 or i10[0] == 0:
            continue
        a, b = i90[0], i10[0]
        x90 = a - 1 + (n[a - 1] - 0.9) / (n[a - 1] - n[a])
        x10 = b - 1 + (n[b - 1] - 0.1) / (n[b - 1] - n[b])
        widths.append(x10 - x90)
    return float(np.median(widths)) if widths else None


def measure(frame_path: Path, name: str, out_json: Path):
    bgr = cv2.imdecode(np.fromfile(str(frame_path), np.uint8), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    Hm, ncorner = find_chart(gray)
    res = {"name": name, "frame": str(frame_path), "size": [bgr.shape[1], bgr.shape[0]], "board_corners": ncorner}
    if Hm is None:
        res["error"] = "盤が見つからない"
        out_json.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        return res

    def warp(box):
        c = np.array([[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]], np.float32).reshape(-1, 1, 2)
        p = cv2.perspectiveTransform(c, Hm).reshape(-1, 2)
        return p

    # 絵 1 画素あたりのコマの画素(拡大の目安)
    p = warp((0, 0, 1000, 0))
    res["frame_px_per_chart_px"] = round(float(np.linalg.norm(p[1] - p[0]) / 1000), 4)
    # 平らな灰色
    fp = warp(FLAT_BOX).astype(np.int32)
    x0, y0 = fp.min(0) + 20
    x1, y1 = fp.max(0) - 20
    flat = gray[y0:y1, x0:x1].astype(np.float32)
    res["flat_gray_mean"] = round(float(flat.mean()), 1)
    res["flat_gray_std"] = round(float(flat.std()), 2)
    # 色の見本: 各見本の中央の平均の BGR → RGB
    mean_rgb = []
    for i in range(24):
        r, k = divmod(i, 6)
        x, y = PATCH0[0] + k * (PATCH_SIZE + 10) + PATCH_SIZE // 2, PATCH0[1] + r * (PATCH_SIZE + 10) + PATCH_SIZE // 2
        c = cv2.perspectiveTransform(np.array([[[x, y]]], np.float32), Hm).reshape(2)
        s = max(4, int(res["frame_px_per_chart_px"] * 30))
        cx, cy = int(c[0]), int(c[1])
        patch = bgr[cy - s:cy + s, cx - s:cx + s].reshape(-1, 3).mean(0)[::-1]
        mean_rgb.append([round(float(v), 1) for v in patch])
    res["patch_rgb"] = mean_rgb
    ref = np.array(PATCHES, np.float32)
    got = np.array(mean_rgb, np.float32)
    gain = (got.mean(0) / ref.mean(0))
    res["patch_mean_gain_rgb"] = [round(float(v), 3) for v in gain]
    res["patch_rms_err_after_gain"] = round(float(np.sqrt((((got / gain) - ref) ** 2).mean())), 2)
    ew = edge_width(gray, Hm)
    res["edge_10_90_px"] = None if ew is None else round(ew, 2)
    res["edge_10_90_chart_px"] = None if ew is None else round(ew / res["frame_px_per_chart_px"], 2)
    out_json.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


def crop_chart(frame_path: Path, res: dict, box, scale=1.0):
    """絵の領域 box を、撮ったコマの上で同じ領域(拡大しないで等倍)を切り出す。"""
    bgr = cv2.imdecode(np.fromfile(str(frame_path), np.uint8), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    Hm, _ = find_chart(gray)
    c = cv2.perspectiveTransform(np.array([[[(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]]], np.float32), Hm).reshape(2)
    cw, ch = 480, 300
    x0, y0 = int(c[0] - cw / 2), int(c[1] - ch / 2)
    x0, y0 = max(0, min(bgr.shape[1] - cw, x0)), max(0, min(bgr.shape[0] - ch, y0))
    return bgr[y0:y0 + ch, x0:x0 + cw]


def sheet(a_json: Path, b_json: Path, out: Path):
    ja, jb = json.loads(a_json.read_text(encoding="utf-8")), json.loads(b_json.read_text(encoding="utf-8"))
    ia = cv2.imdecode(np.fromfile(ja["frame"], np.uint8), cv2.IMREAD_COLOR)
    ib = cv2.imdecode(np.fromfile(jb["frame"], np.uint8), cv2.IMREAD_COLOR)
    tw = 960
    ra = cv2.resize(ia, (tw, int(ia.shape[0] * tw / ia.shape[1])), interpolation=cv2.INTER_AREA)
    rb = cv2.resize(ib, (tw, int(ib.shape[0] * tw / ib.shape[1])), interpolation=cv2.INTER_AREA)
    f = font(34)

    def label(img, text):
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(pil)
        d.rectangle([0, 0, pil.width, 54], fill=(0, 0, 0))
        d.text((12, 8), text, fill=(255, 255, 255), font=f)
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

    top = np.hstack([label(ra, f"{ja['name']}(全体)"), label(rb, f"{jb['name']}(全体)")])
    rows = [top]
    for title, box in (("星(解像)", (1470, 190, 2130, 850)), ("縁と色の見本", (2000, 600, 2400, 1000)), ("文字", (2500, 80, 3300, 330))):
        ca, cb = crop_chart(Path(ja["frame"]), ja, box), crop_chart(Path(jb["frame"]), jb, box)
        pad = np.zeros((300, 960, 3), np.uint8)
        la, lb = pad.copy(), pad.copy()
        la[:, :480], lb[:, :480] = ca, cb
        # 右半分は 2 倍に拡大(最近傍。画素の見え方)
        la[:, 480:] = cv2.resize(ca[75:225, 120:360], (480, 300), interpolation=cv2.INTER_NEAREST)
        lb[:, 480:] = cv2.resize(cb[75:225, 120:360], (480, 300), interpolation=cv2.INTER_NEAREST)
        rows.append(np.hstack([label(la, f"{ja['name']} 等倍+2倍({title})"), label(lb, f"{jb['name']} 等倍+2倍({title})")]))
    img = np.vstack(rows)
    ok, buf = cv2.imencode(".png", img)
    out.write_bytes(buf.tobytes())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make")
    m.add_argument("--out", required=True)
    me = sub.add_parser("measure")
    me.add_argument("--frame", required=True)
    me.add_argument("--name", required=True)
    me.add_argument("--out-json", required=True)
    s = sub.add_parser("sheet")
    s.add_argument("--a", required=True)
    s.add_argument("--b", required=True)
    s.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "make":
        img = make()
        ok, buf = cv2.imencode(".png", img)
        Path(a.out).write_bytes(buf.tobytes())
        print("作った:", a.out, img.shape)
    elif a.cmd == "measure":
        print(json.dumps(measure(Path(a.frame), a.name, Path(a.out_json)), ensure_ascii=False))
    else:
        sheet(Path(a.a), Path(a.b), Path(a.out))
        print("作った:", a.out)


if __name__ == "__main__":
    main()
