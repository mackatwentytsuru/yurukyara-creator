"""E30/E31 の部位カード(目): 手本と CG を同じ倍率(目の間の距離 = 400 px)で同じ範囲に切り抜いて並べた絵 1 枚と、「形」「見え方」を分けた数字。
計算だけ(AI の文章の判定は使わない)。本人が 5 秒で判断できる形。文字は幅の 3% 以上(幅 1500 px → 46 px)。
使い方: <venv python> e30_card_eyes.py <今の CG の絵> <自動後などの CG の絵(省略可)> [出力の名前]       出力: eval_runs\\E30_base\\card_eyes_<名前>.png・.md"""
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e30_eye_direct as D  # noqa: E402

E = r"work\cc5_human_1102\eval_runs"
EF = E + r"\EREF"
REFS = [EF + r"\flat_g\gen_f0_G1.png", EF + r"\flat_g\gen_f0_G2.png", EF + r"\flat_cg\gen_f0_G1_2.png", EF + r"\flat_cg\gen_f0_G1_3.png"]
cur_path = sys.argv[1]
after_path = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("-") else ""
name = sys.argv[3] if len(sys.argv) > 3 else "now"

ms = [D.measure(p) for p in REFS]
mc = D.measure(cur_path)
ma = D.measure(after_path) if after_path else None
KEYS = ["limbus_d", "aperture_w", "aperture_h", "iod_over_facew", "iris_L", "iris_C", "pupil_ratio", "spec_frac", "edge_contrast", "lid_dark", "lash_energy", "lash_cover", "lash_depth", "lash_width", "caruncle_red", "iris_warm", "iris_cool", "iris_ring_dh"]
ref = {k: float(np.mean([m[k] for m in ms])) for k in KEYS}
ref_sd = {k: float(np.std([m[k] for m in ms])) for k in KEYS}
ref_ab = (float(np.mean([m["iris_a"] for m in ms])), float(np.mean([m["iris_b"] for m in ms])))


def dH(m):
    a1, b1 = ref_ab
    a2, b2 = m["iris_a"], m["iris_b"]
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    dh = math.radians(abs(math.degrees(math.atan2(b2, a2)) - math.degrees(math.atan2(b1, a1))))
    dh = min(dh, 2 * math.pi - dh)
    return 2 * math.sqrt(max(c1 * c2, 0)) * math.sin(dh / 2)


def crop(m):
    img = m["_img"]
    mid = np.array(m["_mid"])
    w, h = int(0.78 * 400), int(0.21 * 400)
    x0, y0 = int(mid[0] - w), int(mid[1] - h - 0.01 * 400)
    c = img[max(0, y0):y0 + 2 * h, max(0, x0):x0 + 2 * w]
    return Image.fromarray(cv2.cvtColor(cv2.resize(c, (1400, int(1400 * c.shape[0] / c.shape[1])), interpolation=cv2.INTER_CUBIC), cv2.COLOR_BGR2RGB))


W = 1500
fb, fs = ImageFont.truetype(r"C:\Windows\Fonts\meiryob.ttc", 54), ImageFont.truetype(r"C:\Windows\Fonts\meiryo.ttc", 46)
rows = [("形", None, None, None)]
rows += [("黒目の径(÷目の間隔)", "limbus_d", "{:.3f}", 1), ("目の開きの幅", "aperture_w", "{:.3f}", 1), ("目の開きの高さ", "aperture_h", "{:.3f}", 1), ("目の間隔 ÷ 頭の幅", "iod_over_facew", "{:.3f}", 1)]
rows += [("見え方", None, None, None)]
rows += [("黒目の明るさ L", "iris_L", "{:.1f}", 1), ("黒目の彩度 C", "iris_C", "{:.1f}", 1), ("黒目の色相の差 ΔH", "dH", "{:.1f}", 0),
         ("虹彩の暖色(茶)の割合", "iris_warm", "{:.0%}", 1), ("虹彩の寒色(青)の割合", "iris_cool", "{:.0%}", 1), ("虹彩の内外の色の差", "iris_ring_dh", "{:.1f}", 1),
         ("黒目と白目の明暗の差", "edge_contrast", "{:.1f}", 1)]
