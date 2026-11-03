"""E30/E31: 目の見え方を、画像から直接測る(MediaPipe の虹彩の点の径は使わない。司令塔の指示 11-03: 数字を正としない)。
各目の切り抜き(目の間の距離 IOD = 400 px にそろえる)で:
  limbus_d  : 黒目(虹彩)の見えている径 ÷ IOD。虹彩の中心の近く(±0.03 IOD)を探しながら、左右の弧(まぶたに隠れない側)で、半径を変えたときの明るさの上がり方(黒目 → 白目の縁)が最大になる半径。
  aperture_w / aperture_h : 目の開き(まぶたの点で作った多角形)の幅・高さ ÷ IOD(これは顔の点の形)。
  iris_L / iris_C : 黒目のリング(径の 55〜90%)の Lab の L(明るさ)と彩度 C。
  sclera_L : 白目の明るさ(開きの中で虹彩のリングの外側の明るい部分の上位 30% の平均 L)。
  edge_contrast : 黒目のリングの外側の白目との明るさの差(L)。
  lid_dark : 上まぶたのすぐ上の帯(まつげ・アイライン・影)の平均 L と、まぶたの上の肌の L の差(暗いほど大きい)。
  lash_energy : 上まぶたの上の帯の勾配の強さ(まつげの密度の目安)。
使い方: <venv python> e30_eye_direct.py [--overlay 出力フォルダ] <絵 または 絵のフォルダ ...>   絵の名前とフォルダ名を表の行名にする
出力: eval_runs\\E30_base\\eye_direct.md。--overlay を付けると、各絵の左右の目の切り抜きに合わせた円を重ねた絵を出す(手で確かめるため)。"""
import argparse
import glob
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import et_face as F  # noqa: E402

E = r"work\cc5_human_1102\eval_runs"
EF = E + r"\EREF"
ap = argparse.ArgumentParser()
ap.add_argument("--overlay", default="")
ap.add_argument("--out", default=E + r"\E30_base\eye_direct.md")
ap.add_argument("paths", nargs="*")
a = ap.parse_args() if __name__ == "__main__" else ap.parse_args([])

# 目の点(MediaPipe 468 点): 右目(画像の左)・左目
EYES = {
    "R": {"iris": 468, "corner": (33, 133), "upper": [246, 161, 160, 159, 158, 157, 173], "lower": [7, 163, 144, 145, 153, 154, 155]},
    "L": {"iris": 473, "corner": (263, 362), "upper": [466, 388, 387, 386, 385, 384, 398], "lower": [249, 390, 373, 374, 380, 381, 382]},
}


def lab(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32) * np.array([100 / 255, 1, 1], np.float32) - np.array([0, 128, 128], np.float32)


