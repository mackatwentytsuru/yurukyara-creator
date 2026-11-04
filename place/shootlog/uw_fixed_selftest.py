"""固定カットの解き方の合成の試験: 会場の寸法で、超広角のカメラ(13 m)から 33 点を写し、雑音を足して解く。舞台の中央の床の位置の誤差を見る。

  python place/shootlog/uw_fixed_selftest.py
K が iOS の値から少しずれている場合と、焦点距離も解く場合を比べる。
最後に、解いた結果を撮影記録の形(frames.jsonl・meta.json・alignment_A/B/C.json)にして shoot_track.build_track() に渡し、UE の位置・向き・焦点距離が
camera.json(と正解)に合うことを見る(alignment が無いと build_track が止まることも)。K は 4K の画素、映像も 3840 幅。
"""
import json
import math
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from make_led_dots_video import dots  # noqa: E402
from uw_fixed_camera import camera_result, solve_pose, stage_points, write_shoot, write_stage_alignments  # noqa: E402

sys.path.insert(0, str(HERE.parents[1] / "show" / "composite"))
import shoot_track  # noqa: E402
from ue_axes import focal_from_fx  # noqa: E402

FX, W, H = 1478.0, 3840, 2160
CENTRE = np.array([0.0, 0.0, 1.8])      # 舞台の中央、床、客席へ 1.8 m(m。x 右、y 上、z 客席)


def look_at(cam, target):
    f = np.asarray(target, float) - cam
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)
    R = np.stack([r, d, f])             # 世界 → OpenCV のカメラ
    return R, -R @ cam


def trial(rng, keys, table, cam, f_err, px_sigma, solve_focal):
    P3 = stage_points(table, keys)
    R, t = look_at(np.asarray(cam, float), [0, 2.3, 0])
    K_true = np.array([[FX, 0, W / 2], [0, FX, H / 2], [0, 0, 1.0]])
    pr, _ = cv2.projectPoints(P3, cv2.Rodrigues(R)[0], t, K_true, np.zeros(5))
    P2 = pr.reshape(-1, 2) + rng.normal(0, px_sigma, (len(P3), 2))
    K0 = K_true.copy()
    K0[0, 0] *= 1 + f_err
    K0[1, 1] *= 1 + f_err
    rv, tv, fx, k1, e, use = solve_pose(P3, P2, K0, solve_focal=solve_focal)
    Rs = cv2.Rodrigues(np.asarray(rv))[0]
    K = np.array([[fx, 0, W / 2], [0, fx, H / 2], [0, 0, 1.0]])
    # 舞台の中央が画面のどこに写るかの差(合成で見えるずれ)と、カメラの位置の差
    p_true = K_true @ (R @ CENTRE + t)
    p_true = p_true[:2] / p_true[2]
    p_est = K @ (Rs @ CENTRE + np.asarray(tv).ravel())
    p_est = p_est[:2] / p_est[2]
    cam_est = -Rs.T @ np.asarray(tv).ravel()
    return np.linalg.norm(p_est - p_true), np.linalg.norm(cam_est - np.asarray(cam)) * 100, fx


