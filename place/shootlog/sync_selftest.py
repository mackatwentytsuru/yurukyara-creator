"""合成の 2 本の映像(a7: 29.97fps、iPhone: 不ぞろいなコマ間隔)で、sync_flash が 1 コマ以内で合わせられるか確かめる。

  python place/shootlog/sync_selftest.py [--out <作業フォルダ>]
a の時計 = 1.0001 * b の時計 + 1.237 秒(開始のずれと、進みの差)。LED のフラッシュは 6 回。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

STARTS = [1.0, 2.5, 3.2, 5.5, 6.0, 8.5]   # フラッシュの開始(a の時計)
FLASH = 0.2


def brightness(t_a: float, exposure: float) -> float:
    """時刻 t_a(a の時計)で、露出時間 exposure のカメラが見る LED の明るさ(0〜255)。"""
    n = 20
    ts = t_a + (np.arange(n) / (n - 1) - 0.5) * exposure
    on = np.zeros_like(ts)
    for s in STARTS:
        on += ((ts >= s) & (ts < s + FLASH)).astype(float)
    return 25 + 200 * float(on.mean())


def write_video(path, times_a, noise, rng, fps_out=30):
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps_out, (160, 90))
    for t in times_a:
        v = np.clip(brightness(t, 1 / 100) + rng.normal(0, noise), 0, 255)
        vw.write(np.full((90, 160, 3), v, np.uint8))
    vw.release()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path.home() / "AppData/Local/Temp/sync_selftest"))
    ap.add_argument("--fps", type=float, default=29.97)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(5)
    here = Path(__file__).resolve().parent

    # a7: 一定の 29.97fps。時計は a の時計そのもの
    fps_a = a.fps
    ta = np.arange(0, 11, 1 / fps_a)
    write_video(out / "a.avi", ta, 3.0, rng, fps_a)
    # iPhone: b の時計(0 から。コマ間隔は 1/30 ± 4 ms の揺れ)。a の時計では 1.0001 * t_b + 1.237 秒
    tb_clock = np.cumsum(np.concatenate([[0.0], 1 / 30 + rng.normal(0, 0.004, 320)]))
    t_a_of_b = 1.0001 * tb_clock + 1.237
    keep = t_a_of_b < 11
    tb_clock, t_a_of_b = tb_clock[keep], t_a_of_b[keep]
    write_video(out / "b.avi", t_a_of_b, 3.0, rng)
    (out / "shoot").mkdir(exist_ok=True)
    (out / "shoot" / "frames.jsonl").write_text("\n".join(json.dumps({"i": i, "pts": float(t)}) for i, t in enumerate(tb_clock)) + "\n", encoding="utf-8")

    subprocess.run([sys.executable, str(here / "sync_flash.py"), "--a", str(out / "a.avi"), "--b", str(out / "b.avi"),
                    "--b-shoot", str(out / "shoot"), "--out", str(out / "sync.json")], check=True)
    s = json.loads((out / "sync.json").read_text(encoding="utf-8"))
    # 検証: b の各コマの時刻を a の時計に直した値と、真の値の差
    est = s["alpha"] * tb_clock + s["beta"]
    err = np.abs(est - t_a_of_b)
    print(f"b のコマを a の時計に直したときの誤差: 平均 {err.mean() * 1000:.1f} ms、最大 {err.max() * 1000:.1f} ms(a の 1 コマ = {1000 / fps_a:.1f} ms)")
    ok = err.max() < 1 / fps_a
    print("合格" if ok else "不合格")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
