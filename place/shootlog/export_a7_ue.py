"""a7 の動画の各コマのカメラの位置・向き・画角を、UE 用の CSV にする(iPhone の記録 + 固定のずれ + a7 のレンズ)。

  python place/shootlog/export_a7_ue.py --iphone-shoot <撮影フォルダ> --alignment alignment_board.json --rig rig_offset.json --lens lens.json \
      --sync sync.json --a7-fps 29.97 --a7-frames <a7 のコマ数> --ue-origin X Y Z --ue-yaw 度 --out camera_track_a7_ue.csv

a7 のコマ i の時刻 = i / fps → iPhone の時刻 t_b = (t_a - beta) / alpha → iPhone の姿勢を補間 → LED の座標 → a7 のカメラ(ずれを掛ける)→ UE。
画角・焦点距離は a7 のレンズ(lens.json)の値で、歪みは入らない(歪みは apply_distortion.py と st_map で CG にかける)。
ok が false のコマ(iPhone の追跡が切れた、時刻が記録の外)は位置を信用しない。
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np

from rig_offset import interp_pose
from shootlib import led_to_ue_matrix, load_shoot, ue_camera_row


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--iphone-shoot", required=True)
    ap.add_argument("--alignment", required=True)
    ap.add_argument("--rig", required=True)
    ap.add_argument("--lens", required=True)
    ap.add_argument("--sync", default=None)
    ap.add_argument("--a7-fps", type=float, required=True)
    ap.add_argument("--a7-frames", type=int, required=True)
    ap.add_argument("--ue-origin", nargs=3, type=float, required=True)
    ap.add_argument("--ue-yaw", type=float, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--world-jsonl", default=None, help="ARKit の世界での a7 の姿勢を frames.jsonl と同じ形(T・K・pts=a7 の秒・ok)でも書く")
    a = ap.parse_args()

    shoot = load_shoot(a.iphone_shoot)
    pts = np.array([f["pts"] for f in shoot.frames])
    T_led_from_world = np.array(json.loads(Path(a.alignment).read_text(encoding="utf-8"))["T_led_from_world"])
    T_iph_from_a7 = np.array(json.loads(Path(a.rig).read_text(encoding="utf-8"))["T_iphone_from_a7"])
    lens = json.loads(Path(a.lens).read_text(encoding="utf-8"))
    K4 = [lens["fx"], lens["fy"], lens["cx"], lens["cy"]]
    W, H = lens["image_size"]
    sync = json.loads(Path(a.sync).read_text(encoding="utf-8")) if a.sync else {"alpha": 1.0, "beta": 0.0}
    led_to_ue = led_to_ue_matrix(a.ue_origin, a.ue_yaw)

    jl = open(a.world_jsonl, "w", encoding="utf-8") if a.world_jsonl else None
    cols = ["frame", "time_s", "ue_x_cm", "ue_y_cm", "ue_z_cm", "ue_pitch_deg", "ue_yaw_deg", "ue_roll_deg",
            "hfov_deg", "vfov_deg", "focal_mm_35", "tracking_ok"]
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(cols)
        for i in range(a.a7_frames):
            t_a = i / a.a7_fps
            t_b = (t_a - sync["beta"]) / sync["alpha"]
            inside = pts[0] <= t_b <= pts[-1]
            T_w, ok, gap = interp_pose(shoot.frames, pts, min(max(t_b, pts[0]), pts[-1]))
            ok = bool(ok and inside and gap < 0.1)
            T_led_a7 = T_led_from_world @ T_w @ T_iph_from_a7
            if jl:
                T_w_a7 = T_w @ T_iph_from_a7
                jl.write(json.dumps({"i": i, "pts": round(t_a, 6), "T": [float(v) for v in T_w_a7.T.reshape(-1)], "K": K4, "ok": ok, "track": "normal" if ok else "unreliable"}, separators=(",", ":")) + "\n")
            row = ue_camera_row(T_led_a7, K4, W, H, led_to_ue)
            wr.writerow([i, f"{t_a:.5f}", *[f"{row[c]:.4f}" for c in cols[2:11]], str(ok).lower()])
    if jl:
        jl.close()
    print(f"書いた: {a.out}({a.a7_frames} コマ)")


if __name__ == "__main__":
    main()
