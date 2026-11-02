"""ステージの寸法と LED の面の割り当て(UE に依存しない計算だけ)。

単位 cm。x=0 が中央の面の真ん中、+x が上手(客席から見て右)、+y が客席、z=0 がホールの床。
1 本の絵(5680x1240)を、本物の送出と同じ割り当てで 3 面に映す。
"""
import math

CANVAS_W = 5680.0
CANVAS_H = 1240.0
LED_Z_BOTTOM = 98.0
LED_Z_TOP = 594.0
LED_HEIGHT = LED_Z_TOP - LED_Z_BOTTOM
PANEL_W_CM = 32.0
PANEL_H_CM = 16.0
STAGE_Z = 90.0

A_X0, A_X1 = -749.7, -237.7
B_X_HALF = 352.0
B_Y = -140.0
B_PX_X0, B_PX_X1 = 957.0, 3345.0
B_PX_Y0, B_PX_Y1 = 85.0, 1218.0
C_PX_X0, C_PX_X1 = 3039.0, 5680.0
C_TOTAL_CM = 1056.0
C_FLAT_X0, C_FLAT_X1 = 236.7, 736.7
C_CURVE_PLATES = 16

# 上手の面の曲がりの実測(パネルの中心を新しい座標に直した値。y=0 を過ぎてから客席へ曲がる)
C_CURVE_MEASURED = [
    (732.6, 0.0), (764.7, 0.5), (796.9, 2.5), (828.9, 7.9), (860.0, 17.2),
    (889.7, 30.2), (917.6, 46.7), (943.3, 66.4), (966.5, 89.1), (986.7, 114.4),
    (1003.8, 142.0), (1017.4, 171.5), (1027.4, 202.3), (1033.5, 234.2),
    (1035.4, 266.6), (1035.2, 298.6), (1035.2, 330.5), (1035.2, 362.5), (1035.2, 378.5),
]


CAMERAS = {
    "wide": {"pos": (0, 1300, 220), "target": (190, 0, 330), "focal": 13.4},
    "close": {"pos": (0, 480, 140), "target": (0, 0, 235), "focal": 14.0},
}


def plate(name, start, end, px_x0, px_x1, px_y0=0.0, px_y1=CANVAS_H, panel_start_cm=0.0):
    """1 枚の板。start から end へ向かう向きが、絵の左から右。"""
    width = math.hypot(end[0] - start[0], end[1] - start[1])
    return {
        "name": name,
        "start": start,
        "end": end,
        "width": width,
        "u_scale": (px_x1 - px_x0) / CANVAS_W,
        "u_offset": px_x0 / CANVAS_W,
        "v_scale": (px_y1 - px_y0) / CANVAS_H,
        "v_offset": px_y0 / CANVAS_H,
        "grid_u_count": width / PANEL_W_CM,
        "grid_u_offset": panel_start_cm / PANEL_W_CM,
        "grid_v_count": LED_HEIGHT / PANEL_H_CM,
    }


def resample_polyline(points, count):
    """折れ線を、長さの等しい count 本に分ける。"""
    lengths = [math.dist(a, b) for a, b in zip(points, points[1:])]
    total = sum(lengths)
    step = total / count
    result = [points[0]]
    walked = 0.0
    index = 0
    for i in range(1, count):
        target = step * i
        while walked + lengths[index] < target:
            walked += lengths[index]
            index += 1
        t = (target - walked) / lengths[index]
        a, b = points[index], points[index + 1]
        result.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    result.append(points[-1])
    return result, total


def c_curve_points():
    """平らな所の終わり (736.7, 0) から始まる、曲がりの折れ線。"""
    points = [(C_FLAT_X1, 0.0)]
    points += [p for p in C_CURVE_MEASURED if p[0] > C_FLAT_X1]
    return points


def led_plates():
    px_per_cm = (C_PX_X1 - C_PX_X0) / C_TOTAL_CM
    flat_cm = C_FLAT_X1 - C_FLAT_X0
    b_mid = (B_PX_X0 + B_PX_X1) / 2.0
    plates = [
        plate("LED_A", (A_X0, 0.0), (A_X1, 0.0), 0.0, 1279.0),
        plate("LED_B_L", (-B_X_HALF, B_Y), (0.0, B_Y), B_PX_X0, b_mid, B_PX_Y0, B_PX_Y1),
        plate("LED_B_R", (0.0, B_Y), (B_X_HALF, B_Y), b_mid, B_PX_X1, B_PX_Y0, B_PX_Y1,
              panel_start_cm=B_X_HALF),
        plate("LED_C_Flat", (C_FLAT_X0, 0.0), (C_FLAT_X1, 0.0),
              C_PX_X0, C_PX_X0 + flat_cm * px_per_cm),
    ]
    points, curve_len = resample_polyline(c_curve_points(), C_CURVE_PLATES)
    # 実測の折れ線の長さと 556 cm の差は、絵の割り当てで吸収する(絵の右端が面の端に来る)
    px_start = C_PX_X0 + flat_cm * px_per_cm
    px_step = (C_PX_X1 - px_start) / C_CURVE_PLATES
    cm_step = curve_len / C_CURVE_PLATES
    for i in range(C_CURVE_PLATES):
        plates.append(plate(
            f"LED_C_Curve{i:02d}", points[i], points[i + 1],
            px_start + px_step * i, px_start + px_step * (i + 1),
            panel_start_cm=flat_cm + cm_step * i,
        ))
    return plates, curve_len


def plate_axes(p):
    """板の中心と、局所 X(絵の右)・局所 Z(表の向き)を返す。"""
    (x0, y0), (x1, y1) = p["start"], p["end"]
    tx, ty = (x1 - x0) / p["width"], (y1 - y0) / p["width"]
    center = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (LED_Z_BOTTOM + LED_Z_TOP) / 2.0)
    return center, (tx, ty, 0.0), (-ty, tx, 0.0)


if __name__ == "__main__":
    plates, curve = led_plates()
    print("curve length measured", round(curve, 1), "target", C_TOTAL_CM - (C_FLAT_X1 - C_FLAT_X0))
    for p in plates:
        print(p["name"], [round(v, 1) for v in p["start"] + p["end"]], round(p["width"], 1),
              "px", round(p["u_offset"] * CANVAS_W), round((p["u_offset"] + p["u_scale"]) * CANVAS_W))
