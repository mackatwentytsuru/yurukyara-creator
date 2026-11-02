"""撮影記録のカメラの動きを、UE(Unreal Engine)で再生できる CSV にする。

  python place/shootlog/export_ue.py <撮影フォルダ> --ue-origin <X> <Y> <Z> --ue-yaw <度> [--alignment alignment.json] [--out camera_track_ue.csv]

前もって align_led.py で alignment_<面>.json(ARKit の世界 → LED の座標)を作っておく。
--ue-origin … UE のレベルで、LED の「客席から見て左下の角」がある位置(cm)。
--ue-yaw    … 客席から見た LED の「右」が向く向き(UE の Yaw、+X から +Y へ測った度)。
出力の列: コマ番号, 時刻(秒、映像の pts), UE の位置(cm)と向き(Pitch/Yaw/Roll 度), 画角(横・縦の度), 35mm 換算の焦点距離(mm),
          追跡 ok(false のコマは位置を信用しない)。
ロールの符号は UE のカメラの規約に合わせて、最初に UE で1コマ確かめること。
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np

from shootlib import led_to_ue_matrix, load_shoot, mat4, ue_camera_row


def export(shoot_dir, alignment_path, origin_cm, yaw_deg, out_path):
    shoot = load_shoot(shoot_dir)
    al = json.loads(Path(alignment_path).read_text(encoding="utf-8"))
    T_led_from_world = np.array(al["T_led_from_world"])
    led_to_ue = led_to_ue_matrix(origin_cm, yaw_deg)
    w, h = shoot.width, shoot.height
    cols = ["frame", "time_s", "ue_x_cm", "ue_y_cm", "ue_z_cm", "ue_pitch_deg", "ue_yaw_deg", "ue_roll_deg",
            "hfov_deg", "vfov_deg", "focal_mm_35", "tracking_ok", "tracking"]
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(cols)
        for fr in shoot.frames:
            T_world = mat4(fr["T"])
            T_in_led = T_led_from_world @ T_world
            row = ue_camera_row(T_in_led, fr["K"], w, h, led_to_ue)
            wr.writerow([fr["i"], f"{fr['pts']:.6f}",
                         *[f"{row[c]:.4f}" for c in cols[2:11]], str(fr["ok"]).lower(), fr["track"]])
    return len(shoot.frames)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shoot_dir")
    ap.add_argument("--ue-origin", nargs=3, type=float, required=True, metavar=("X", "Y", "Z"))
    ap.add_argument("--ue-yaw", type=float, required=True)
    ap.add_argument("--alignment", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    al = a.alignment or str(Path(a.shoot_dir) / "alignment_A.json")
    out = a.out or str(Path(a.shoot_dir) / "camera_track_ue.csv")
    n = export(a.shoot_dir, al, a.ue_origin, a.ue_yaw, out)
    print(f"書いた: {out}({n} コマ)")


if __name__ == "__main__":
    main()
