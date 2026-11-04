"""1 コマから、いちばん大きい顔の位置・目の間隔(画素)を出す。MediaPipe Face Landmarker(IMAGE 型。コマの時刻に左右されない)。"""
from __future__ import annotations

import math
import time
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

MODEL = Path(__file__).resolve().parents[3] / "web" / "public" / "mediapipe" / "face_landmarker.task"
LEFT_IRIS, RIGHT_IRIS = 468, 473
LEFT_CHEEK, RIGHT_CHEEK = 234, 454


class FaceDetector:
    def __init__(self, model: str | Path = MODEL, detect_width: int = 0):
        self.detect_width = detect_width  # 0 = 縮めない(遠い顔は小さいので、既定は原寸)
        self.lm = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=str(model)), running_mode=vision.RunningMode.IMAGE, num_faces=2)
        )

    def detect(self, bgr) -> dict:
        """戻り値: found, cx, cy(顔の中心。0〜1)、ipd_px、face_w_px(原寸の画素)、det_ms"""
        h, w = bgr.shape[:2]
        scale = 1.0
        img = bgr
        if self.detect_width and w > self.detect_width:
            scale = self.detect_width / w
            img = cv2.resize(bgr, (self.detect_width, int(h * scale)), interpolation=cv2.INTER_AREA)
        t0 = time.perf_counter()
        res = self.lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
        det_ms = (time.perf_counter() - t0) * 1000
        out = {"found": False, "det_ms": round(det_ms, 1)}
        if not res.face_landmarks:
            return out
        ih, iw = img.shape[:2]
        best = None
        for lms in res.face_landmarks:
            fw = math.hypot((lms[RIGHT_CHEEK].x - lms[LEFT_CHEEK].x) * iw, (lms[RIGHT_CHEEK].y - lms[LEFT_CHEEK].y) * ih) / scale
            if best is None or fw > best[0]:
                best = (fw, lms)
        fw, lms = best
        ipd = math.hypot((lms[RIGHT_IRIS].x - lms[LEFT_IRIS].x) * iw, (lms[RIGHT_IRIS].y - lms[LEFT_IRIS].y) * ih) / scale
        xs = [p.x for p in lms]
        ys = [p.y for p in lms]
        out.update(found=True, cx=round((min(xs) + max(xs)) / 2, 4), cy=round((min(ys) + max(ys)) / 2, 4), ipd_px=round(ipd, 1), face_w_px=round(fw, 1))
        return out
