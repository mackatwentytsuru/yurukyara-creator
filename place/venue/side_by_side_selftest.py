"""side_by_side.py の確かめ。「実写」は、LED の絵を OpenCV の射影変換で作った合成の画像(three.js を使わない)にし、
シミュレーター(three.js のページ)が同じ位置に盤の角を描くかを測る = ページの LED の形・絵の貼り方・座標の向きが、計算と合っているかの確かめ。

  python place/venue/side_by_side_selftest.py --board <board_A.json> --media <led_board_A_5680x1240.png> --out <出力フォルダ>
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "place" / "shootlog"))
import shootlib as S  # noqa: E402
from lenslib import imwrite  # noqa: E402


def look_at_led(eye, target):
    """LED の座標(x 右・y 上・z 客席)での、カメラ→LED の 4x4(カメラ: +x 右・+y 上・-z 前)。"""
    eye, target = np.array(eye, float), np.array(target, float)
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = r, u, -f, eye
    return T


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", required=True)
    ap.add_argument("--media", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    W, H = 1920, 1080
    fx = 1500.0
    K4 = [fx, fx, W / 2, H / 2]
    # LED と世界の関係(世界は y 上。LED を 20° 回して、床の下の方に置く)
    T_world_from_led = S.rigid(S.rot_y(np.radians(20)), np.array([0.7, -1.3, 0.4]))
    T_led_from_world = S.invert_rigid(T_world_from_led)
    al = {"T_world_from_led": T_world_from_led.tolist(), "T_led_from_world": T_led_from_world.tolist()}
    T_led_cam = look_at_led((2.2, 1.9, 4.2), (1.9, 2.2, 0.0))
    T_world_cam = T_world_from_led @ T_led_cam
    # 「実写」: LED の A 面(1280×1240 画素 = 5.12×4.96 m)を、カメラへ射影変換で貼る
    canvas = cv2.imdecode(np.fromfile(a.media, np.uint8), cv2.IMREAD_COLOR)
    face = canvas[:, :1280]
    corners_led = np.array([[0, 4.96, 0], [5.12, 4.96, 0], [5.12, 0, 0], [0, 0, 0]], float)
    px, depth = S.project(T_world_cam, K4, S.apply(T_world_from_led, corners_led))
    assert (depth > 0).all()
    src = np.array([[0, 0], [1280, 0], [1280, 1240], [0, 1240]], np.float32)
    Hm = cv2.getPerspectiveTransform(src, px.astype(np.float32))
    photo = cv2.warpPerspective(face, Hm, (W, H), flags=cv2.INTER_AREA)
    shoot = out / "shoot"
    shoot.mkdir(exist_ok=True)
    vw = cv2.VideoWriter(str(shoot / "video.mov"), cv2.VideoWriter_fourcc(*"mp4v"), 30, (W, H))
    vw.write(photo)
    vw.release()
    (shoot / "frames.jsonl").write_text(json.dumps({"i": 0, "t": 0.0, "pts": 0.0, "T": T_world_cam.T.reshape(-1).tolist(), "K": K4, "track": "normal", "ok": True}), encoding="utf-8")
    (shoot / "meta.json").write_text(json.dumps({"videoFile": "video.mov", "stats": {"width": W, "height": H, "frames": 1}}), encoding="utf-8")
    (out / "alignment_A.json").write_text(json.dumps(al), encoding="utf-8")
    imwrite(out / "photo.png", photo)
    r = subprocess.run([sys.executable, str(HERE / "side_by_side.py"), str(shoot), "--frame", "0", "--alignment", str(out / "alignment_A.json"),
                        "--face", "A", "--board", a.board, "--media", a.media, "--out", str(out / "cmp")], capture_output=True, text=True)
    print(r.stdout[-1500:])
    if r.returncode:
        print(r.stderr[-2000:])
        sys.exit(1)
    res = json.loads((out / "cmp" / "compare.json").read_text(encoding="utf-8"))
    ok = all(res[k] and res[k]["median_px"] < 3.0 for k in ("photo_vs_calc", "sim_vs_calc", "photo_vs_sim"))
    print("合格" if ok else "不合格(中央値 3 px 以内を期待)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
