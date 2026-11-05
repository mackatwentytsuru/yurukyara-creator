"""顔の位置(画像) → 客の目の位置(LED の座標) → キャラの目と首が向く方向、を出して、UDP の JSON で送る橋。
座標: LED の面が z=0。x=客から見て右、y=床からの上、z=客の側。単位 m。
式(計画書 2 章): 奥行き Z = f_px × IPD / ipd_px(IPD の平均 62.1 mm。個人差 ±3.7 mm = 約 ±6% の誤差になる)。
  カメラの座標 (x_c, y_c, Z) = ((u − W/2)/f × Z, (v − H/2)/f × Z, Z)(画像の下が +y_c)、世界の位置 P = C + Rᵀ · (x_c, y_c, Z)。
  キャラの目 E から P へ向く方向: yaw = atan2(dx, dz)(右が +)、pitch = atan2(dy, hypot(dx, dz))(上が +)。dz は客の側が +。
出力(UDP、1 行の JSON)は 2 種類:
  v1(既定。UE の入口キオスクが、すでに受けている形。viewer-tracker と同じ): {"v":1,"present":bool,"az":右が+(度),"el":上が+(度),"dist":m,"n":人数,"facing":0〜1,"seq":番号}
    UE の視線の受け口(SampleCharacterKit の sampleGazeDirector。既定のポート 5321)へ、そのまま送れる。az/el は「キャラの目から見た客の方向」(カメラからではない)なので、
    カメラが床にあっても、UE は「キャラの目の位置に カメラがある」ものとして扱え、UE 側の変更が要らない。
    ただし UE は角度を「描画のカメラ(画面)を 0」として読むので、UE へ送るときは ue_cam_h_m / ue_cam_dz_m を入れる(to_ue_angles)。
    with_pixels=True のときは、いまのコマの目の中点と目の間隔の画素 "u","v_px","ipd_px" も足す(校正の点の記録用。v は版の名前なので v_px)。
  full(確かめ用): {"t","found","yaw_deg","pitch_deg","pos_m","ipd_px","age_ms"}
  見失ったら hold_s の間は最後の向きを送り続け、そのあと present=false。
外部パラメータ(カメラの置き場所・向き)は、現地で測った値(または solvePnP の結果)で gaze_geometry.json に入れる。既定は仮の値(未測定)。
"""
from __future__ import annotations

import json
import math
import socket
import time
from dataclasses import dataclass, field

import numpy as np

IPD_MEAN_M = 0.0621


@dataclass
class Geometry:
    width: int = 1920
    height: int = 1080
    hfov_deg: float = 75.2  # Tapo C200 の公表値(水平)
    cam_pos: tuple = (0.0, 0.1, 0.0)  # カメラの位置(LED の面を z=0)。仮: LED の下端の下 0.1 m
    cam_pitch_deg: float = 36.0  # 上向きの角度。仮
    eye_pos: tuple = (0.0, 2.0, -0.3)  # キャラの目の位置(LED の面の少し奥)。仮
    ipd_m: float = IPD_MEAN_M
    ema: float = 0.5  # 向きの平滑化(0 = 平滑なし、1 に近いほど重い)
    hold_s: float = 0.5
    # 映像の向き(11-05 直し)。客の方を向いた普通のカメラは、客の右手が画像の左に、高い所が画像の上に写る(鏡ではない)。
    # Tapo のアプリで「画像を反転(180°)」にしたとき・カメラを逆さに付けたときだけ True。
    image_rot180: bool = False
    # UE の入口キオスク(sampleGazeDirector)へ送るときの変換(0 = 変換なし)。UE は az/el を「キャラの頭から見た、
    # 描画のカメラ(画面)を 0 とする角度」として、カメラの面の上の点に直す(画面の前の固定カメラの前提)。
    # ここに UE の中の「頭 → 描画のカメラ」の水平の距離と高さの差(m。カメラが下なら負)を入れると、
    # 「水平を 0 とする向き」を UE の読み方に直して送る(UE は変えなくてよい)。
    ue_cam_h_m: float = 0.0
    ue_cam_dz_m: float = 0.0

    @property
    def f_px(self) -> float:
        return (self.width / 2) / math.tan(math.radians(self.hfov_deg / 2))

    @staticmethod
    def load(path: str | None) -> "Geometry":
        g = Geometry()
        if path:
            d = json.load(open(path, encoding="utf-8"))
            for k, v in d.items():
                if hasattr(g, k):
                    setattr(g, k, tuple(v) if isinstance(v, list) else v)
        return g


def cam_rotation(pitch_deg: float, rot180: bool = False) -> np.ndarray:
    """世界 → カメラの回転(カメラ座標: x=画像の右, y=画像の下, z=前)。カメラは +z(客の側)を向き、pitch だけ上を向く。
    客の方を向いたカメラの画像の右は、世界の −x(客から見て左)。画像の下は、世界の下(と LED の側)。
    11-05 まではこの 2 つが逆(画像を 180° 回した前提)で、本物の Tapo では左右も上下も逆に向いた。rot180=True がその前の式。"""
    p = math.radians(pitch_deg)
    fwd = np.array([0.0, math.sin(p), math.cos(p)])
    right = np.array([-1.0, 0.0, 0.0])
    down = np.cross(fwd, right)  # = (0, −cos p, sin p)
    if rot180:
        right, down = -right, -down
    return np.stack([right, down, fwd])


