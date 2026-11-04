"""E0(向きのずれあり・直しなし)と E1①(テイクの頭で点の校正をやり直す)を、校正からの経過ごとに計算する(UE は使わない)。

  python place/shootlog/sim/sim_e0.py --dir <カットの撮影フォルダ> --dots <点の撮影フォルダ> [--minutes 0 1 5 10 30 60]
各経過で: 向きのずれ(sim_common.Drift。10 分まで実測、それより先は直線で伸ばした仮定)を ARKit の記録に入れ、本番の流れ(受け手 → pc_to_frames → build_track)を通し、
正解と比べる(カメラの位置・向き、足元の差の画素と cm)。結果は e0_table.json に積む。
E1①: 経過 m 分に点の校正をやり直した(そのときの ARKit のずれが入ったレイ)あと、15 秒後にテイクを撮る。校正が残差の上限(4 cm)で落ちたら、その行は「校正が通らない」。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sim_score  # noqa: E402
from sim_common import Drift  # noqa: E402


def run(cmd):
    r = subprocess.run([sys.executable, str(HERE / "sim_pipeline.py"), *cmd], capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        raise RuntimeError(r.stdout[-800:] + r.stderr[-800:])
    return r.stdout


def score(d: Path, track: str, show_start):
    cam = sim_score.score_cam(d, track)
    foot = sim_score.score_foot(d, track, show_start)
    return {"position_cm": cam["position_cm"]["median"], "position_cm_p95": cam["position_cm"]["p95"], "orientation_deg": cam["orientation_deg"]["median"],
            "orientation_deg_p95": cam["orientation_deg"]["p95"], "fov_deg": cam["fov_deg"]["median"], "foot_px_median": foot["foot_px"]["median"], "foot_px_p95": foot["foot_px"]["p95"],
            "foot_floor_cm_median": foot["foot_floor_cm"]["median"], "foot_floor_cm_p95": foot["foot_floor_cm"]["p95"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--dots", required=True, type=Path)
    ap.add_argument("--minutes", nargs="+", type=float, default=[0, 1, 5, 10, 30, 60])
    ap.add_argument("--skip-e1a", action="store_true")
    a = ap.parse_args()
    d, dots = a.dir, a.dots
    show_start = json.loads((d / "cut.json").read_text(encoding="utf-8"))["show_start"]
    drift = Drift()
    table = []
    for k, m in enumerate(a.minutes):
        row = {"minutes": m, "drift_deg": round(drift.degrees(m), 3), "measured": drift.is_measured(m)}
        tag = f"e0_m{int(m)}"
        run(["chain", "--dir", str(d), "--cal", str(dots / "rays.json"), "--minutes", str(m), "--tag", tag, "--port-offset", str(10 + k)])
        row["e0"] = score(d, f"track_{tag}.json", show_start)
        print(f"E0 {m:g} 分(ずれ {row['drift_deg']}°): 足元 {row['e0']['foot_px_median']:.1f}/{row['e0']['foot_px_p95']:.1f} px、位置 {row['e0']['position_cm']:.2f} cm、向き {row['e0']['orientation_deg']:.2f}°", flush=True)
        if not a.skip_e1a and m > 0:
            out = run(["dots", "--dir", str(dots), "--minutes", str(m), "--tag", f"r{int(m)}"])
            res = json.loads((dots / f"calib_result_r{int(m)}.json").read_text(encoding="utf-8"))
            row["e1a_calib"] = {"ok": res["ok"], "reason": res.get("reason"), "rms_cm": res.get("rms_cm"), "n_dots": res.get("n_dots"), "face_residual_cm": res.get("face_residual_cm"),
                                "centre_error_cm": res.get("centre_error_cm")}
            if res["ok"]:
                tag = f"e1a_m{int(m)}"
                run(["chain", "--dir", str(d), "--cal", str(dots / f"rays_r{int(m)}.json"), "--minutes", str(m + 0.25), "--tag", tag, "--port-offset", str(30 + k)])
                row["e1a"] = score(d, f"track_{tag}.json", show_start)
                print(f"E1① {m:g} 分: 校正やり直し 残差 {res['rms_cm']:.1f} cm → 足元 {row['e1a']['foot_px_median']:.1f}/{row['e1a']['foot_px_p95']:.1f} px", flush=True)
            else:
                print(f"E1① {m:g} 分: 校正が通らない({res['reason']})", flush=True)
        table.append(row)
        (d / "e0_table.json").write_text(json.dumps(table, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
