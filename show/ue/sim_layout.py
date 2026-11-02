"""シミュレーターの 3 つのカメラ(UE に依存しない計算だけ)。単位 cm。座標は stage_layout と同じ。

焦点距離は、スマホの表示と同じ 35mm 換算で書く。
"""
import math

from stage_layout import STAGE_Z

SENSOR_W_MM = 23.76  # build_level.camera のセンサー幅
STAGE_FRONT_Y = 450.0  # 舞台の前の縁(build_level の Stage_Floor)
STAGE_CENTER_X = 130.0  # 舞台の幅の真ん中(-800〜1060)
FPS = 30
LEAD_FRAMES = 60  # 撮影の準備のコマの置き場。映像の 0 秒をこのコマに置く
MEDIA_LATENCY_FRAMES = 1  # メディアの絵は 1 コマ遅れて届く(測定: 相関 0.99 でずれ -1)。その分だけ先に流す

SIM_CAMERAS = {
    "Sim_Cam1": {"title": "全景", "pos": (STAGE_CENTER_X, 1600.0, 150.0), "target": (238.0, 0.0, 340.0),
                 "mm35": 26.0},
    "Sim_Cam2": {"title": "斜め", "pos": (-600.0, 1200.0, 150.0), "target": (120.0, -60.0, 335.0),
                 "mm35": 50.0},
    "Sim_Cam3": {"title": "見上げ", "pos": (0.0, 730.0, 60.0), "target": (0.0, -140.0, 325.0),
                 "mm35": 26.0},
}


def real_focal(mm35):
    """35mm 換算(横 36mm)を、このセンサーの焦点距離にする。"""
    return mm35 * SENSOR_W_MM / 36.0


def horizontal_fov_deg(mm35):
    return math.degrees(2.0 * math.atan(18.0 / mm35))


def camera_place(spec):
    """本人がその場所を探すための数字。"""
    x, y, z = spec["pos"]
    return {
        "from_front_edge_m": round((y - STAGE_FRONT_Y) / 100.0, 2),
        "from_stage_center_m": round(math.hypot(x, y) / 100.0, 2),
        "side_m": round(x / 100.0, 2),
        "height_from_hall_floor_m": round(z / 100.0, 2),
    }


def hidden_led_bottom_cm(spec, led_y=-140.0):
    """舞台の前の縁に隠れる、中央の面の下の部分(舞台の床からの高さ、cm)。隠れなければ 0。"""
    _, y, z = spec["pos"]
    if z >= STAGE_Z:
        return 0.0
    hidden_z = STAGE_Z + (STAGE_Z - z) * (STAGE_FRONT_Y - led_y) / (y - STAGE_FRONT_Y)
    return round(hidden_z - STAGE_Z, 1)


if __name__ == "__main__":
    for name, spec in SIM_CAMERAS.items():
        print(name, spec["title"], camera_place(spec), "hfov", round(horizontal_fov_deg(spec["mm35"]), 1),
              "hidden", hidden_led_bottom_cm(spec))
