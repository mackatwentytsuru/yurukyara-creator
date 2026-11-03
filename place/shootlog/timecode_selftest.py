"""timecode.py・read_timecode.py の合成の確かめ。画面(5120×1440、盤+コマ番号の帯)を、1920×1080 のカメラで斜めから 30p・1/60 で撮ったことにして、
各コマで帯を読み、画面のコマ番号とカメラの時刻の一次式(rate=60、offset)を取り戻せるかを見る。ローリングシャッター(上から下まで 12 ms)・露出の間の切り替わり(混ざる)・雑音を含む。

  python place/shootlog/timecode_selftest.py
実映像の確かめではない(LED/モニターのリフレッシュ・露出・モアレは実機で)。
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import read_timecode as R  # noqa: E402
import timecode as TC  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="tcsim_"))
subprocess.run([sys.executable, str(HERE / "make_multi_pattern.py"), "--out", str(tmp), "--face", "center", "5120", "1440", "0.000234375", "160", "--tc-height", "100"], check=True, capture_output=True)
board, strips = R.load_face(tmp / "faces.json", "center")
base = cv2.imdecode(np.fromfile(str(tmp / "pattern_center.png"), np.uint8), 0)
H_face, W_face = base.shape

W, Hh = 1920, 1080
K = np.array([[1700.0, 0, 960], [0, 1700.0, 540], [0, 0, 1]])
# 画面(幅 1.2 m)を、カメラの 1.6 m 手前、少し斜め(yaw 20°)から
from scipy.spatial.transform import Rotation as Rot
pitch = 0.000234375
corners_face = np.array([[0, 0], [W_face, 0], [W_face, H_face], [0, H_face]], np.float32)
corners_m = np.stack([(corners_face[:, 0] - W_face / 2) * pitch, (corners_face[:, 1] - H_face / 2) * pitch, np.zeros(4)], axis=1)
Rw = Rot.from_euler("y", 20, degrees=True).as_matrix()
tw = np.array([0.1, 0.0, 1.6])
Pc = (Rw @ corners_m.T).T + tw
uv = (K @ Pc.T).T
uv = (uv[:, :2] / uv[:, 2:3]).astype(np.float32)
Hm = cv2.getPerspectiveTransform(corners_face, uv)

FPS_DISP, FPS_CAM = 60.0, 30.0
T0 = 0.0137            # 画面のコマ 0 が始まる時刻(カメラの時刻 0 から見て)
RS = 0.012             # 上から下まで読むのにかかる時間
EXP = 1 / 60

def disp_frame(t):
    return int(np.floor((t - T0) * FPS_DISP)) + 1000   # 1000 から始める

rng = np.random.default_rng(3)
vw = cv2.VideoWriter(str(tmp / "cam.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), 30, (W, Hh))
N = 150
truth = []
for k in range(N):
    t = 0.2 + k / FPS_CAM + (0.4 if 80 <= k else 0.0)   # 80 コマ目から 0.4 s 飛ぶ(落ちたコマの模擬)
    acc = np.zeros((H_face, W_face), np.float32)
    subs = 3
    for j in range(subs):
        te = t + (j / (subs - 1) - 0.5) * EXP        # 露出の間の 3 点
        img_top = TC.draw(base.copy(), disp_frame(te), strips[:1])
        img_both = TC.draw(img_top, disp_frame(te + RS), strips[1:])     # 下の帯は 12 ms 後のコマ
        acc += img_both
    face_img = (acc / subs).astype(np.uint8)
    cam = cv2.warpPerspective(face_img, Hm, (W, Hh), flags=cv2.INTER_AREA, borderValue=40)
    cam = cv2.GaussianBlur(cam, (0, 0), 0.8).astype(np.float32) + rng.normal(0, 3, cam.shape)
    vw.write(cv2.cvtColor(np.clip(cam, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2BGR))
    truth.append((t, disp_frame(t)))
vw.release()
(tmp / "frames.jsonl").write_text("\n".join(json.dumps({"i": k, "pts": truth[k][0]}) for k in range(N)), encoding="utf-8")
r = subprocess.run([sys.executable, str(HERE / "read_timecode.py"), "--faces", str(tmp / "faces.json"), "--face", "center", "--video", str(tmp / "cam.mp4"),
                    "--times", str(tmp / "frames.jsonl"), "--out", str(tmp / "fit.json")], capture_output=True, text=True)
print(r.stdout.strip()[-900:])
if r.returncode:
    print(r.stderr[-1500:])
    sys.exit(1)
s = json.loads((tmp / "fit.json").read_text(encoding="utf-8"))["summary"]
ok = True
def check(name, cond, text):
    global ok
    print(("合格 " if cond else "不合格 ") + name + " " + text)
    ok &= bool(cond)
check("盤から射影を求められた", s["frames_no_board"] == 0, f"盤が見つからなかったコマ {s['frames_no_board']}")
check("帯を読めたコマ", s["frames_decoded_clean"] >= N * 0.9, f"{s['frames_decoded_clean']}/{N}")
check("画面の更新の速さ", abs(s["rate_per_s"] - 60) < 0.2, f"{s['rate_per_s']:.3f} コマ/秒(正解 60)")
check("時刻の合い方(残差)", s["residual_ms"]["rms"] < 8, f"rms {s['residual_ms']['rms']:.2f} ms、最大 {s['residual_ms']['max']:.1f} ms(1 コマ=16.7 ms)")
rs = s["rolling_shutter_frames_top_to_bottom"]
check("ローリングシャッターの差", abs(rs["ms"] - 12) < 6, f"{rs['ms']:.1f} ms(正解 12 ms)")
print("全部合格" if ok else "不合格あり")
sys.exit(0 if ok else 1)
