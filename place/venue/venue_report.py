"""場面ごと(座席 × 演者の立ち位置)に、座席から見た絵・LED の隠れる所の絵・数字を作る。Claude の指摘(claude_review.py)の入力になる。

  python place/venue/venue_report.py --media <LED の絵 5680x1240 の png> --out <出力フォルダ> [--details venue_details.json]
出力: view_<座席>_<演者>.png(ブラウザのシミュレーターの絵)、hidden_<座席>_<演者>.png(面ごとの絵に、隠れる所を赤・斜めすぎる所を青で重ねた絵)、numbers.json
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import venue as V  # noqa: E402

REPO = V.REPO
FONT_PATHS = ["C:/Windows/Fonts/YuGothB.ttc", "C:/Windows/Fonts/meiryo.ttc", "C:/Windows/Fonts/msgothic.ttc"]


def font(size):
    for p in FONT_PATHS:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def hidden_picture(media_path, seat, perf, step_px=4.0, oblique_cos=0.6):
    """面(A・B・C)ごとに、LED に出る絵を並べ、演者に隠れる所を赤、見る角度が斜めすぎる所(cos が小さい)を青で重ねる。"""
    pv, det = V.view(seat["eye"], perf["performers"], step_px)
    img = Image.open(media_path).convert("RGB")
    W, H = V.L.CANVAS_W, V.L.CANVAS_H
    if img.size != (int(W), int(H)):
        img = img.resize((int(W), int(H)))
    arr = np.asarray(img).astype(np.float32)
    faces = {"A": ["LED_A"], "B": ["LED_B_L", "LED_B_R"], "C": [p["name"] for p in V.plates() if p["name"].startswith("LED_C")]}
    strips = []
    for f, names in faces.items():
        x_lo = min(det[n]["cx"].min() for n in names)
        x_hi = max(det[n]["cx"].max() for n in names)
        y_lo = min(det[n]["cy"].min() for n in names)
        y_hi = max(det[n]["cy"].max() for n in names)
        x_lo, x_hi, y_lo, y_hi = int(x_lo), int(x_hi) + 1, int(y_lo), int(y_hi) + 1
        crop = arr[y_lo:y_hi, x_lo:x_hi].copy()
        tint = np.zeros_like(crop)
        alpha = np.zeros(crop.shape[:2], np.float32)
        for n in names:
            d = det[n]
            for mask, color, a in [(d["hid_p"], (255, 40, 40), 0.65), (d["cos"] < oblique_cos, (60, 120, 255), 0.35)]:
                idx = np.where(mask)[0]
                if len(idx) == 0:
                    continue
                xs = np.clip((d["cx"][idx] - x_lo).astype(int), 0, crop.shape[1] - 1)
                ys = np.clip((d["cy"][idx] - y_lo).astype(int), 0, crop.shape[0] - 1)
                r = int(step_px // 2) + 1
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        yy = np.clip(ys + dy, 0, crop.shape[0] - 1)
                        xx = np.clip(xs + dx, 0, crop.shape[1] - 1)
                        tint[yy, xx] = color
                        alpha[yy, xx] = np.maximum(alpha[yy, xx], a)
        out = crop * (1 - alpha[..., None]) + tint * alpha[..., None]
        strips.append((f, Image.fromarray(out.clip(0, 255).astype(np.uint8)), (x_lo, x_hi)))
    gap, title_h = 16, 56
    total_h = sum(s[1].height + title_h + gap for s in strips)
    width = max(s[1].width for s in strips)
    canvas = Image.new("RGB", (width, total_h), (20, 20, 24))
    dr = ImageDraw.Draw(canvas)
    y = 0
    fm = V.group_faces(pv)
    for f, im, (xl, xh) in strips:
        dr.text((8, y + 6), f"{f} 面(絵の x {xl}〜{xh})  見える {fm[f]['visible']*100:.0f}%  演者に隠れる {fm[f]['hidden_by_performer']*100:.1f}%(赤)  いちばん斜めの cos {fm[f]['min_cos']}(青は cos<{oblique_cos})", fill=(255, 255, 255), font=font(34))
        canvas.paste(im, (0, y + title_h))
        y += im.height + title_h + gap
    return canvas, pv


def render_views(out, media, details, scenario):
    from playwright.sync_api import sync_playwright
    port = free_port()
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=REPO,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/place/web/venue_sim.html", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        # 絵は repo の外なので、サーバーの下にコピーを置く(終わりに消す)
        tmp = REPO / "place" / "web" / "_venue_media.png"
        tmp.write_bytes(Path(media).read_bytes())
        det_tmp = None
        if details:
            det_tmp = REPO / "place" / "web" / "_venue_details.json"
            det_tmp.write_bytes(Path(details).read_bytes())
        done = []
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            for seat in scenario["seats"]:
                for perf in scenario["performer_sets"]:
                    pg = br.new_page(viewport={"width": 1280, "height": 720})
                    errs = []
                    pg.on("pageerror", lambda e: errs.append(str(e)))
                    url = (f"http://127.0.0.1:{port}/place/web/venue_sim.html?seat={seat['id']}&perf={perf['id']}"
                           f"&media=/place/web/_venue_media.png&ui=0" + ("&details=/place/web/_venue_details.json" if det_tmp else ""))
                    pg.goto(url)
                    pg.wait_for_function("window.venueReady === true", timeout=60000)
                    time.sleep(0.5)
                    p = out / f"view_{seat['id']}_{perf['id']}.png"
                    pg.screenshot(path=str(p))
                    if errs:
                        print("ブラウザのエラー:", errs)
                    done.append(p)
                    pg.close()
            br.close()
        return done
    finally:
        server.terminate()
        for n in ("_venue_media.png", "_venue_details.json"):
            f = REPO / "place" / "web" / n
            if f.exists():
                f.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--details", default=None)
    ap.add_argument("--scenario", default=None)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sc = V.load_scenario(a.scenario)
    numbers = {"note": sc.get("note", ""), "results": []}
    for seat in sc["seats"]:
        for perf in sc["performer_sets"]:
            pic, pv = hidden_picture(a.media, seat, perf)
            pic.save(out / f"hidden_{seat['id']}_{perf['id']}.png")
            numbers["results"].append({"seat": seat["id"], "seat_name": seat["name"], "eye_cm": seat["eye"], "perf": perf["id"],
                                       "perf_name": perf["name"], "performers": perf["performers"], "faces": V.group_faces(pv), "plates": pv})
    (out / "numbers.json").write_text(json.dumps(numbers, ensure_ascii=False, indent=1), encoding="utf-8")
    views = render_views(out, a.media, a.details, sc)
    print("書いた:", out, "絵", len(views), "枚 + 隠れる所の絵", len(numbers["results"]), "枚")


if __name__ == "__main__":
    main()
