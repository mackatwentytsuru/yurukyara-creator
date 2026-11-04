"""答え合わせ: 本番の道具が作ったカメラ(track.json)と、UE で撮った正解(truth.json)を比べる。UE なしで動く部分と、連番(絵)を使う部分がある。

  python place/shootlog/sim/sim_score.py cam  --dir <カットの撮影フォルダ> --track track_m0.json         # C: 位置・向き・画角
  python place/shootlog/sim/sim_score.py foot --dir <...> --track track_m0.json --show-start 56.0      # D の足元の差(画素と cm)。ショーの秒は cut.json から
  python place/shootlog/sim/sim_score.py iou  --dir <...> --tag m0                                      # D の輪郭の重なり(MatteChar の追跡 と 正解のカメラ)
足元の差は、舞台の同じ点(キャラの足の位置。床の高さ)を、合成のカメラと正解のカメラで写して比べる(10 m 先で 1 cm は約 1.5 px)。
cm は、合成のカメラが写した画素を、正解のカメラで床へ戻した位置の差。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sim_common import FPS, REPO, STAGE  # noqa: E402

sys.path[:0] = [str(REPO / "show" / "live"), str(REPO / "show" / "ue"), str(REPO / "show" / "composite")]
from stage_path import ar_at, on_led  # noqa: E402
from ue_axes import project_ue, rotator_axes  # noqa: E402

STAGE_Z = 90.0
SENSOR_W = 36.0


def load(d: Path, track_name):
    truth = json.loads((d / "truth.json").read_text(encoding="utf-8"))
    track = json.loads((d / track_name).read_text(encoding="utf-8"))
    n = min(len(truth["rows"]), len(track["rows"]))
    return truth["rows"][:n], track, truth


def axes_of(row):
    return rotator_axes(row["pitch"], row["yaw"], row["roll"])


def stats(v):
    v = np.asarray(v, float)
    return {"median": round(float(np.median(v)), 3), "p95": round(float(np.percentile(v, 95)), 3), "max": round(float(v.max()), 3), "n": int(len(v))}


def score_cam(d: Path, track_name):
    """C: 位置(cm)・向き(°)・横の画角(°)。"""
    truth, track, _ = load(d, track_name)
    rows = track["rows"][:len(truth)]
    pos, ang, fov = [], [], []
    for t, r in zip(truth, rows):
        pos.append(math.dist((t["x"], t["y"], t["z"]), (r["x"], r["y"], r["z"])))
        Ft, Rt, Ut = axes_of(t)
        Fr, Rr, Ur = axes_of(r)
        M = np.stack([Ft, Rt, Ut]) @ np.stack([Fr, Rr, Ur]).T
        ang.append(math.degrees(math.acos(float(np.clip((np.trace(M) - 1) / 2, -1, 1)))))
        fov.append(abs(2 * math.degrees(math.atan(SENSOR_W / 2 / r["focal"])) - 2 * math.degrees(math.atan(SENSOR_W / 2 / t["focal"]))))
    return {"position_cm": stats(pos), "orientation_deg": stats(ang), "fov_deg": stats(fov)}


def foot_points(show_start, count):
    """フレームごとの足の位置(床の高さ)。LED の中にいる間は None。"""
    out = []
    for i in range(count):
        t = show_start + i / FPS
        if on_led(STAGE, t):
            out.append(None)
        else:
            x, y, _ = ar_at(STAGE["ar_path"], t)
            out.append((x, y, STAGE_Z))
    return out


def project_row(row, point, width, offset=(0.0, 0.0)):
    fx = row["focal"] / SENSOR_W * width
    F, Rt, U = axes_of(row)
    px, depth = project_ue(np.array([point]), (row["x"], row["y"], row["z"]), F, Rt, U, fx, fx, width / 2.0 + offset[0], 540.0 + offset[1])
    return px[0], float(depth[0])


def floor_point(row, pixel, width, offset=(0.0, 0.0), z=STAGE_Z):
    """画素 → カメラ row の視線が高さ z の床に当たる位置(cm)。"""
    fx = row["focal"] / SENSOR_W * width
    F, Rt, U = axes_of(row)
    d = F + Rt * (pixel[0] - width / 2.0 - offset[0]) / fx - U * (pixel[1] - 540.0 - offset[1]) / fx
    s = (z - row["z"]) / d[2]
    return np.array([row["x"], row["y"], row["z"]]) + d * s


def score_foot(d: Path, track_name, show_start):
    truth, track, tr = load(d, track_name)
    rows = track["rows"][:len(truth)]
    width = tr["width"]
    off = tuple(track.get("principal_offset_px", [0.0, 0.0]))
    feet = foot_points(show_start, len(truth))
    px, cm = [], []
    for t, r, f in zip(truth, rows, feet):
        if f is None:
            continue
        pt, _ = project_row(t, f, width)
        pr, _ = project_row(r, f, width, off)
        px.append(float(np.linalg.norm(pt - pr)))
        # 合成が写した画素(pr)を、正解のカメラで床へ戻す
        cm.append(float(np.linalg.norm(floor_point(t, pr, width)[:2] - np.array(f[:2]))))
    if not px:
        return {"error": "舞台の上の足のコマが無い"}
    return {"foot_px": stats(px), "foot_floor_cm": stats(cm)}


def mask(path, thr=128):
    import cv2
    g = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_GRAYSCALE)
    return g > thr


def score_iou(d: Path, tag_dir="Comp_MatteChar", truth_dir="Comp_MatteChar_truth"):
    a, b = d / "frames" / tag_dir, d / "frames" / truth_dir
    ious = []
    for pa in sorted(a.glob("f.*.png")):
        pb = b / pa.name
        if not pb.exists():
            continue
        ma, mb = mask(pa), mask(pb)
        if mb.sum() < 500:
            continue
        ious.append(float((ma & mb).sum() / max((ma | mb).sum(), 1)))
    if not ious:
        return {"error": "キャラのコマが無い"}
    v = np.array(ious)
    return {"iou_median": round(float(np.median(v)), 4), "iou_min": round(float(v.min()), 4), "iou_p5": round(float(np.percentile(v, 5)), 4), "n": int(len(v))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["cam", "foot", "iou"])
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--track", default="track_m0.json")
    ap.add_argument("--show-start", type=float)
    ap.add_argument("--matte", default="Comp_MatteChar")
    a = ap.parse_args()
    if a.mode == "cam":
        r = score_cam(a.dir, a.track)
    elif a.mode == "foot":
        ss = a.show_start if a.show_start is not None else json.loads((a.dir / "cut.json").read_text(encoding="utf-8"))["show_start"]
        r = score_foot(a.dir, a.track, ss)
    else:
        r = score_iou(a.dir, a.matte)
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