def handoff(table):
    """解いた固定カメラ → 撮影記録の形 → build_track。camera.json の値(と正解)と比べる。"""
    rng = np.random.default_rng(7)
    keys = list(range(len(table)))
    cam = np.array([0.0, 1.7, 13.0])
    R, t = look_at(cam, [0, 2.3, 0])
    P3 = stage_points(table, keys)
    K_true = np.array([[FX, 0, W / 2 + 6.0], [0, FX, H / 2 - 4.0], [0, 0, 1.0]])      # 主点も少しずらす
    pr, _ = cv2.projectPoints(P3, cv2.Rodrigues(R)[0], t, K_true, np.zeros(5))
    P2 = pr.reshape(-1, 2) + rng.normal(0, 1.5, (len(P3), 2))
    K_ios = [FX, FX, W / 2 + 6.0, H / 2 - 4.0]
    K0 = np.array([[K_ios[0], 0, K_ios[2]], [0, K_ios[1], K_ios[3]], [0, 0, 1.0]])
    rv, tv, fx, k1, e, use = solve_pose(P3, P2, K0)
    result = {"points": len(keys), "syncs": 1, **camera_result(rv, tv, fx, k1, e, use, [table[k]["face"] for k in keys], K_ios)}
    out = Path(tempfile.mkdtemp(prefix="uw_fixed_"))
    (out / "camera.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    write_shoot(out, result, 60, "shot.mov")
    ok = True
    try:
        shoot_track.build_track(out)
        stopped = False
    except RuntimeError as err:
        stopped = "alignment" in str(err)
    print(("合格" if stopped else "不合格"), "alignment が無いと build_track が止まる(これまでの形)")
    ok = ok and stopped
    write_stage_alignments(out, result)
    track = shoot_track.build_track(out)
    row = track["rows"][0]
    got = np.array([row["x"], row["y"], row["z"]])
    cam_json = np.array(result["camera_stage_cm"])
    true_ue = np.array([cam[0] * 100, cam[2] * 100, cam[1] * 100])
    # 向き: 正解は (舞台の中央の上 0.6 m を向く)。UE の前の単位ベクトルで比べる
    fwd_true = np.array([0.0, -13.0, 0.6]) / np.linalg.norm([0.0, -13.0, 0.6])
    pitch, yaw = math.radians(row["pitch"]), math.radians(row["yaw"])
    fwd = np.array([math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)])
    ang = math.degrees(math.acos(float(np.clip(fwd @ fwd_true, -1, 1))))
    focal_expected = focal_from_fx(result["fx"], 3840)
    fov = math.degrees(2 * math.atan(18.0 / row["focal"]))
    pp = track["principal_offset_px"]
    print(f"  位置: build_track {np.round(got, 1).tolist()} cm、camera.json {cam_json.tolist()}(差 {np.linalg.norm(got - cam_json):.2f} cm)、正解 {true_ue.tolist()}(差 {np.linalg.norm(got - true_ue):.1f} cm)")
    print(f"  向き: 正解との差 {ang:.3f}°、ロール {row['roll']:.3f}°。焦点距離 {row['focal']:.2f} mm(fx {result['fx']} から {focal_expected:.2f})、横の画角 {fov:.2f}°(camera.json {result['hfov_deg']}°)、"
          f"主点のずれ {np.round(pp, 2).tolist()}(正解 [6.0, -4.0])、面ごとの残差 {json.dumps({f: v['max_cm'] for f, v in track['residuals'].items()})}、行数 {len(track['rows'])}")
    checks = [("位置が camera.json と 0.5 cm 以内", np.linalg.norm(got - cam_json) < 0.5), ("位置が正解と 15 cm 以内(1.5 px の雑音)", np.linalg.norm(got - true_ue) < 15),
              ("向きが正解と 0.3° 以内・ロール 0.3° 以内", ang < 0.3 and abs(row["roll"]) < 0.3), ("焦点距離が fx から出した値と 0.01 mm 以内", abs(row["focal"] - focal_expected) < 0.01),
              ("横の画角が camera.json と 0.02° 以内", abs(fov - result["hfov_deg"]) < 0.02), ("主点のずれが 4K の画素で正しい(±0.01)", np.allclose(pp, [6.0, -4.0], atol=0.01)),
              ("面ごとの残差 3 cm 以内", all(v["max_cm"] <= 3 for v in track["residuals"].values())), ("全コマが同じ位置", all(r["x"] == row["x"] and r["y"] == row["y"] for r in track["rows"]))]
    for name, c in checks:
        print(("合格" if c else "不合格"), name)
        ok = ok and bool(c)
    return ok


def main():
    table = dots()
    keys = list(range(len(table)))
    rng = np.random.default_rng(2)
    print("超広角 固定 13 m。33 点。画面のずれ(4K の画素。13 m で 1 px ≈ 0.9 cm)・カメラの位置の誤差 cm(各 100 回の中央値)")
    ok = True
    for name, fe, sig, sf in [("K 正しい・雑音 1.5 px", 0, 1.5, False), ("K 1% ずれ・雑音 1.5 px", 0.01, 1.5, False), ("K 1% ずれ・焦点も解く", 0.01, 1.5, True), ("K 3% ずれ・焦点も解く", 0.03, 1.5, True), ("K 正しい・雑音 4 px", 0, 4, False)]:
        r = np.array([trial(rng, keys, table, (0.0, 1.7, 13.0), fe, sig, sf) for _ in range(100)])
        print(f"{name:24s} 画面 {np.median(r[:, 0]):5.2f} px  カメラ {np.median(r[:, 1]):5.1f} cm  fx {np.median(r[:, 2]):7.1f}")
        if fe == 0 and sig == 1.5:
            ok = ok and np.median(r[:, 0]) < 2
    print("合成の解き方:", "合格" if ok else "不合格")
    print("固定カットの結果 → build_track:")
    ok = handoff(table) and ok
    print("合格" if ok else "不合格")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
