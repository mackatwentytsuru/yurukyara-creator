"""UE なしで動く試験: ARKit のまねと採点の計算。正解をそのまま入れると誤差が 0 になることを確かめる。

  python place/shootlog/sim/sim_selftest.py
①ページ ↔ UE の変換の往復 ②正解の T(ページ)→ ARKit のまね(雑音・ずれなし)→ 世界の逆変換 → 元と同じ ③向きのずれ(Drift)が 0 分で 0、測定の範囲で単調に増える・
実測の値(0.5 分 0.29°、10 分 4.28°)と合う ④採点: 正解のカメラ列をそのまま track にすると、位置・向き・画角・足元の差が 0 ⑤わざと 0.5° 回した track は 0.5° と出る
⑥ローリングシャッターの写像が、動かないカメラで恒等 ⑦HEVC の AUD 切りが、ffmpeg で作った列の枚数と合う。
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sim_arkit  # noqa: E402
import sim_camera  # noqa: E402
import sim_score  # noqa: E402
import sim_send  # noqa: E402
from sim_common import Drift, Shake, page_pose_to_ue_row, stage_to_page, ue_row_to_page_pose, look_at_page  # noqa: E402

ok_all = True


def check(name, cond, detail=""):
    global ok_all
    ok_all = ok_all and bool(cond)
    print(("  合格 " if cond else "  不合格 ") + name + (f"  {detail}" if detail else ""))


def truth_rows(n=60):
    rows, Ts = [], []
    for i in range(n):
        pos = (-200 + 10 * i, 1300 - 3 * i, 170 + np.sin(i / 7.0))
        T = look_at_page(stage_to_page(pos), stage_to_page((0, 0, 330)))
        r = page_pose_to_ue_row(T, i)
        r["focal"] = 28.734375
        rows.append(r)
        Ts.append(T)
    return rows, Ts


def main():
    rows, Ts = truth_rows()
    print("① ページ ↔ UE の往復")
    worst = max(np.abs(ue_row_to_page_pose(r) - T).max() for r, T in zip(rows, Ts))
    check("T → UE の行 → T が元と同じ", worst < 1e-9, f"最大のずれ {worst:.2e}")

    print("② ARKit のまね(雑音なし・ずれなし)")
    world = sim_arkit.ArkitWorld()
    ark = sim_arkit.to_arkit(Ts, world, "wide", np.random.default_rng(1), pos_cm=0.0, rot_deg=0.0)
    back = max(np.abs(np.linalg.inv(world.matrix()) @ np.array(a["T"]).reshape(4, 4).T - T).max() for a, T in zip(ark, Ts))
    check("世界の逆変換で元の T に戻る", back < 1e-6, f"最大 {back:.2e}")
    check("K は 4K の画素(fx 3065、主点 1920×1080)", np.allclose(ark[0]["K"], [3065, 3065, 1920, 1080]), str(ark[0]["K"]))
    zoom = sim_arkit.k_sent("zoom")
    check("寄り 2 倍の K は fx 6130", abs(zoom[0] - 6130) < 1e-6, str(zoom))

    print("③ 向きのずれ(実測の形)")
    d = Drift()
    check("0 分で 0°", d.degrees(0.0) == 0.0)
    pts = [d.degrees(m) for m in (0.5, 1, 2, 5, 10)]
    check("測定の範囲(0〜10 分)で、1 分ごとに増える", all(b > a for a, b in zip(pts, pts[1:])), str([round(v, 2) for v in pts]))
    check("0.5 分 0.29°・10 分 4.28° に合う(実測)", abs(pts[0] - 0.29) < 0.1 and abs(pts[-1] - 4.28) < 0.3)
    ark2 = sim_arkit.to_arkit(Ts, world, "wide", np.random.default_rng(1), minutes=5.0, drift=d, pos_cm=0.0, rot_deg=0.0)
    ang = [sim_score_angle(np.linalg.inv(world.matrix()) @ np.array(a["T"]).reshape(4, 4).T, T) for a, T in zip(ark2, Ts)]
    check("5 分のずれを入れると、向きの差が約 1.9°、位置の差は 0", abs(np.median(ang) - d.degrees(5.0)) < 0.05, f"{np.median(ang):.2f}° (想定 {d.degrees(5.0):.2f}°)")
    pos_diff = max(np.linalg.norm((np.linalg.inv(world.matrix()) @ np.array(a["T"]).reshape(4, 4).T)[:3, 3] - T[:3, 3]) for a, T in zip(ark2, Ts))
    check("位置は動かさない", pos_diff < 1e-9)
    sh = Shake()
    check("手持ちの揺れは実記録から(位置 約 0.2 cm・向き 約 0.3°)", 0.05 < sh.stats()["pos_cm_std"][0] < 1.0 and 0.1 < sh.stats()["rot_deg_std"][0] < 1.0, str(sh.stats()))

    print("④⑤ 採点")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "truth.json").write_text(json.dumps({"rows": rows, "fx": 1532.5, "width": 1920, "height": 1080}), encoding="utf-8")
        (tmp / "track_same.json").write_text(json.dumps({"rows": rows, "principal_offset_px": [0, 0]}), encoding="utf-8")
        tilted = [dict(r, pitch=r["pitch"] + 0.5) for r in rows]
        (tmp / "track_tilt.json").write_text(json.dumps({"rows": tilted, "principal_offset_px": [0, 0]}), encoding="utf-8")
        same = sim_score.score_cam(tmp, "track_same.json")
        check("正解をそのまま入れると位置・向き・画角が 0", same["position_cm"]["max"] < 1e-9 and same["orientation_deg"]["max"] < 1e-4 and same["fov_deg"]["max"] < 1e-9, json.dumps(same["orientation_deg"]))
        foot = sim_score.score_foot(tmp, "track_same.json", 60.0)
        check("足元の差も 0 px", foot.get("foot_px", {}).get("max", 1) < 1e-6, json.dumps(foot))
        tilt = sim_score.score_cam(tmp, "track_tilt.json")
        check("0.5° 傾けると向きの差が 0.5°", abs(tilt["orientation_deg"]["median"] - 0.5) < 0.01, json.dumps(tilt["orientation_deg"]))
        foot2 = sim_score.score_foot(tmp, "track_tilt.json", 60.0)
        check("0.5° 傾けると足元は約 13 px(0.5° × fx 1532)", 10 < foot2["foot_px"]["median"] < 16, json.dumps(foot2["foot_px"]))

    print("⑥ ローリングシャッター")
    still = np.zeros(3)
    mx, my = sim_camera.rolling_shutter_map(still, [1532.5, 1532.5, 960, 540])
    check("動かないカメラでは写像が恒等", np.abs(mx - np.arange(1920)[None, :]).max() < 1e-3 and np.abs(my - np.arange(1080)[:, None]).max() < 1e-3)
    mx, my = sim_camera.rolling_shutter_map(np.array([0.0, np.radians(30), 0.0]), [1532.5, 1532.5, 960, 540])
    shift = float(mx[-1, 960] - mx[0, 960])
    expect = 1532.5 * np.radians(30) * 0.011
    check("30°/秒のパンで、最上段と最下段の差は fx·ω·11 ms", abs(abs(shift) - expect) < 0.3, f"{shift:.2f} px(想定 {expect:.2f})")

    print("⑦ HEVC を 1 コマずつに切る")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "s.hevc"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-t", "2", "-c:v", "libx265", "-x265-params", "aud=1:bframes=0:repeat-headers=1:keyint=30:log-level=error", "-f", "hevc", str(out)], check=True)
        aus = sim_send.split_access_units(out.read_bytes())
        check("60 コマが 60 個に切れる", len(aus) == 60, f"{len(aus)} 個")

    print("全部合格" if ok_all else "不合格あり")
    sys.exit(0 if ok_all else 1)


def sim_score_angle(Ra, Rb):
    from sim_common import angle_between
    return angle_between(Ra[:3, :3], Rb[:3, :3])


if __name__ == "__main__":
    main()
