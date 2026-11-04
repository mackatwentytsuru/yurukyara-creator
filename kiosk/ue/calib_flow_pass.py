"""校正の通し(提出で使える形): 会話側のサーバーの視線の受け口(/api/gaze/aim・mark・points)と、校正の画面と同じ API で、
床の 6 点に仮想の客を立たせて点を記録 → gaze_calib.py → 校正に使わない 25 点で前後の誤差。
人が「自分を見ている」と感じる向き = 本当の向き + 人のばらつき(正規分布 1.5 度)で代用する(実際の人ではない)。
カメラの絵 = 同じ幾何で CG の顔を貼った合成の絵(UE の SceneCapture ではない)。
python -I -X utf8 calib_flow.py --server http://127.0.0.1:8821 --udp 5331 --out calib_web
"""
import argparse
import json
import random
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(r"repo")
VG = REPO / "kiosk" / "tools" / "ue_link" / "video_gaze.py"
CALIB = REPO / "kiosk" / "tools" / "eye_camera" / "gaze_calib.py"
FACE = Path(r"work_1105\guest_face.png")
SPOTS = [(0.0, 2.0), (-0.7, 1.6), (0.7, 1.6), (-0.8, 3.0), (0.8, 3.0), (0.0, 2.7)]
NOMINAL = {"width": 1920, "height": 1080, "cam_pos": [0.0, 0.05, 0.12], "cam_pitch_deg": 40.0, "eye_pos": [0.0, 1.2, 0.0], "ipd_m": 0.0621}


def call(server, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(server + path, data=data, method="GET" if body is None else "POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def py(*args):
    return subprocess.run([sys.executable, "-X", "utf8", *map(str, args)], capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://127.0.0.1:8821")
    ap.add_argument("--udp", type=int, default=5331)
    ap.add_argument("--out", default="calib_web")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--hold", type=float, default=8.0, help="1 点に立つ秒")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(exist_ok=True)
    rng = random.Random(a.seed)
    nominal = out / "nominal.json"
    nominal.write_text(json.dumps(NOMINAL), encoding="utf-8")
    call(a.server, "/api/gaze/unmark", {"all": True})
    log = []
    prev_seq_end = None
    t0 = time.time()
    for i, (x, z) in enumerate(SPOTS, 1):
        stand = subprocess.Popen([sys.executable, "-X", "utf8", str(VG), "stand", "--face", str(FACE), "--x", str(x), "--z", str(z),
                                  "--seconds", str(a.hold), "--port", str(a.udp), "--geometry", str(nominal)],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
        # カメラの値が届くまで(道具の起動に 2 秒ほど)。このときキャラはカメラの仮の向きを見ている
        t_wait = time.time()
        cam = None
        while time.time() - t_wait < 6:
            time.sleep(0.2)
            c = call(a.server, "/api/gaze/now")
            if c and c.get("present") and c.get("ageMs", 9999) < 300 and c.get("seq") != prev_seq_end:
                cam = c
                break
        time.sleep(1.0)
        cam = call(a.server, "/api/gaze/now") if cam else cam
        truth = json.loads(py(VG, "truth", "--x", x, "--z", z).stdout)
        # 人が合わせる: 仮の向きから、本当の向き + ばらつきへ、数歩で動かす(画面の矢印を押す代わり)
        felt = {"az": truth["az"] + rng.gauss(0, 1.5), "el": truth["el"] + rng.gauss(0, 1.5)}
        start = {"az": cam.get("az", 0.0) if cam and cam.get("present") else 0.0, "el": cam.get("el", 0.0) if cam and cam.get("present") else 0.0}
        for k in range(1, 6):
            f = k / 5
            call(a.server, "/api/gaze/aim", {"az": start["az"] + (felt["az"] - start["az"]) * f, "el": start["el"] + (felt["el"] - start["el"]) * f})
            time.sleep(0.35)
        time.sleep(0.6)
        m = call(a.server, "/api/gaze/mark", {})
        call(a.server, "/api/gaze/aim", {"off": True})
        st = json.loads(stand.communicate()[0] or "{}")
        prev_seq_end = (call(a.server, "/api/gaze/now") or {}).get("seq")
        row = {"spot": i, "x": x, "z": z, "t": round(time.time() - t0, 2), "camera_before": start, "felt": {k: round(v, 2) for k, v in felt.items()},
               "truth": truth, "mark": m, "found_rate": st.get("found_rate")}
        log.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    pts = call(a.server, "/api/gaze/points")
    (out / "points.json").write_text(json.dumps(pts, indent=1), encoding="utf-8")
    fitted = out / "fitted.json"
    r = py(CALIB, "--points", out / "points.json", "--geometry", nominal, "--out", fitted)
    (out / "fit.txt").write_text(r.stdout + r.stderr, encoding="utf-8")
    ev = py(VG, "evaluate", "--face", FACE, "--geometry", fitted, "--out", out / "eval.json")
    (out / "steps.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    print(ev.stdout or ev.stderr)


if __name__ == "__main__":
    main()