rows += [("まつげ・目頭", None, None, None)]
rows += [("まつげの太さ(÷目の間隔)", "lash_width", "{:.4f}", 1), ("まつげの量(帯の中の面積)", "lash_cover", "{:.1%}", 1), ("まつげの濃さ(肌との明るさの差)", "lash_depth", "{:.1f}", 1),
         ("まつげの強さ(勾配)", "lash_energy", "{:.1f}", 1), ("上まぶたの帯の暗さ", "lid_dark", "{:.1f}", 1), ("目頭の赤さ(肌との a* の差)", "caruncle_red", "{:.1f}", 1)]
rows += [("参考値(手本の絵の崩れの影響あり。目標にしない)", None, None, None)]
rows += [("瞳孔の径 ÷ 黒目の径", "pupil_ratio", "{:.2f}", 1), ("反射(明るい点)の面積", "spec_frac", "{:.1%}", 1)]
REFONLY = {"pupil_ratio", "spec_frac"}


def val(m, k):
    return dH(m) if k == "dH" else m[k]


crops = [("手本(画像生成)", crop(ms[0])), ("今の CG", crop(mc))] + ([("自動の 1 周後", crop(ma))] if ma else [])
ch = crops[0][1].size[1]
H = 120 + len(crops) * (ch + 70) + 90 + len(rows) * 70 + 120
img = Image.new("RGB", (W, H), (255, 255, 255))
dr = ImageDraw.Draw(img)
dr.text((30, 20), "目のカード(正面)", font=fb, fill=(0, 0, 0))
y = 100
for lab, c in crops:
    dr.text((30, y), lab, font=fs, fill=(0, 0, 140))
    img.paste(c, (50, y + 56))
    y += ch + 70
y += 10
x_cols = [30, 640, 860, 1080, 1280] if ma else [30, 700, 960, 1180, 1380]
hdr = ["項目", "手本", "今の CG"] + (["自動後"] if ma else []) + ["差"]
for x, h in zip(x_cols, hdr):
    dr.text((x, y), h, font=fs, fill=(80, 80, 80))
y += 64
for lab, k, fmt, has_ref in rows:
    if k is None:
        dr.rectangle([20, y, W - 20, y + 62], fill=(230, 235, 245))
        dr.text((30, y + 6), "【" + lab + "】", font=fs, fill=(0, 0, 0))
        y += 70
        continue
    vr = 0.0 if k == "dH" else ref[k]
    vc = val(mc, k)
    d = vc - vr
    sd = ref_sd.get(k, 0.0) if k != "dH" else 2.0
    bad = abs(d) > max(2 * sd, 1e-9) and abs(d) > (0.03 * abs(vr) if vr else 0)
    col = (200, 0, 0) if bad else (0, 120, 0)
    if k in REFONLY:
        col = (130, 130, 130)
    dr.text((x_cols[0], y), lab, font=fs, fill=(0, 0, 0))
    dr.text((x_cols[1], y), ("—" if k == "dH" else fmt.format(vr)), font=fs, fill=(0, 0, 0))
    dr.text((x_cols[2], y), fmt.format(vc), font=fs, fill=col)
    if ma:
        dr.text((x_cols[3], y), fmt.format(val(ma, k)), font=fs, fill=(0, 0, 0))
    if k == "dH":
        dr.text((x_cols[-1], y), f"{vc:.1f}", font=fs, fill=col)
    else:
        pct = (d / vr * 100) if vr else 0
        dr.text((x_cols[-1], y), f"{pct:+.0f}%", font=fs, fill=col)
    y += 70
dr.text((30, y + 10), "赤 = 手本のゆらぎの 2 倍と 3% を超える差。緑 = 手本の範囲内。", font=fs, fill=(90, 90, 90))
img = img.crop((0, 0, W, y + 80))
out = os.path.join(E, "E30_base", f"card_eyes_{name}.png")
img.save(out)
md = ["| 項目 | 手本 | 今の CG | 自動後 | 差 |", "|---|---|---|---|---|"]
for lab, k, fmt, _ in rows:
    if k is None:
        continue
    vr = 0.0 if k == "dH" else ref[k]
    md.append(f"| {lab} | {('—' if k == 'dH' else fmt.format(vr))} | {fmt.format(val(mc, k))} | {fmt.format(val(ma, k)) if ma else ''} | {(val(mc, k) - vr):+.3f} |")
open(os.path.join(E, "E30_base", f"card_eyes_{name}.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
print("\n".join(md))
print(out, img.size)
