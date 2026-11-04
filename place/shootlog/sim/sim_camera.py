"""カメラのまね: UE で撮った正解の絵(Comp_PlateWith の連番)に、iPad のカメラが足す物を後からかけて、HEVC の列(Annex B)にする。

  python place/shootlog/sim/sim_camera.py --frames <PlateWith の連番フォルダ> --truth-page <truth_page.json> --out <stream.hevc> [--seed 1]
かける物(全部ここに書く。実測でない物は「仮定」):
  ① ローリングシャッター … 行ごとに撮る時刻がずれる(読み出し 11 ms、仮定。timecode_selftest の値)。コマの前後の姿勢から角速度を出し、行ごとに
      「回転だけ」の小さな画像のずれを与える(平行移動の分は無視。10 m 先の LED では回転が支配的)。
  ② 露出 … 全体に 0.94 倍(UE の絵のほうが少し明るいとみなす)+ ±3% のゆっくりした揺れ(仮定)。
  ③ 絵の雑音 … 平均 0 のガウス、σ = 1.5 + 1.2·√(明るさ) / 255(仮定。iPad の ISO 50〜100 のあたり)。
  ④ HEVC 18 Mbps … libx265、30 fps、B フレームなし、AUD 付き、キーフレーム 30 コマごと(実機の送りの形)。
入れていない物: モアレ(LED の画素の格子とカメラの画素の干渉)。UE の LED の面は 1 枚の絵(テクスチャ)で、LED の画素の格子を持たないので入れられない(sim_moire_check.py で確かめる)。
         レンズの歪み・ボケ・手ぶれ補正・オートフォーカスの呼吸も入れていない。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation as R

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sim_common import FPS, H, READOUT_MS, W, unflat  # noqa: E402

EXPOSURE_GAIN = 0.94
EXPOSURE_WOBBLE = 0.03
NOISE_BASE, NOISE_SHOT = 1.5, 1.2
BITRATE = "18M"


def angular_velocity_cv(Ts, i):
    """i コマ目の角速度(OpenCV のカメラの座標、ラジアン/秒)。前後のコマの差から。"""
    a, b = max(i - 1, 0), min(i + 1, len(Ts) - 1)
    if a == b:
        return np.zeros(3)
    dt = (b - a) / FPS
    rel = R.from_matrix(Ts[a][:3, :3]).inv() * R.from_matrix(Ts[b][:3, :3])      # ARKit のカメラの座標での回転
    w_ark = rel.as_rotvec() / dt
    return np.array([w_ark[0], -w_ark[1], -w_ark[2]])                            # ARKit(y 上・z 後ろ)→ OpenCV(y 下・z 前)


def rolling_shutter_map(omega_cv, K, readout_s=READOUT_MS / 1000.0):
    """出力の画素 (u, v) が、コマの基準の姿勢の絵のどこを写すか(行 v は基準から (v/H − 0.5)·readout 秒ずれて撮る)。"""
    fx, fy, cx, cy = K
    v, u = np.mgrid[0:H, 0:W].astype(np.float32)
    dirs = np.stack([(u - cx) / fx, (v - cy) / fy, np.ones_like(u)], -1)             # 行の時刻の姿勢のカメラの座標
    tau = ((np.arange(H, dtype=np.float32) / H) - 0.5) * readout_s
    theta = tau[:, None, None] * omega_cv[None, None, :].astype(np.float32)          # 小さい回転の rotvec(行ごと)
    moved = dirs + np.cross(theta, dirs)                                              # Exp(θ)·d ≈ d + θ×d(0.1° 以下なので十分)
    mx = fx * moved[..., 0] / moved[..., 2] + cx
    my = fy * moved[..., 1] / moved[..., 2] + cy
    return mx, my


_BANK = {}


def noise_frame(rng, shape):
    """ガウス雑音(標準偏差 1)。毎コマ作ると遅いので、4 枚を作って、コマごとにずらして使う(ずらすので同じ模様は続かない)。"""
    if "bank" not in _BANK:
        _BANK["bank"] = [rng.standard_normal(shape).astype(np.float32) for _ in range(4)]
    bank = _BANK["bank"]
    k = int(rng.integers(0, 4))
    dy, dx = int(rng.integers(0, shape[0])), int(rng.integers(0, shape[1]))
    return np.roll(bank[k], (dy, dx), axis=(0, 1))


def apply_camera(img_bgr, i, Ts, K, rng, enable_rs=True):
    """1 コマ → カメラのまねをした 1 コマ(uint8 BGR)。"""
    out = img_bgr
    if enable_rs:
        omega = angular_velocity_cv(Ts, i)
        if np.linalg.norm(omega) > 1e-9:
            mx, my = rolling_shutter_map(omega, K)
            out = cv2.remap(out, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    f = out.astype(np.float32)
    gain = EXPOSURE_GAIN * (1.0 + EXPOSURE_WOBBLE * np.sin(2 * np.pi * i / 47.0))
    f *= gain
    sigma = (NOISE_BASE + NOISE_SHOT * np.sqrt(np.clip(f, 0, 255))) / 1.0
    f += noise_frame(rng, f.shape) * sigma
    return np.clip(f, 0, 255).astype(np.uint8)


def encoder(out_path: Path, bitrate=BITRATE):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx265", "-preset", "veryfast", "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bitrate, "-pix_fmt", "yuv420p", "-threads", "6",
           "-x265-params", f"aud=1:bframes=0:repeat-headers=1:keyint=30:min-keyint=30:scenecut=0:log-level=error:pools=6", "-f", "hevc", str(out_path)]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def run(frames_dir: Path, truth_page: Path, out: Path, seed=1, enable_rs=True, bitrate=BITRATE, first=0, count=None):
    tp = json.loads(Path(truth_page).read_text(encoding="utf-8"))
    Ts = [unflat(v) for v in tp["T"]]
    K = tp["K"]
    files = sorted(Path(frames_dir).glob("f.*.png")) or sorted(Path(frames_dir).glob("f.*.jp*g"))
    n = min(len(files), len(Ts)) if count is None else count
    rng = np.random.default_rng(seed)
    out.parent.mkdir(parents=True, exist_ok=True)
    proc = encoder(out, bitrate)
    for i in range(first, first + n):
        img = cv2.imdecode(np.fromfile(str(files[i]), np.uint8), cv2.IMREAD_COLOR)
        if img.shape[:2] != (H, W):
            img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
        proc.stdin.write(apply_camera(img, i, Ts, K, rng, enable_rs).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("HEVC の符号化に失敗")
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", required=True, type=Path)
    ap.add_argument("--truth-page", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--no-rs", action="store_true")
    ap.add_argument("--bitrate", default=BITRATE)
    a = ap.parse_args()
    n = run(a.frames, a.truth_page, a.out, a.seed, not a.no_rs, a.bitrate)
    mbps = a.out.stat().st_size * 8 / (n / FPS) / 1e6
    print(f"書いた: {a.out}  {n} コマ  実際の転送量 {mbps:.1f} Mbps")


if __name__ == "__main__":
    main()
