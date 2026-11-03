"""固定カメラ(キオスクのカメラ役)の動画から、顔の検出の当たり率・顔の大きさ・頭の向きを、位置ごとに出す。
自宅の校正の試験(iPhone/Pixel を画面の下に固定、客役が床の格子に立つ)の解析用。

  python kiosk/tools/probe_video.py --video iphone.mov --out probe.csv --summary summary.json [--every 2] [--max-flashes 40]

位置の切れ目は、校正の表示(kiosk/web/calib.html)の白いフラッシュ(客の顔が明るくなる)で見つける。
フラッシュの検出: コマの平均の明るさが、直前の中央値の FLASH_RATIO 倍を超えた所(連続は 1 つにまとめる)。
出すもの: 位置(フラッシュで区切った区間)ごとの、顔が見つかった割合・顔の幅(画素)・目の間隔(画素)・頭の向き(ピッチ・ヨー)の中央値。
音や映像は保存しない(数字の CSV と JSON だけ)。mediapipe(python)と opencv が要る。
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

FLASH_RATIO = 1.5
MODEL = Path(__file__).resolve().parents[2] / "web" / "public" / "mediapipe" / "face_landmarker.task"
LEFT_IRIS, RIGHT_IRIS = 468, 473
LEFT_CHEEK, RIGHT_CHEEK = 234, 454


def euler_from_matrix(m: np.ndarray) -> tuple[float, float, float]:
    """顔の変換行列(4x4)から、ピッチ・ヨー・ロール(度)。カメラの向きに対する、顔の向き"""
    r = np.array(m)[:3, :3]
    sy = math.hypot(r[0, 0], r[1, 0])
    pitch = math.degrees(math.atan2(-r[2, 1], r[2, 2]))
    yaw = math.degrees(math.atan2(r[2, 0], sy))
    roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    return pitch, yaw, roll


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True, help="コマごとの CSV")
    ap.add_argument("--summary", required=True, help="位置ごとのまとめ JSON")
    ap.add_argument("--every", type=int, default=2, help="何コマに 1 回調べるか")
    ap.add_argument("--model", default=str(MODEL))
    ap.add_argument("--max-frames", type=int, default=0)
    ap.add_argument("--flash-ratio", type=float, default=FLASH_RATIO)
    ap.add_argument("--still-from", type=float, default=10.0, help="フラッシュから何秒後を「止まって見ている間」の始めにするか(校正の表示の自動モードは 9 秒移動)")
    ap.add_argument("--period", type=float, default=25.0, help="自動モードの 1 位置あたりの秒(最後の位置の終わりの目安)")
    a = ap.parse_args()

    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened():
        raise SystemExit(f"動画を開けません: {a.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    opts = vision.FaceLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=a.model),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=2,
        output_facial_transformation_matrixes=True,
    )
    rows = []
    i = 0
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            i += 1
            if (i - 1) % a.every:
                continue
            if a.max_frames and len(rows) >= a.max_frames:
                break
            t = (i - 1) / fps
            h, w = frame.shape[:2]
            bright = float(frame.mean())
            res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), int(t * 1000))
            row = {"t": round(t, 3), "w": w, "h": h, "bright": round(bright, 2), "faces": len(res.face_landmarks), "face_w_px": "", "ipd_px": "", "cx": "", "cy": "", "pitch": "", "yaw": "", "roll": ""}
            if res.face_landmarks:
                pts = res.face_landmarks[0]
                row["face_w_px"] = round(math.hypot((pts[LEFT_CHEEK].x - pts[RIGHT_CHEEK].x) * w, (pts[LEFT_CHEEK].y - pts[RIGHT_CHEEK].y) * h), 1)
                row["ipd_px"] = round(math.hypot((pts[LEFT_IRIS].x - pts[RIGHT_IRIS].x) * w, (pts[LEFT_IRIS].y - pts[RIGHT_IRIS].y) * h), 1)
                row["cx"] = round(sum(p.x for p in pts) / len(pts), 4)
                row["cy"] = round(sum(p.y for p in pts) / len(pts), 4)
                if res.facial_transformation_matrixes:
                    p, y, r = euler_from_matrix(res.facial_transformation_matrixes[0])
                    row["pitch"], row["yaw"], row["roll"] = round(p, 1), round(y, 1), round(r, 1)
            rows.append(row)
    cap.release()

    with open(a.out, "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["t"])
        wr.writeheader()
        wr.writerows(rows)

    # フラッシュ(明るさの急な上がり)で区間に分ける
    flashes: list[float] = []
    window: list[float] = []
    for r in rows:
        if len(window) >= 8 and r["bright"] > statistics.median(window[-8:]) * a.flash_ratio and (not flashes or r["t"] - flashes[-1] > 1.5):
            flashes.append(r["t"])
        window.append(r["bright"])
    bounds = flashes + [rows[-1]["t"] + 1e-3] if rows else []
    segs = []
    for k, start in enumerate(flashes):
        end = min(bounds[k + 1], start + a.period) - 1.0 if k + 1 < len(flashes) else start + a.period - 1.0
        seg = [r for r in rows if start + a.still_from <= r["t"] < end]  # 移動の間を除いた、止まって見ている間
        det = [r for r in seg if r["faces"] > 0]

        def med(key):
            v = [r[key] for r in det if r[key] != ""]
            return round(statistics.median(v), 1) if v else None

        segs.append({"位置の順番": k + 1, "開始秒": start, "コマ数": len(seg), "顔が見つかった割合": round(len(det) / len(seg), 3) if seg else None, "顔の幅_画素": med("face_w_px"), "目の間隔_画素": med("ipd_px"), "ピッチ_度": med("pitch"), "ヨー_度": med("yaw"), "画面内の位置_x": med("cx"), "画面内の位置_y": med("cy")})
    allDet = [r for r in rows if r["faces"] > 0]
    summary = {"動画": Path(a.video).name, "fps": fps, "調べたコマ": len(rows), "全体の見つかった割合": round(len(allDet) / len(rows), 3) if rows else None, "フラッシュの数": len(flashes), "位置ごと": segs, "note": "音・映像は保存していない。位置の番号は、フラッシュの順(P01 から)。ピッチ・ヨーは MediaPipe の変換行列の向き(符号の約束は実機で確かめる)"}
    Path(a.summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("調べたコマ", "全体の見つかった割合", "フラッシュの数")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
