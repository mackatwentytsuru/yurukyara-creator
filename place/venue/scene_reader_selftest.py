"""scene_reader.py の合成の確かめ。シミュレーターの箱に置き物を正解の位置で置き、6 か所のカメラから描いた絵を「撮影」として渡し、
Claude が読んだ位置を、正解と比べる(CG の絵なので、実写より読みやすい。実写の精度ではない)。

  python place/venue/scene_reader_selftest.py --out <出力フォルダ> [--n 6]
出力: 正解との距離(cm)の一覧。撮影の形(video.mov・frames.jsonl・meta.json)で作るので、scene_reader.py にそのまま渡せる。
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

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

TRUTH = [  # 正解(cm、シミュレーターの座標)
    {"name": "柱1", "kind": "pillar", "x_cm": -500, "y_cm": 800},
    {"name": "柱2", "kind": "pillar", "x_cm": 600, "y_cm": 900},
    {"name": "ポール1", "kind": "pole", "x_cm": -100, "y_cm": 700},
    {"name": "ポール2", "kind": "pole", "x_cm": 250, "y_cm": 1000},
    {"name": "スピーカー", "kind": "speaker", "x_cm": -800, "y_cm": 650},
]
POSES = [  # (目 x, y, z)、(見る点 x, y, z)
    ((-300, 1500, 150), (-100, 500, 60)), ((200, 1600, 150), (0, 500, 40)), ((600, 1400, 150), (-100, 600, 40)),
    ((-700, 1300, 150), (100, 600, 40)), ((0, 1250, 150), (-300, 500, 40)), ((-600, 1450, 150), (300, 600, 40)),
]
MM35 = 24


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_shoot(out: Path, n: int):
    from playwright.sync_api import sync_playwright
    port = free_port()
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=REPO,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    details_tmp = REPO / "place" / "web" / "_truth_details.json"
    media_tmp = REPO / "place" / "web" / "_truth_media.png"
    try:
        details_tmp.write_text(json.dumps({"objects": TRUTH}, ensure_ascii=False), encoding="utf-8")
        media = Path("work/_venue_work/media_40s.png")
        if media.exists():
            media_tmp.write_bytes(media.read_bytes())
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/place/web/venue_sim.html", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        frames, imgs = [], []
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(f"http://127.0.0.1:{port}/place/web/venue_sim.html?ui=0&details=/place/web/_truth_details.json" + ("&media=/place/web/_truth_media.png" if media.exists() else ""))
            pg.wait_for_function("window.venueReady === true", timeout=60000)
            for i, (eye, look) in enumerate(POSES[:n]):
                pg.evaluate("([e,l,m]) => window.venueSim.setPose(e,l,m)", [list(eye), list(look), MM35])
                info = pg.evaluate("() => window.venueSim.cameraInfo()")
                png = pg.screenshot()
                img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
                imgs.append(img)
                frames.append({"i": i, "t": i * 1.0, "pts": i * 1.0, "T": info["T"], "K": info["K"], "track": "normal", "ok": True})
            br.close()
    finally:
        server.terminate()
        for f in (details_tmp, media_tmp):
            if f.exists():
                f.unlink()
    out.mkdir(parents=True, exist_ok=True)
    h, w = imgs[0].shape[:2]
    # 各絵を 3 コマずつ(scene_reader の 3 コマおきの選び方でも拾えるように)並べた動画
    vw = cv2.VideoWriter(str(out / "video.mov"), cv2.VideoWriter_fourcc(*"mp4v"), 30, (w, h))
    fr2 = []
    k = 0
    for fr, img in zip(frames, imgs):
        for _ in range(6):
            vw.write(img)
            fr2.append({**fr, "i": k, "pts": k / 30.0})
            k += 1
    vw.release()
    (out / "frames.jsonl").write_text("\n".join(json.dumps(f) for f in fr2), encoding="utf-8")
    meta = {"videoFile": "video.mov", "stats": {"width": w, "height": h, "frames": k}, "calibration": {"floor": {"planeY": 0.0}}, "format": "camera-pose-log/1"}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return out


def compare(details_path: Path):
    res = json.loads(details_path.read_text(encoding="utf-8"))
    rows, used = [], set()
    # 床の位置(世界 m)と正解(cm → m)。世界は three の (x, z) = (x_cm, y_cm) / 100
    for t in TRUTH:
        best = None
        for j, o in enumerate(res["objects"]):
            if j in used:
                continue
            d = float(np.hypot(o["world_m"][0] * 100 - t["x_cm"], o["world_m"][2] * 100 - t["y_cm"]))
            if best is None or d < best[0]:
                best = (d, j, o)
        if best and best[0] < 150:
            used.add(best[1])
            rows.append({"truth": t["name"], "kind": t["kind"], "error_cm": round(best[0], 1), "n_views": best[2]["n_views"], "spread_cm": best[2]["spread_cm"], "read_name": best[2]["name"], "read_kind": best[2]["kind"]})
        else:
            rows.append({"truth": t["name"], "kind": t["kind"], "error_cm": None, "note": "見つからない(150 cm 以内に読んだ物なし)"})
    extra = [o["name"] for j, o in enumerate(res["objects"]) if j not in used]
    return rows, extra


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument("--skip-render", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    if not a.skip_render:
        make_shoot(out / "shoot", a.n)
    r = subprocess.run([sys.executable, str(REPO / "place" / "shootlog" / "scene_reader.py"), str(out / "shoot"), "--out", str(out / "read"),
                        "--n", str(a.n), "--model", a.model, "--radius", "1.0"], capture_output=True, text=True)
    print(r.stdout[-1500:])
    if r.returncode != 0:
        print(r.stderr[-1500:])
        sys.exit(1)
    rows, extra = compare(out / "read" / "venue_details.json")
    errs = [x["error_cm"] for x in rows if x["error_cm"] is not None]
    summary = {"rows": rows, "extra_read": extra, "found": f"{len(errs)}/{len(TRUTH)}",
               "median_error_cm": round(float(np.median(errs)), 1) if errs else None, "max_error_cm": max(errs) if errs else None}
    (out / "accuracy.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    for x in rows:
        print(x)
    print({k: v for k, v in summary.items() if k != "rows"})


if __name__ == "__main__":
    main()
