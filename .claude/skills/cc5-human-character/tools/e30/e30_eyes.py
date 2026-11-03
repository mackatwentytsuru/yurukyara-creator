"""E30: 目の大きさの数字(黒目の径、目の開き)を、手本(画像生成、正面)と CC5 の絵で比べる。本人の指摘「今、目が小さい」を数字にする。
MediaPipe の虹彩の点(468〜477)から: 黒目の径 ÷ 目の間の距離(IOD)、目の幅 ÷ IOD、目の開き(上下まぶたの距離)÷ 目の幅。左右の平均。
使い方: <venv python> e30_eyes.py [CC5 の絵のフォルダや絵 ...]     出力: eval_runs\\E30_base\\eyes_sizes.md"""
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import et_face as F  # noqa: E402

E = r"work\cc5_human_1102\eval_runs"
EF = E + r"\EREF"


def sizes(path):
    d = F.detect_file(path)
    if not d.get("detected"):
        return None
    p = np.asarray(d["pts2d"], float)
    iod = d["iod_px"]
    rc = np.linalg.norm(p[469] - p[471])
    rv = np.linalg.norm(p[470] - p[472])
    lc = np.linalg.norm(p[474] - p[476])
    lv = np.linalg.norm(p[475] - p[477])
    iris = np.mean([rc, rv, lc, lv]) / iod
    ew = (np.linalg.norm(p[33] - p[133]) + np.linalg.norm(p[263] - p[362])) / 2 / iod
    eh = (np.linalg.norm(p[159] - p[145]) + np.linalg.norm(p[386] - p[374])) / 2 / iod
    return {"iris": iris, "eye_w": ew, "eye_h": eh, "open": eh / ew}


items = [("手本 f0_G1", EF + r"\flat_g\gen_f0_G1.png"), ("手本 f0_G2", EF + r"\flat_g\gen_f0_G2.png"), ("手本 f0_G1_2", EF + r"\flat_cg\gen_f0_G1_2.png"), ("手本 f0_G1_3", EF + r"\flat_cg\gen_f0_G1_3.png"),
         ("元の写真 nl1", E + r"\E07_refaudit\in\nl1.png")]
for a in sys.argv[1:]:
    g = sorted(glob.glob(os.path.join(a, "*rz+000*.png"))) if os.path.isdir(a) else [a]
    for x in g:
        if "warmup" not in x:
            items.append((os.path.basename(os.path.dirname(x)) if os.path.isdir(a) else os.path.basename(x), x))
rows = []
md = ["# 目の大きさの数字(正面、MediaPipe の虹彩の点、IOD = 目の間の距離で割る)", "", "| 絵 | 黒目の径 ÷ IOD | 目の幅 ÷ IOD | 目の開き ÷ 目の幅 |", "|---|---|---|---|"]
for lab, p in items:
    s = sizes(p)
    rows.append((lab, s))
    md.append(f"| {lab} | " + (f"{s['iris']:.3f} | {s['eye_w']:.3f} | {s['open']:.3f}" if s else "測れない | | ") + " |")
refs = [s for lab, s in rows if lab.startswith("手本") and s]
if refs:
    m = {k: float(np.mean([r[k] for r in refs])) for k in ("iris", "eye_w", "open")}
    md.append(f"| **手本 4 枚の平均** | **{m['iris']:.3f}** | **{m['eye_w']:.3f}** | **{m['open']:.3f}** |")
open(E + r"\E30_base\eyes_sizes.md", "w", encoding="utf-8").write("\n".join(md) + "\n")
print("\n".join(md))
