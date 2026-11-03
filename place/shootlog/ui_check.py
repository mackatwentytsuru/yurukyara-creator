"""撮影記録の画面の自動の確かめ(iPad に入れたあと、本人の手なし)。Mac 経由で起動して、写真と押す物の枠を取り寄せて確かめ、並べた絵を作る。

  python place/shootlog/ui_check.py --out <出力フォルダ>
確かめる物(押す物の枠): ①親指のボタン(left・left2・right)は 88 pt 以上 ②どれも 44 pt 以上 ③押す物どうしが重ならない ④親指のボタン・上の帯の物が映像にかからない ⑤親指のボタンどうしの間が 24 pt 以上 ⑥右のボタン(録画)が撮影の全状態で同じ中心。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

DEV = "00008103-001959392279001E"
BUNDLE = "dev.hackathon.shootlog"
NAMES = ["1_prepare", "1_prepare_ng", "2_calib_ok", "2_calib_running", "2_calib_held", "3_cut", "4_shoot_idle", "4_shoot_rec", "4_shoot_rec_lost", "4_shoot_alarm", "4_shoot_saved", "5_takes"]
PANEL_OK = {"hostField", "micSwitch", "cutField", "lensControl", "exposureSwitch", "isoSlider", "guideSwitch"}


def ssh(cmd, timeout=200):
    r = subprocess.run(["ssh", "pc3", "export PATH=/opt/homebrew/bin:$PATH; " + cmd], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return r.stdout + r.stderr


def check(name, info, problems, right_centres):
    ts = info["targets"]
    px, py, pw, ph = info["picture"]
    for t in ts:
        if t["id"] in ("left", "left2", "right") and min(t["w"], t["h"]) < 88:
            problems.append(f"{name}: {t['id']} が小さい {t['w']:.0f}×{t['h']:.0f}")
        if min(t["w"], t["h"]) < 44 and t["id"] not in PANEL_OK:
            problems.append(f"{name}: {t['id']} が 44 pt 未満 {t['w']:.0f}×{t['h']:.0f}")
        if t["id"] not in PANEL_OK and not t["id"].startswith("mark"):
            if t["x"] < px + pw and t["x"] + t["w"] > px and t["y"] < py + ph and t["y"] + t["h"] > py:
                problems.append(f"{name}: {t['id']} が映像にかかる")
        if t["x"] < 0 or t["y"] < 0 or t["x"] + t["w"] > info["bounds"][0] or t["y"] + t["h"] > info["bounds"][1]:
            problems.append(f"{name}: {t['id']} が画面の外")
    for i, a in enumerate(ts):
        for b in ts[i + 1:]:
            if a["x"] < b["x"] + b["w"] and a["x"] + a["w"] > b["x"] and a["y"] < b["y"] + b["h"] and a["y"] + a["h"] > b["y"]:
                problems.append(f"{name}: {a['id']} と {b['id']} が重なる")
    th = [t for t in ts if t["id"] in ("left", "left2", "right")]
    for i, a in enumerate(th):
        for b in th[i + 1:]:
            gap = max(b["x"] - (a["x"] + a["w"]), a["x"] - (b["x"] + b["w"]))
            if gap < 24:
                problems.append(f"{name}: {a['id']} と {b['id']} の間が {gap:.0f} pt")
    if name.startswith("4_"):
        r = next((t for t in ts if t["id"] == "right"), None)
        if r:
            right_centres.add((round(r["x"] + r["w"] / 2), round(r["y"] + r["h"] / 2)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    print(ssh(f"xcrun devicectl device process launch --device {DEV} --terminate-existing {BUNDLE} --ui-sweep 2>&1 | tail -1").strip())
    time.sleep(3 + 3 + len(NAMES) * 0.7 + 3)
    cmd = "rm -rf /tmp/ui; mkdir /tmp/ui; " + "; ".join(
        f"xcrun devicectl device copy from --device {DEV} --domain-type appDataContainer --domain-identifier {BUNDLE} --source Documents/ui_{n}.{e} --destination /tmp/ui/ui_{n}.{e} > /dev/null 2>&1"
        for n in NAMES for e in ("png", "json")) + "; ls /tmp/ui | wc -l"
    print("取り寄せ:", ssh(cmd, 400).strip())
    subprocess.run(["scp", "-q", "pc3:/tmp/ui/*", str(out)], check=False)
    problems: list[str] = []
    centres: set = set()
    tiles = []
    font = ImageFont.truetype(r"C:\Windows\Fonts\YuGothB.ttc", 30)
    for n in NAMES:
        js, png = out / f"ui_{n}.json", out / f"ui_{n}.png"
        if not js.exists():
            problems.append(f"{n}: 取り寄せられなかった")
            continue
        check(n, json.loads(js.read_text(encoding="utf-8")), problems, centres)
        im = cv2.imdecode(np.fromfile(str(png), np.uint8), 1)
        pil = Image.fromarray(cv2.cvtColor(cv2.resize(im, (800, int(800 * im.shape[0] / im.shape[1])), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(pil)
        d.rectangle([250, 44, 560, 86], fill=(255, 255, 0))
        d.text((258, 46), n, fill=(0, 0, 0), font=font)
        tiles.append(cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR))
    if len(centres) > 1:
        problems.append(f"録画のボタンの位置が状態で変わる: {sorted(centres)}")
    while len(tiles) % 3:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i:i + 3]) for i in range(0, len(tiles), 3)]
    ok, buf = cv2.imencode(".jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
    (out / "ui_sheet.jpg").write_bytes(buf.tobytes())
    print("並べた絵:", out / "ui_sheet.jpg")
    print("問題:", len(problems))
    for p in problems:
        print(" ", p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
