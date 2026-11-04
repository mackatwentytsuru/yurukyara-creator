"""E1②(頭と終わりの 2 回の校正からずれを直線で補間して引く)を測る。UE は使わない。sim_e0.py で作った shoot_e0_m<t>(ずれ入りのテイク)と rays_r<E>(終わりの校正)を使う。

  python place/shootlog/sim/sim_e1.py --dir <カット> --dots <点の撮影フォルダ> --pairs 5:1 5:2 5:3 10:1 10:2 10:3 10:5
    各 "終わりの校正の分:テイクの分"。頭の校正は rays.json(0 分)。校正の映像の長さ(中央の時刻)は 0.3 分と仮定して頭・終わりの時刻に足す。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path[:0] = [str(HERE.parent), str(HERE.parents[2] / "show" / "composite")]
import drift_interp  # noqa: E402
import sim_score  # noqa: E402
from sim_e0 import score  # noqa: E402

DOTS_SEC = 36.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--dots", required=True, type=Path)
    ap.add_argument("--pairs", nargs="+", required=True)
    a = ap.parse_args()
    d, dots = a.dir, a.dots
    show_start = json.loads((d / "cut.json").read_text(encoding="utf-8"))["show_start"]
    import shoot_track
    mid = DOTS_SEC / 120.0
    head = json.loads((dots / "rays.json").read_text(encoding="utf-8"))
    table = []
    for p in a.pairs:
        e, t = (float(v) for v in p.split(":"))
        src = d / f"shoot_e0_m{int(t)}"
        dst = d / f"shoot_e1c_E{int(e)}_t{int(t)}"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        end = json.loads((dots / f"rays_r{int(e)}.json").read_text(encoding="utf-8"))
        Rw, info = drift_interp.estimate_rotation(head, end)
        first, last = drift_interp.apply(dst, Rw, head_min=mid, end_min=e + mid, take_min=t)
        track = shoot_track.build_track(dst)
        tn = f"track_e1c_E{int(e)}_t{int(t)}.json"
        (d / tn).write_text(json.dumps(track), encoding="utf-8")
        s = score(d, tn, show_start)
        row = {"end_min": e, "take_min": t, "estimated_deg": info["rotation_deg"], "subtracted_deg": [first, last], "n_used": info["n_used"], "residual_deg": info["residual_deg_median"], "score": s}
        table.append(row)
        print(f"E1② 終わり {e:g} 分・テイク {t:g} 分: 推定 {info['rotation_deg']:.2f}° 引いた {first:.2f}→{last:.2f}° → 足元 {s['foot_px_median']:.1f}/{s['foot_px_p95']:.1f} px、向き {s['orientation_deg']:.2f}°", flush=True)
    (d / "e1c_table.json").write_text(json.dumps(table, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
