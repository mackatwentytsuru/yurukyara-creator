"""実写の 1 コマと、同じカメラの位置で描いたシミュレーターの絵を並べ、LED に出した盤(ChArUco)の角で一致を測る。

  python place/venue/side_by_side.py <撮影フォルダ> --frame <コマ番号> --alignment alignment_A.json --face A \
      --board board_A.json --media <LED に出した絵(5680x1240 の png。盤だけの面でもよい)> --out <出力フォルダ>
測る 3 つ(どれも、盤の角の画素の差。盤が写っていなければ出ない):
  photo_vs_calc  : 実写で見つけた角と、「ARKit の姿勢 + LED の位置合わせ」で計算した位置の差(合成に実際に使う形の誤差)
  sim_vs_calc    : シミュレーターの絵で見つけた角と、同じ計算の差(シミュレーターの形が計算と合っているかの確かめ。0 に近いはず)
  photo_vs_sim   : 実写とシミュレーターの絵の、角の差(「並べて一致を測る」の数字)
カメラの位置は撮影記録から。シミュレーターの LED の位置と大きさは show/ue/stage_layout.py の実測のまま(位置合わせは 4 隅のタップ)。
比べていない精度は言わない: 出る数字は「このコマ・この座席での、盤の角」の差だけ。
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
sys.path.insert(0, str(HERE.parent / "shootlog"))
import shootlib as S  # noqa: E402
from lenslib import Board, detect_corners, imwrite  # noqa: E402

sys.path.insert(0, str(REPO / "show" / "ue"))
import stage_layout as L  # noqa: E402

ORIGINS = {"A": (L.A_X0, 0.0), "B": (-L.B_X_HALF, L.B_Y), "C": (L.C_FLAT_X0, 0.0)}
M = 0.01


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def three_matrix(T_world_cam: np.ndarray, T_led_from_world: np.ndarray, face: str) -> np.ndarray:
    """ARKit の世界のカメラ → シミュレーター(three、m)のカメラ。LED の軸(x 右・y 上・z 客席)は three と同じ向きなので、平行移動だけ。"""
    (ox, oy), zb = ORIGINS[face], L.LED_Z_BOTTOM
    T_led_cam = T_led_from_world @ T_world_cam
    Tr = np.eye(4)
    Tr[:3, 3] = [ox * M, zb * M, oy * M]
    return Tr @ T_led_cam


def render_sim(T_three, fy, w, h, media: Path, out_png: Path, details=None):
    from playwright.sync_api import sync_playwright
    port = free_port()
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=REPO,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tmp = REPO / "place" / "web" / "_sbs_media.png"
    try:
        tmp.write_bytes(media.read_bytes())
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/place/web/venue_sim.html", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        vw = 1280
        vh = int(round(vw * h / w))
        fov = float(np.degrees(2 * np.arctan(h / (2 * fy))))
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            pg = br.new_page(viewport={"width": vw, "height": vh})
            pg.goto(f"http://127.0.0.1:{port}/place/web/venue_sim.html?ui=0&media=/place/web/_sbs_media.png&perf=none")
            pg.wait_for_function("window.venueReady === true", timeout=60000)
            pg.evaluate("([e,f]) => window.venueSim.setMatrix(e,f)", [T_three.T.reshape(-1).tolist(), fov])
            png = pg.screenshot()
            br.close()
        out_png.write_bytes(png)
        return cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR), vw / w
    finally:
        server.terminate()
        if tmp.exists():
            tmp.unlink()


def corner_stats(a: dict, b: dict):
    """id が共通の角の差(画素)。"""
    ids = sorted(set(a) & set(b))
    if len(ids) < 6:
        return None
    d = np.array([np.linalg.norm(a[i] - b[i]) for i in ids])
    return {"n": len(ids), "median_px": round(float(np.median(d)), 2), "mean_px": round(float(d.mean()), 2), "max_px": round(float(d.max()), 2)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shoot_dir")
    ap.add_argument("--frame", type=int, required=True)
    ap.add_argument("--alignment", required=True)
    ap.add_argument("--face", default="A")
    ap.add_argument("--board", required=True)
    ap.add_argument("--media", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    shoot = S.load_shoot(a.shoot_dir)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(shoot.video))
    cap.set(cv2.CAP_PROP_POS_FRAMES, a.frame)
    ok, photo = cap.read()
    cap.release()
    if not ok:
        raise SystemExit("コマを読めない")
    h, w = photo.shape[:2]
    al = json.loads(Path(a.alignment).read_text(encoding="utf-8"))
    T_world_cam = shoot.T(a.frame)
    K4 = shoot.frames[a.frame]["K"]
    T_three = three_matrix(T_world_cam, np.array(al["T_led_from_world"]), a.face)
    sim, scale = render_sim(T_three, K4[1], w, h, Path(a.media), out / "sim_raw.png")
    board = Board.load(a.board)

    def detect(img):
        res = detect_corners(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), board, min_corners=6)
        return None if res is None else {int(i): c for c, i in zip(*res)}

    photo_small = cv2.resize(photo, (sim.shape[1], sim.shape[0]), interpolation=cv2.INTER_AREA)
    d_photo, d_sim = detect(photo_small), detect(sim)
    # 計算上の位置(撮影記録の姿勢 + 位置合わせ)を、縮小した画像の画素で
    calc = {}
    ids_all = np.arange((board.cols - 1) * (board.rows - 1))
    pts_led = board.corner_led_m(ids_all)
    T_world_from_led = np.array(al["T_world_from_led"])
    pts_world = S.apply(T_world_from_led, pts_led)
    K_small = [K4[0] * scale, K4[1] * scale, K4[2] * scale, K4[3] * scale]
    px, depth = S.project(T_world_cam, K_small, pts_world)
    for i, p, d in zip(ids_all, px, depth):
        if d > 0 and 0 <= p[0] < sim.shape[1] and 0 <= p[1] < sim.shape[0]:
            calc[int(i)] = p
    res = {"frame": a.frame, "image_size": [w, h], "compare_size": [sim.shape[1], sim.shape[0]],
           "corners_found": {"photo": None if d_photo is None else len(d_photo), "sim": None if d_sim is None else len(d_sim), "calc_in_view": len(calc)},
           "note": "画素は縮小(横 1280)した絵の値。盤が写っていなければ数字は null"}
    res["photo_vs_calc"] = corner_stats(d_photo or {}, calc)
    res["sim_vs_calc"] = corner_stats(d_sim or {}, calc)
    res["photo_vs_sim"] = corner_stats(d_photo or {}, d_sim or {})
    # 並べた絵: 左 実写、右 シミュレーター、下に 半透明の重ね(実写に、シミュレーターの明るい所の輪郭を赤で)
    edges = cv2.Canny(cv2.cvtColor(sim, cv2.COLOR_BGR2GRAY), 40, 120)
    over = photo_small.copy()
    over[edges > 0] = (0, 0, 255)
    for src, color in ((d_photo, (0, 255, 0)), (d_sim, (255, 160, 0))):
        for c in (src or {}).values():
            cv2.circle(over, tuple(int(x) for x in c), 5, color, 2)
    top = np.hstack([photo_small, sim])
    bottom = np.hstack([over, np.zeros_like(over)])
    cv2.putText(top, "real", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    cv2.putText(top, "simulator", (sim.shape[1] + 10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    imwrite(out / "side_by_side.png", np.vstack([top, bottom]))
    (out / "compare.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k != "note"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
