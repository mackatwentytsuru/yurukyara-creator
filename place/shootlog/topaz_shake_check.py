"""手持ちの実写を Topaz に通しても、絵の位置がずれないかを確かめる(合成の順番を決めるため)。受け手の記録の短い区間を使う。

  python place/shootlog/topaz_shake_check.py --rx <受け手の記録> --out <出力フォルダ> [--start 400] [--frames 240] [--model prob-4] [--scale 2]
やること: 実写(フル HD)→ Topaz で拡大 → 緑の点の重心を、元のコマと拡大後のコマで比べる(拡大後を倍率で割った位置の差、画素)。あわせて、同じ所の切り出しの比べ絵を作る。
差が 1 画素未満なら「Topaz のあとに重ねる」順番で位置は変わらない。大きければ「重ねてから Topaz」を考える。
札(GPU)を取ってから流す。Topaz の ffmpeg はフルパスで呼ぶ(PATH の ffmpeg には tvai_up が無い)。Topaz の ffmpeg には libx264 が無いので、ProRes で書き出す。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np

TVAI = r"C:\Program Files\Topaz Labs LLC\Topaz Video AI\ffmpeg.exe"
MODELS = r"C:\ProgramData\Topaz Labs LLC\Topaz Video AI\models"


def green_centroid(bgr):
    b, g, r = [c.astype(np.float32) for c in cv2.split(bgr)]
    m = ((g - np.maximum(b, r)) > 60).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m, connectivity=8)
    best = None
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if area < 30 * (bgr.shape[1] / 1920) ** 2 or not 0.5 < w / h < 2:
            continue
        if best is None or area > best[0]:
            best = (area, cen[i])
    return None if best is None else best[1]


def frames_of(path):
    cap = cv2.VideoCapture(str(path))
    while True:
        ok, f = cap.read()
        if not ok:
            break
        yield f
    cap.release()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rx", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--start", type=int, default=400)
    ap.add_argument("--frames", type=int, default=240)
    ap.add_argument("--model", default="prob-4")
    ap.add_argument("--scale", type=int, default=2)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    raw = out / "raw.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "hevc", "-r", "30", "-i", str(Path(a.rx) / "stream.hevc"), "-vf", f"select='between(n\\,{a.start}\\,{a.start + a.frames - 1})',setpts=N/30/TB",
                    "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", "30", "-map_metadata", "-1", str(raw)], check=True)
    env = dict(os.environ, TVAI_MODEL_DIR=MODELS, TVAI_MODEL_DATA_DIR=MODELS)
    up = out / f"topaz_{a.model}_x{a.scale}.mov"
    subprocess.run([TVAI, "-v", "error", "-y", "-i", str(raw), "-vf", f"tvai_up=model={a.model}:scale={a.scale}:device=0:vram=1:instances=1,format=yuv422p10le", "-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-threads", "2", "-map_metadata", "-1", str(up)], check=True, env=env)
    rows = []
    sheet_pairs = []
    for i, (f0, f1) in enumerate(zip(frames_of(raw), frames_of(up))):
        c0, c1 = green_centroid(f0), green_centroid(f1)
        if c0 is None or c1 is None:
            continue
        s = f1.shape[1] / f0.shape[1]
        rows.append({"i": i, "dx": float(c1[0] / s - c0[0]), "dy": float(c1[1] / s - c0[1])})
        if len(sheet_pairs) < 3 and i % 40 == 7:
            cx, cy = int(c0[0]), int(c0[1])
            x0, y0 = max(0, cx - 160), max(0, cy - 90)
            crop0 = cv2.resize(f0[y0:y0 + 180, x0:x0 + 320], (640, 360), interpolation=cv2.INTER_CUBIC)
            crop1 = cv2.resize(f1[int(y0 * s):int((y0 + 180) * s), int(x0 * s):int((x0 + 320) * s)], (640, 360), interpolation=cv2.INTER_AREA)
            sheet_pairs.append(np.hstack([crop0, crop1]))
    d = np.array([[r["dx"], r["dy"]] for r in rows]) if rows else np.zeros((0, 2))
    res = {"model": a.model, "scale": a.scale, "dot_frames": len(rows)}
    if len(d):
        res.update({"mean_dx": float(d[:, 0].mean()), "mean_dy": float(d[:, 1].mean()), "p95_abs": float(np.percentile(np.abs(d), 95)), "max_abs": float(np.abs(d).max())})
    (out / "topaz_check.json").write_text(json.dumps({"summary": res, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    if sheet_pairs:
        ok, buf = cv2.imencode(".jpg", np.vstack(sheet_pairs))
        (out / "topaz_compare.jpg").write_bytes(buf.tobytes())
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
