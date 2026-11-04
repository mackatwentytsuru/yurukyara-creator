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
        out.update(found=True, cx=round((min(xs) + max(xs)) / 2, 4), cy=round((min(ys) + max(ys)) / 2, 4), ipd_px=round(ipd, 1), face_w_px=round(fw, 1),
                   eye_x=round((lms[LEFT_IRIS].x + lms[RIGHT_IRIS].x) / 2, 4), eye_y=round((lms[LEFT_IRIS].y + lms[RIGHT_IRIS].y) / 2, 4))  # 目の中点(0〜1)。視線の位置はこちらを使う
        return out


class FaceTracker:
    """遠い顔でも見つけるための 3 段の検出。標準の検出器は、顔が画面の幅の約 6%(1080p で目の間隔 約 100 画素)より小さいと見つけられない
    (合成の顔で測った。実際の顔は 4.5% でも見つかった)。そこで:
      1. 前に顔が見つかった場所の周りだけを切り出して(顔の幅の 3 倍・最低 480 画素に拡大)検出する(追跡。1 回で済む)
      2. 見つからなければ、全体で検出する
      3. それでも見つからなければ、画面を重なりのある小窓(640×360)に分けて、1 つずつ検出する(探索。search_every コマに 1 回)
    戻りの形は FaceDetector.detect と同じ(座標は全体の画像に対する 0〜1、画素は全体の画素)。"""

    def __init__(self, detector: FaceDetector | None = None, search_every: int = 3):
        self.det = detector or FaceDetector()
        self.search_every = search_every
        self.roi = None  # (x0, y0, x1, y1) 画素
        self._n = 0

    def _crop(self, bgr, x0, y0, x1, y1, min_w=480):
        h, w = bgr.shape[:2]
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(w, int(x1)), min(h, int(y1))
        if x1 - x0 < 16 or y1 - y0 < 16:
            return {"found": False, "det_ms": 0.0}
        crop = bgr[y0:y1, x0:x1]
        up = max(1.0, min_w / (x1 - x0))
        if up > 1.0:
            crop = cv2.resize(crop, None, fx=up, fy=up, interpolation=cv2.INTER_CUBIC)
        r = self.det.detect(crop)
        if not r["found"]:
            return r
        cw, ch = x1 - x0, y1 - y0
        r["cx"], r["cy"] = round((x0 + r["cx"] * cw) / w, 4), round((y0 + r["cy"] * ch) / h, 4)
        r["eye_x"], r["eye_y"] = round((x0 + r["eye_x"] * cw) / w, 4), round((y0 + r["eye_y"] * ch) / h, 4)
        r["ipd_px"], r["face_w_px"] = round(r["ipd_px"] / up, 1), round(r["face_w_px"] / up, 1)
        return r

    def _scan(self, bgr, tw, th, sx, sy, min_w):
        h, w = bgr.shape[:2]
        ms = 0.0
        for y0 in range(0, max(1, h - th + 1), sy):
            for x0 in range(0, max(1, w - tw + 1), sx):
                rr = self._crop(bgr, x0, y0, x0 + tw, y0 + th, min_w=min_w)
                ms += rr["det_ms"]
                if rr["found"]:
                    return rr, ms
        return None, ms

    def detect(self, bgr) -> dict:
        h, w = bgr.shape[:2]
        self._n += 1
        total_ms = 0.0
        stage = ""
        r = None
        if self.roi is not None:
            r = self._crop(bgr, *self.roi)
            total_ms += r["det_ms"]
            stage = "追跡"
        if r is None or not r["found"]:
            r = self.det.detect(bgr)
            total_ms += r["det_ms"]
            stage = "全体"
            if not r["found"] and (self._n % self.search_every == 0):
                # 探索: 粗い小窓(640×360)→ 細かい小窓(400×225 を 2 倍に拡大。目の間隔 約 26 画素 = 3 m まで)
                for tw, th, sx, sy, min_w in ((640, 360, 480, 270, 640), (400, 225, 300, 170, 800)):
                    rr, ms = self._scan(bgr, tw, th, sx, sy, min_w)
                    total_ms += ms
                    if rr is not None:
                        r, stage = rr, "探索"
                        break
        if r["found"]:
            fw = r["face_w_px"]
            cx, cy = r["cx"] * w, r["cy"] * h
            half = fw * 1.5
            self.roi = (cx - half, cy - half * 1.2, cx + half, cy + half * 1.2)
        else:
            self.roi = None
        r["det_ms"] = round(total_ms, 1)
        r["stage"] = stage
        return r