def one_eye(img_lab, gray, p, iod, e):
    """p: 478 点(px)。戻り値 dict と、重ね描き用の (cx, cy, r)。"""
    c0 = p[e["iris"]]
    upper, lower = p[e["upper"]], p[e["lower"]]
    # 目の開きの多角形のマスク
    poly = np.vstack([upper, lower[::-1]]).astype(np.int32)
    mask = np.zeros(gray.shape, np.uint8)
    cv2.fillPoly(mask, [poly], 1)
    # limbus: 中心を ±0.03 IOD 探索、半径 0.05〜0.17 IOD、左右の弧
    best = (-1e9, c0, 0.0)
    gs = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), max(1.0, iod * 0.004))
    angs = np.deg2rad(np.concatenate([np.arange(-40, 41, 8), np.arange(140, 221, 8)]))
    for dx in np.linspace(-0.03, 0.03, 7) * iod:
        for dy in np.linspace(-0.02, 0.02, 5) * iod:
            c = c0 + np.array([dx, dy])
            radii = np.linspace(0.05, 0.17, 25) * iod
            prof = []
            for r in radii:
                xs, ys = c[0] + r * np.cos(angs), c[1] + r * np.sin(angs)
                ok = (xs >= 0) & (xs < gray.shape[1] - 1) & (ys >= 0) & (ys < gray.shape[0] - 1) & (mask[np.clip(ys.astype(int), 0, gray.shape[0] - 1), np.clip(xs.astype(int), 0, gray.shape[1] - 1)] > 0)
                prof.append(float(gs[ys[ok].astype(int), xs[ok].astype(int)].mean()) if ok.sum() >= 3 else np.nan)
            prof = np.array(prof)
            if np.isnan(prof).any():
                continue
            g = prof[2:] - prof[:-2]  # 半径が増えたときの明るさの上がり
            k = int(np.argmax(g))
            score = g[k]
            if score > best[0]:
                best = (score, c, float(radii[k + 1]))
    _, c, r = best
    out = {"limbus_d": 2 * r / iod}
    # 目の開きの幅・高さ
    cx0, cx1 = p[e["corner"][0]], p[e["corner"][1]]
    out["aperture_w"] = float(np.linalg.norm(cx0 - cx1)) / iod
    out["aperture_h"] = float(np.linalg.norm(upper[3] - lower[3])) / iod
    yy, xx = np.mgrid[0:gray.shape[0], 0:gray.shape[1]]
    d = np.sqrt((xx - c[0]) ** 2 + (yy - c[1]) ** 2)
    ring = (d > 0.55 * r) & (d < 0.9 * r) & (mask > 0)
    if ring.sum() > 20:
        Lc = img_lab[..., 0][ring].mean()
        chroma = np.sqrt(img_lab[..., 1][ring] ** 2 + img_lab[..., 2][ring] ** 2).mean()
    else:
        Lc, chroma = float("nan"), float("nan")
    out["iris_L"], out["iris_C"] = float(Lc), float(chroma)
    if ring.sum() > 20:
        am, bm = img_lab[..., 1][ring].mean(), img_lab[..., 2][ring].mean()
        out["iris_h"] = float(np.degrees(np.arctan2(bm, am)))
        out["iris_a"], out["iris_b"] = float(am), float(bm)
    else:
        out["iris_h"] = out["iris_a"] = out["iris_b"] = float("nan")
    inner = (d < 0.9 * r) & (mask > 0)
    Lv = img_lab[..., 0]
    if inner.sum() > 50:
        pupil_thr = max(8.0, min(0.5 * Lc, 20.0)) if not np.isnan(Lc) else 15.0
        pm = ((Lv < pupil_thr) & inner).astype(np.uint8)
        n, lbl, stats, cents = cv2.connectedComponentsWithStats(pm)
        parea = float(stats[1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])), cv2.CC_STAT_AREA]) if n > 1 else 0.0
        out["pupil_ratio"] = float(2 * np.sqrt(parea / np.pi) / (2 * r)) if r > 0 else float("nan")
        out["spec_frac"] = float(((Lv > 85) & inner).sum() / max(1, inner.sum()))
    else:
        out["pupil_ratio"] = out["spec_frac"] = float("nan")
    outside = (mask > 0) & (d > 1.15 * r)
    if outside.sum() > 20:
        vals = np.sort(img_lab[..., 0][outside])
        sclera = float(vals[int(len(vals) * 0.7):].mean())
    else:
        sclera = float("nan")
    out["sclera_L"] = sclera
    out["edge_contrast"] = float(sclera - Lc) if not np.isnan(sclera + Lc) else float("nan")
    # 上まぶたの帯
    band = np.zeros(gray.shape, np.uint8)
    up = upper.copy()
    for t in (0.012, 0.03):
        pass
    ptsb = np.vstack([up + np.array([0, -0.035 * iod]), up[::-1] + np.array([0, -0.004 * iod])]).astype(np.int32)
    cv2.fillPoly(band, [ptsb], 1)
    skin_m = np.zeros(gray.shape, np.uint8)
    pts_s = np.vstack([up + np.array([0, -0.12 * iod]), up[::-1] + np.array([0, -0.07 * iod])]).astype(np.int32)
    cv2.fillPoly(skin_m, [pts_s], 1)
    if band.sum() > 20 and skin_m.sum() > 20:
        out["lid_dark"] = float(img_lab[..., 0][skin_m > 0].mean() - img_lab[..., 0][band > 0].mean())
        gx = cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
        out["lash_energy"] = float(np.abs(gx[band > 0]).mean())
    else:
        out["lid_dark"], out["lash_energy"] = float("nan"), float("nan")
    # まつげ(司令塔の指摘 11-03: 手本は細く薄く、CG は太く濃い): 上まぶたの上の帯(0.06 IOD)の中で、肌より L が 18 以上暗い画素を「まつげ」として、量・太さ・濃さを出す
    band2 = np.zeros(gray.shape, np.uint8)
    pts2 = np.vstack([up + np.array([0, -0.06 * iod]), up[::-1] + np.array([0, -0.004 * iod])]).astype(np.int32)
    cv2.fillPoly(band2, [pts2], 1)
    if band2.sum() > 20 and skin_m.sum() > 20:
        Ls = img_lab[..., 0]
        skin_L = float(np.median(Ls[skin_m > 0]))
        # 影やまぶたのしわ(太くてなだらかな暗がり)を除くため、細い暗い線だけを残す黒の top-hat(カーネル 11 px = 0.0275 IOD)を使う
        bh = cv2.morphologyEx(img_lab[..., 0].astype(np.float32), cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
        dark = ((bh > 10) & (band2 > 0)).astype(np.uint8)
        out["lash_cover"] = float(dark.sum() / band2.sum())
        out["lash_depth"] = float(skin_L - Ls[dark > 0].mean()) if dark.sum() > 10 else float("nan")
        cnts, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        per = sum(cv2.arcLength(cn, True) for cn in cnts)
        out["lash_width"] = float(2.0 * dark.sum() / per / iod) if per > 0 else float("nan")  # 太さ(IOD に対する比): 面積 ÷ (周長 ÷ 2)
    else:
        out["lash_cover"] = out["lash_depth"] = out["lash_width"] = float("nan")
    # 目頭の赤さ(涙丘): 目頭の点のまわり半径 0.045 IOD の中で、a* が高い上位 30% の平均 − 肌の a* の中央値
    ci = p[e["corner"][1]]
    cm = ((xx - ci[0]) ** 2 + (yy - ci[1]) ** 2 < (0.045 * iod) ** 2) & (mask > 0)
    if cm.sum() > 20 and skin_m.sum() > 20:
        av = np.sort(img_lab[..., 1][cm])
        out["caruncle_red"] = float(av[int(len(av) * 0.7):].mean() - np.median(img_lab[..., 1][skin_m > 0]))
    else:
        out["caruncle_red"] = float("nan")
    # 虹彩の暖色(茶)と寒色(青)の割合: 黒目の 0.35〜0.9 半径の輪で、b* > 8 を暖色、b* < −3 を寒色
    an = (d > 0.35 * r) & (d < 0.9 * r) & (mask > 0) & (img_lab[..., 0] > 12)
    if an.sum() > 50:
        bb = img_lab[..., 2][an]
        out["iris_warm"], out["iris_cool"] = float((bb > 8).mean()), float((bb < -3).mean())
        inn = (d > 0.35 * r) & (d < 0.6 * r) & (mask > 0) & (img_lab[..., 0] > 12)
        out_r = (d > 0.65 * r) & (d < 0.9 * r) & (mask > 0) & (img_lab[..., 0] > 12)
        if inn.sum() > 20 and out_r.sum() > 20:
            out["iris_ring_dh"] = float(math.hypot(img_lab[..., 1][inn].mean() - img_lab[..., 1][out_r].mean(), img_lab[..., 2][inn].mean() - img_lab[..., 2][out_r].mean()))
        else:
            out["iris_ring_dh"] = float("nan")
    else:
        out["iris_warm"] = out["iris_cool"] = out["iris_ring_dh"] = float("nan")
    return out, (float(c[0]), float(c[1]), float(r))


def measure(path, overlay_dir=""):
    d = F.detect_file(path)
    if not d.get("detected"):
        return None
    img = cv2.imread(path)
    p = np.asarray(d["pts2d"], float)
    k = 400.0 / d["iod_px"]
    img = cv2.resize(img, (int(img.shape[1] * k), int(img.shape[0] * k)), interpolation=cv2.INTER_CUBIC)
    p = p * k
    iod = 400.0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    L = lab(img)
    res, ov = {}, []
    for name, e in EYES.items():
        r, circ = one_eye(L, gray, p, iod, e)
        res[name] = r
        ov.append((name, circ, p[e["iris"]]))
    avg = {key: float(np.nanmean([res["R"][key], res["L"][key]])) for key in res["R"]}
    avg["iod_over_facew"] = float(iod / np.linalg.norm(p[234] - p[454]))
    avg["_img"] = img
    avg["_mid"] = ((p[468] + p[473]) / 2).tolist()
    if overlay_dir:
        os.makedirs(overlay_dir, exist_ok=True)
        tiles = []
        for name, (cx, cy, r), _ in ov:
            half = int(0.32 * iod)
            vis = img.copy()
            cv2.circle(vis, (int(cx), int(cy)), int(r), (0, 255, 0), 1)
            crop = vis[max(0, int(cy) - half // 2):int(cy) + half // 2, max(0, int(cx) - half):int(cx) + half]
            tiles.append(cv2.resize(crop, (int(crop.shape[1] * 2.2), int(crop.shape[0] * 2.2)), interpolation=cv2.INTER_CUBIC))
        h = min(t.shape[0] for t in tiles)
        w = sum(t.shape[1] for t in tiles)
        canvas = np.zeros((h, w, 3), np.uint8)
        x = 0
        for t in tiles:
            canvas[:h, x:x + t.shape[1]] = t[:h]
            x += t.shape[1]
        cv2.imwrite(os.path.join(overlay_dir, os.path.splitext(os.path.basename(path))[0] + "_eyes.png"), canvas)
    return avg


if __name__ == "__main__":
    items = [("手本 f0_G1", EF + r"\flat_g\gen_f0_G1.png"), ("手本 f0_G2", EF + r"\flat_g\gen_f0_G2.png"), ("手本 f0_G1_2", EF + r"\flat_cg\gen_f0_G1_2.png"), ("手本 f0_G1_3", EF + r"\flat_cg\gen_f0_G1_3.png"), ("元の写真 nl1", E + r"\E07_refaudit\in\nl1.png")]
    for x in a.paths:
        if os.path.isdir(x):
            for g in sorted(glob.glob(os.path.join(x, "*rz+000*.png"))):
                if "warmup" not in g:
                    items.append((os.path.basename(x), g))
        else:
            items.append((os.path.basename(x), x))
    KEYS = [("limbus_d", "黒目の径"), ("aperture_w", "開きの幅"), ("aperture_h", "開きの高さ"), ("iris_L", "黒目の明るさ L"), ("iris_C", "黒目の彩度 C"), ("sclera_L", "白目の明るさ L"), ("edge_contrast", "黒目と白目の差 L"), ("lid_dark", "上まぶたの帯の暗さ"), ("lash_energy", "まつげの強さ")]
    rows = []
    md = ["# 目の見え方を画像から直接測った数字(正面、目の間の距離 IOD = 400 px にそろえた切り抜き、左右の平均)", "", "| 絵 | " + " | ".join(n for _, n in KEYS) + " |", "|---|" + "---|" * len(KEYS)]
    for lab_, pth in items:
        m = measure(pth, a.overlay)
        rows.append((lab_, m))
        md.append(f"| {lab_} | " + (" | ".join(f"{m[k]:.3f}" if k in ("limbus_d", "aperture_w", "aperture_h") else f"{m[k]:.1f}" for k, _ in KEYS) if m else "測れない") + " |")
    refs = [m for lab_, m in rows if lab_.startswith("手本") and m]
    if refs:
        md.append("| **手本 4 枚の平均** | " + " | ".join((f"{np.mean([r[k] for r in refs]):.3f}" if k in ("limbus_d", "aperture_w", "aperture_h") else f"{np.mean([r[k] for r in refs]):.1f}") for k, _ in KEYS) + " |")
    open(a.out, "w", encoding="utf-8").write("\n".join(md) + "\n")
    print("\n".join(md))
