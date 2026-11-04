"""仮想 iPad の通し(UE の絵ができたあとの、メイン PC の計算だけの部分)。

  python place/shootlog/sim/sim_pipeline.py dots  --dir <点の撮影フォルダ> [--world-seed 1]
      点の映像(UE の PlateWith)→ カメラのまね → HEVC → ARKit のまね → アプリの判定の写し(real_dots_check.emulate_app)→ レイ(rays.json)→ 解く(A1 の数字、calib_result.json)
  python place/shootlog/sim/sim_pipeline.py chain --dir <カットの撮影フォルダ> --cal <点の撮影フォルダ>/rays.json [--minutes 0] [--no-drift]
      カットの PlateWith → カメラのまね → HEV1 と CAL1 を本物の受け手へ → pc_to_frames → build_track → track.json
ARKit の世界(ArkitWorld)は同じ物を、点の校正とカットで使う(同じ ARKit のセッション)。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sim_arkit  # noqa: E402
import sim_camera  # noqa: E402
import sim_send  # noqa: E402
from sim_common import REPO, Drift, stage_to_page, unflat  # noqa: E402

sys.path[:0] = [str(REPO / "place" / "shootlog"), str(REPO / "show" / "composite")]


def world_for(seed):
    return sim_arkit.ArkitWorld()  # 世界は固定(37°・平行移動)。seed は雑音の乱数だけに使う


def make_stream(d: Path, plate="Comp_PlateWith", seed=1, no_rs=False, bitrate="18M"):
    out = d / ("stream.hevc" if not no_rs else "stream_nors.hevc")
    if out.exists():
        return out
    t0 = time.time()
    n = sim_camera.run(d / "frames" / plate, d / "truth_page.json", out, seed=seed, enable_rs=not no_rs, bitrate=bitrate)
    mbps = out.stat().st_size * 8 / (n / 30) / 1e6
    print(f"カメラのまね: {n} コマ、{mbps:.1f} Mbps、{time.time() - t0:.0f} 秒", flush=True)
    return out


def ark_rows(d: Path, lens, seed, minutes=0.0, drift=None, **kw):
    tp = json.loads((d / "truth_page.json").read_text(encoding="utf-8"))
    Ts = [unflat(v) for v in tp["T"]]
    rng = np.random.default_rng(seed + 100)
    return sim_arkit.to_arkit(Ts, world_for(seed), lens, rng, minutes=minutes, drift=drift, **kw)


def cmd_dots(a):
    import dots_align
    import real_dots_check as rdc
    d = Path(a.dir)
    cut = json.loads((d / "cut.json").read_text(encoding="utf-8"))
    stream = make_stream(d, seed=a.world_seed)
    rows = ark_rows(d, cut["lens"], a.world_seed, minutes=a.minutes, drift=Drift() if a.minutes > 0 else None)
    suffix = f"_{a.tag}" if a.tag else ""
    t0 = time.time()
    rays, info = rdc.emulate_app(stream, rows, (1920, 1080), gate_as_is=False)
    print(f"アプリの判定の写し: 点 {info['dots']}/33、レイ {info['rays']}、合図 {info['syncs']}、落ちた理由 {info['rejects']}、{time.time() - t0:.0f} 秒", flush=True)
    cal = [{"dot": int(r["dot"]), "o": [float(v) for v in r["o"]], "d": [float(v) for v in r["d"]]} for r in rays]
    (d / f"rays{suffix}.json").write_text(json.dumps(cal), encoding="utf-8")
    res = dots_align.solve(sim_send.rays_to_cal(cal))
    world = world_for(a.world_seed).matrix()
    out = {"info": {k: v for k, v in info.items()}, "ok": res["ok"], "reason": res.get("reason", ""), "n_dots": res.get("n_dots"), "n_rays": res.get("n_rays"), "rms_cm": res.get("rms_cm"),
           "face_residual_cm": res.get("face_residual_cm"), "face_dots": res.get("face_dots")}
    if res["ok"]:
        Tm = np.array(res["T"]).reshape(4, 4)
        pts = np.array([x["p"] for x in dots_align.DOTS])
        mid = stage_to_page((0.0, 0.0, 330.0))
        est = lambda p: (Tm @ np.append(p, 1.0))[:3]       # noqa: E731
        tru = lambda p: (world @ np.append(p, 1.0))[:3]    # noqa: E731
        err = np.array([np.linalg.norm(est(p) - tru(p)) for p in pts]) * 100
        out["centre_error_cm"] = float(np.linalg.norm(est(mid) - tru(mid)) * 100)
        out["dots_error_cm"] = {"median": float(np.median(err)), "max": float(err.max())}
    (d / f"calib_result{suffix}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))


def a_theta(M):
    return float(np.arctan2(M[0, 2], M[0, 0]))


def cmd_chain(a):
    d = Path(a.dir)
    cut = json.loads((d / "cut.json").read_text(encoding="utf-8"))
    stream = make_stream(d, seed=a.seed)
    drift = None if a.no_drift else Drift()
    rows = ark_rows(d, cut["lens"], a.seed, minutes=a.minutes, drift=drift)
    (d / "ark_rows.json").write_text(json.dumps(rows), encoding="utf-8")
    cal = json.loads(Path(a.cal).read_text(encoding="utf-8")) if a.cal else None
    aus = sim_send.split_access_units(stream.read_bytes())
    print(f"アクセスユニット {len(aus)}、行 {len(rows)}", flush=True)
    rx = d / ("rx_" + a.tag)
    take, n = sim_send.send_take(rx, aus, rows, cal, session=world_for(a.seed).session, port=sim_send.PORT + (a.port_offset))
    shoot = d / ("shoot_" + a.tag)
    text = sim_send.run_pc_to_frames(take, shoot)
    print(text)
    import shoot_track
    track = shoot_track.build_track(shoot)
    (d / ("track_" + a.tag + ".json")).write_text(json.dumps(track), encoding="utf-8")
    print("track.json:", {k: track[k] for k in ("residuals", "principal_offset_px", "tracking_gaps_sec")}, "コマ", len(track["rows"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("dots")
    p.add_argument("--dir", required=True)
    p.add_argument("--world-seed", type=int, default=1)
    p.add_argument("--minutes", type=float, default=0.0, help="ARKit の向きのずれが入った状態(校正のやり直しの試し)。0 でずれなし")
    p.add_argument("--tag", default="")
    p = sub.add_parser("chain")
    p.add_argument("--dir", required=True)
    p.add_argument("--cal")
    p.add_argument("--minutes", type=float, default=0.0)
    p.add_argument("--no-drift", action="store_true")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--tag", default="m0")
    p.add_argument("--port-offset", type=int, default=0)
    a = ap.parse_args()
    {"dots": cmd_dots, "chain": cmd_chain}[a.mode](a)


if __name__ == "__main__":
    main()
