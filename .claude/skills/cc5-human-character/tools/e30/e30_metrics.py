"""E30 の「自動写真判定」= 写真(手本)と CC5 の絵を、同じ角度で計算だけで比べて数字にする(AI の文章の判断は使わない)。
数字は全部「小さいほど似ている」。手本の顔の点で、候補の絵を手本の枠へ相似変換でそろえてから、部位ごとに比べる:
  lm   : 顔の点の部位別の差(2D、%IOD)                         ← 既存(et_face)
  hog  : 部位の切り抜きの向きの勾配(HOG、CLAHE で明暗をそろえる)の距離 ← 形の線(まぶた・唇の線・眉・輪郭)の比べ
  ssim : 部位の切り抜きの 1 − SSIM(CLAHE で明暗をそろえる)         ← 濃淡の構造の比べ
  sil  : 顔の輪郭の面(点の凸包)の 1 − IoU                        ← 輪郭の面の比べ
使い方(関数として): import e30_metrics as M; M.compare(ref_path, cand_path) → {"lm": {...}, "hog": {...}, "ssim": {...}, "sil": {...}}"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import et_face as F  # noqa: E402

REGIONS = ["eyes", "brows", "nose", "mouth", "outline"]
_cache = {}


def lmk(path):
    if path not in _cache:
        d = F.detect_file(path)
        if not d.get("detected"):
            raise ValueError("顔が取れない: " + path)
        _cache[path] = (np.asarray(d["pts2d"], float)[:468], np.asarray(d["pts3d"], float), cv2.imread(path))
    return _cache[path]


def clahe_gray(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(g)


def ssim(a, b):
    a, b = a.astype(np.float64), b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    k = (7, 7)
    mu1, mu2 = cv2.GaussianBlur(a, k, 1.5), cv2.GaussianBlur(b, k, 1.5)
    s11 = cv2.GaussianBlur(a * a, k, 1.5) - mu1 * mu1
    s22 = cv2.GaussianBlur(b * b, k, 1.5) - mu2 * mu2
    s12 = cv2.GaussianBlur(a * b, k, 1.5) - mu1 * mu2
    m = ((2 * mu1 * mu2 + c1) * (2 * s12 + c2)) / ((mu1 ** 2 + mu2 ** 2 + c1) * (s11 + s22 + c2))
    return float(m.mean())


_hog = cv2.HOGDescriptor((64, 64), (16, 16), (8, 8), (8, 8), 9)


def hog_dist(a, b):
    ha, hb = _hog.compute(cv2.resize(a, (64, 64))).ravel(), _hog.compute(cv2.resize(b, (64, 64))).ravel()
    return float(np.linalg.norm(ha - hb) / np.sqrt(len(ha)) * 10)


def compare(ref_path, cand_path):
    rp2, rp3, rimg = lmk(ref_path)
    cp2, cp3, cimg = lmk(cand_path)
    # 候補の絵を手本の枠へ(顔の点 468 個で相似変換)
    M, _ = cv2.estimateAffinePartial2D(cp2, rp2, method=cv2.LMEDS)
    warped = cv2.warpAffine(cimg, M, (rimg.shape[1], rimg.shape[0]), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    gr, gc = clahe_gray(rimg), clahe_gray(warped)
    out = {"lm": {}, "hog": {}, "ssim": {}, "sil": {}}
    lmd, _ = F.region_distance(cp3, rp3, 2)
    out["lm"] = {k: float(lmd[k]) for k in REGIONS + ["all"]}
    allhog, allss = [], []
    for k in REGIONS:
        idx = F.SETS[k] if k != "outline" else list(range(468))
        q = rp2[idx]
        x0, y0, x1, y1 = q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max()
        w, h = x1 - x0, y1 - y0
        pad = 0.25
        xa, ya = int(max(0, x0 - pad * w)), int(max(0, y0 - pad * h))
        xb, yb = int(min(rimg.shape[1], x1 + pad * w)), int(min(rimg.shape[0], y1 + pad * h))
        ca, cb = gr[ya:yb, xa:xb], gc[ya:yb, xa:xb]
        out["hog"][k] = hog_dist(ca, cb)
        out["ssim"][k] = 1.0 - ssim(cv2.resize(ca, (128, 128)), cv2.resize(cb, (128, 128)))
        allhog.append(out["hog"][k])
        allss.append(out["ssim"][k])
    out["hog"]["all"], out["ssim"]["all"] = float(np.mean(allhog)), float(np.mean(allss))
    # 輪郭の面(外周の点の凸包)の IoU
    h, w = rimg.shape[:2]
    ma, mb = np.zeros((h, w), np.uint8), np.zeros((h, w), np.uint8)
    pa = cv2.convexHull(rp2[F.SETS["outline"]].astype(np.int32))
    pb = cv2.convexHull((cv2.transform(cp2[F.SETS["outline"]][None], M)[0]).astype(np.int32))
    cv2.fillConvexPoly(ma, pa, 1)
    cv2.fillConvexPoly(mb, pb, 1)
    out["sil"] = {"outline": float(1.0 - (ma & mb).sum() / max(1, (ma | mb).sum()))}
    out["sil"]["all"] = out["sil"]["outline"]
    return out