def pixel_to_world(g: Geometry, u: float, v: float, ipd_px: float) -> np.ndarray:
    """画像の点 (u, v)(画素)と目の間隔(画素)から、世界の位置"""
    z = g.f_px * g.ipd_m / ipd_px
    cam = np.array([(u - g.width / 2) / g.f_px * z, (v - g.height / 2) / g.f_px * z, z])
    return np.array(g.cam_pos) + cam_rotation(g.cam_pitch_deg, g.image_rot180).T @ cam


def to_ue_angles(g: Geometry, az_deg: float, el_deg: float) -> tuple[float, float]:
    """水平を 0 とする向き(キャラの目から)→ UE の sampleGazeDirector の読み方(描画のカメラを 0、カメラの面の上の点)。
    UE: 点 = カメラ + 右 × D·tan(az') + 上 × D·tan(el')(D = 頭とカメラの距離。カメラは水平を向く前提)。
    その点が、頭から (az, el) の向きの線の上に来るように az', el' を選ぶ。ue_cam_h_m が 0 なら変えない。"""
    h, dz = g.ue_cam_h_m, g.ue_cam_dz_m
    if h <= 0:
        return az_deg, el_deg
    a, e = math.radians(az_deg), math.radians(el_deg)
    lat = h * math.tan(a)
    up = h * math.tan(e) / max(math.cos(a), 1e-6) - dz
    d = math.hypot(h, dz)
    return math.degrees(math.atan2(lat, d)), math.degrees(math.atan2(up, d))


def world_to_pixel(g: Geometry, p: np.ndarray) -> tuple[float, float, float]:
    """(試験用)世界の位置 → (u, v, 目の間隔の画素)。pixel_to_world の逆"""
    cam = cam_rotation(g.cam_pitch_deg, g.image_rot180) @ (np.asarray(p, float) - np.array(g.cam_pos))
    z = cam[2]
    return cam[0] / z * g.f_px + g.width / 2, cam[1] / z * g.f_px + g.height / 2, g.f_px * g.ipd_m / z


def gaze_angles(eye_pos, target) -> tuple[float, float]:
    d = np.asarray(target, float) - np.asarray(eye_pos, float)
    return math.degrees(math.atan2(d[0], d[2])), math.degrees(math.atan2(d[1], math.hypot(d[0], d[2])))


@dataclass
class GazeBridge:
    g: Geometry = field(default_factory=Geometry)
    sink: tuple | None = ("127.0.0.1", 5321)
    packet: str = "v1"  # "v1"(UE が受けている形)か "full"
    with_pixels: bool = False  # v1 に、いまのコマの目の中点(u, v 画素)と目の間隔(画素)も付ける(校正の点を記録する受け口が使う)
    _seq: int = 0
    _yaw: float | None = None
    _pitch: float | None = None
    _pos: list | None = None
    _last_seen: float = 0.0
    _sock: socket.socket | None = None

    def update(self, now: float, det: dict, age_ms: float = 0.0) -> dict:
        """検出の結果(detect.FaceDetector.detect の戻り)から、出力の 1 件を作って送る(sink があれば)"""
        g = self.g
        if det.get("found") and det.get("ipd_px", 0) > 5:
            u = det.get("eye_x", det["cx"]) * g.width
            v = det.get("eye_y", det["cy"]) * g.height
            pos = pixel_to_world(g, u, v, det["ipd_px"])
            raw_px = (round(u, 1), round(v, 1), round(float(det["ipd_px"]), 2))
            yaw, pitch = gaze_angles(g.eye_pos, pos)
            if self._yaw is None:
                self._yaw, self._pitch = yaw, pitch
            else:
                a = g.ema
                self._yaw = a * self._yaw + (1 - a) * yaw
                self._pitch = a * self._pitch + (1 - a) * pitch
            self._pos = [round(float(x), 3) for x in pos]
            self._last_seen = now
            found = True
        else:
            raw_px = None
            found = self._yaw is not None and now - self._last_seen <= g.hold_s
        msg = {"t": round(now, 4), "found": bool(found), "age_ms": round(age_ms, 1)}
        if found:
            msg.update(yaw_deg=round(self._yaw, 2), pitch_deg=round(self._pitch, 2), pos_m=self._pos, ipd_px=det.get("ipd_px"))
        self._seq += 1
        if self.packet == "v1":
            dist = float(np.linalg.norm(np.array(self._pos) - np.array(g.eye_pos))) if found and self._pos else 0.0
            az, el = to_ue_angles(g, self._yaw, self._pitch) if found else (0.0, 0.0)
            v1 = {"v": 1, "present": bool(found), "az": round(az, 2), "el": round(el, 2),
                  "dist": round(dist, 2), "n": 1 if found else 0, "facing": 1.0 if found else 0.0, "seq": self._seq}
            if self.with_pixels and raw_px:
                v1.update(u=raw_px[0], v_px=raw_px[1], ipd_px=raw_px[2])
            self._send(v1)
        else:
            self._send(msg)
        return msg

    def _send(self, msg: dict) -> None:
        if not self.sink:
            return
        if self._sock is None:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.sendto((json.dumps(msg, ensure_ascii=False) + "\n").encode(), self.sink)
