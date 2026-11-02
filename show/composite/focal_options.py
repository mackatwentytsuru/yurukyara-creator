"""焦点距離の案を、LED の角と床が入るかで計算し、シミュレーターで撮って 1 枚に並べる。

使い方: python focal_options.py <出力の jpg> --video <LED の映像> --wav <音> --out-dir <作業フォルダ> [--at 秒] [--no-render]
実質の焦点距離は、35mm 判の値 × クロップ。計算はピンホール(歪みなし)。LED の角: A の左端、C の曲がりの右端。床: 中央の面の幅の、舞台の前の縁。
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "ue")]

from sim_layout import STAGE_CENTER_X, STAGE_FRONT_Y  # noqa: E402
from stage_layout import A_X0, B_Y, C_CURVE_MEASURED, LED_Z_BOTTOM, LED_Z_TOP, STAGE_Z  # noqa: E402
from ue_axes import project_ue, rotator_axes  # noqa: E402

FONT = "C:/Windows/Fonts/meiryob.ttc"
WIDTH, HEIGHT = 1920, 1080
CAMERA_Z = 150.0
MARGIN_RATIO = 0.015  # 画面の端に残す余り
OPTIONS = [("A", "30p × 24mm", 24.0, 1.2), ("B", "30p × 28mm", 28.0, 1.2), ("C", "24p × 28mm", 28.0, 1.0)]
DISTANCES_M = [9.0, 10.0, 11.0, 11.5, 12.0, 12.5, 13.0, 14.0, 15.0, 16.0]
SEARCH_LIMIT_M = 30.0
SEARCH_STEP_M = 0.05
HALL_DEPTH_NOTE_M = 14.1
SHOT_DISTANCE_M = 12.5
ZOOM_WIDE_MM = 24.0
ZOOM_SEARCH_END_MM = 50.0
CROP_30P = 1.2
C_END = C_CURVE_MEASURED[-1]
MUST_SEE = np.array([[A_X0, 0.0, LED_Z_TOP], [A_X0, 0.0, LED_Z_BOTTOM], [C_END[0], C_END[1], LED_Z_TOP],
                     [C_END[0], C_END[1], LED_Z_BOTTOM], [-352.0, B_Y, LED_Z_TOP], [352.0, B_Y, LED_Z_TOP],
                     [-352.0, STAGE_FRONT_Y, STAGE_Z], [352.0, STAGE_FRONT_Y, STAGE_Z]])  # 床はキャラが立つ幅の前の縁


def frame_fit(distance_m, mm35):
    """カメラの向きを一番よく振ったときの、見る点の画面の範囲。戻り: (入るか, 余りの割合, pitch, yaw)。"""
    position = (STAGE_CENTER_X, STAGE_FRONT_Y + distance_m * 100.0, CAMERA_Z)
    fx = mm35 / 36.0 * WIDTH
    aim = MUST_SEE - np.array(position)
    yaw = float(np.degrees(np.arctan2(aim[:, 1], aim[:, 0])).mean())
    pitch = float(np.degrees(np.arctan2(aim[:, 2], np.hypot(aim[:, 0], aim[:, 1]))).mean())
    for _ in range(6):  # 見える範囲の真ん中へ向きを寄せる
        pixels, _depth = project_ue(MUST_SEE, position, *rotator_axes(pitch, yaw, 0.0), fx, fx, WIDTH / 2.0, HEIGHT / 2.0)
        yaw += np.degrees(np.arctan(((pixels[:, 0].min() + pixels[:, 0].max()) / 2 - WIDTH / 2.0) / fx))
        pitch -= np.degrees(np.arctan(((pixels[:, 1].min() + pixels[:, 1].max()) / 2 - HEIGHT / 2.0) / fx))
    pixels, _depth = project_ue(MUST_SEE, position, *rotator_axes(pitch, yaw, 0.0), fx, fx, WIDTH / 2.0, HEIGHT / 2.0)
    room_x = (WIDTH - np.ptp(pixels[:, 0])) / WIDTH
    room_y = (HEIGHT - np.ptp(pixels[:, 1])) / HEIGHT
    return bool(min(room_x, room_y) >= MARGIN_RATIO), float(min(room_x, room_y)), pitch, yaw


def min_distance(mm35):
    for distance in np.arange(5.0, SEARCH_LIMIT_M, SEARCH_STEP_M):
        if frame_fit(float(distance), mm35)[0]:
            return round(float(distance), 2)
    return None


def longest_zoom_30p(distance_m):
    """その距離で入る、30p(1.2 倍)のズームの目盛りの一番長い値(mm)。"""
    best = 0.0
    for zoom in np.arange(ZOOM_WIDE_MM - 6.0, ZOOM_SEARCH_END_MM, 0.25):
        if frame_fit(distance_m, zoom * CROP_30P)[0]:
            best = float(zoom)
    return best


def table():
    rows = []
    for key, name, mm, crop in OPTIONS:
        eq = mm * crop
        rows.append({"key": key, "name": name, "mm35": eq, "hfov_deg": round(float(np.degrees(2 * np.arctan(18.0 / eq))), 1),
                     "min_distance_m": min_distance(eq),
                     "fits": {str(d): frame_fit(d, eq)[0] for d in DISTANCES_M}})
    return rows


def shoot(option, args):
    """案を 1 枚撮る。"""
    _, _, pitch, yaw = frame_fit(SHOT_DISTANCE_M, option["mm35"])
    position = (STAGE_CENTER_X, STAGE_FRONT_Y + SHOT_DISTANCE_M * 100.0, CAMERA_Z)
    forward, _, _ = rotator_axes(pitch, yaw, 0.0)
    target = [position[i] + forward[i] * 1000.0 for i in range(3)]
    out = args.out_dir / option["key"]
    subprocess.run(["python", str(HERE.parent / "run" / "render_sim.py"), str(args.video), str(args.wav), str(out),
                    "--range", str(args.at), str(args.at + 0.2), "--cams", "1", "--keep-frames",
                    "--cam1", *[str(v) for v in position], *[str(v) for v in target], str(option["mm35"])],
                   check=True, stdin=subprocess.DEVNULL)
    return out / "frames" / "Sim_Cam1" / "f.0003.png"


def draw_sheet(rows, shots, path):
    tile_w, tile_h, band = 1600, 900, 210
    font_big = ImageFont.truetype(FONT, 84)
    font_mid = ImageFont.truetype(FONT, 62)
    head = 1180
    sheet = Image.new("RGB", (tile_w, head + (tile_h + band) * len(rows)), (16, 16, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 10), "焦点距離の案(実写の代わりの CG)", fill=(255, 225, 150), font=font_big)
    draw.text((16, 120), "舞台の前の縁から何 m で入るか", fill=(255, 255, 255), font=font_mid)
    cols = [16, 330, 560, 790, 1020]
    y = 220
    for x, text in zip(cols, ["距離", "A", "B", "C", "30p の上限"]):
        draw.text((x, y), text, fill=(255, 225, 150), font=font_mid)
    y += 80
    for distance in DISTANCES_M[1:9]:
        draw.text((cols[0], y), f"{distance:g} m", fill=(255, 255, 255), font=font_mid)
        for x, row in zip(cols[1:4], rows):
            fits = row["fits"][str(distance)]
            draw.text((x, y), "○" if fits else "×", fill=(120, 240, 150) if fits else (255, 120, 120), font=font_mid)
        zoom = longest_zoom_30p(distance)
        draw.text((cols[4], y), f"{zoom:.0f}mm" if zoom >= ZOOM_WIDE_MM else "入らない", fill=(255, 255, 255), font=font_mid)
        y += 84
    draw.text((16, y + 8), "入る最短: " + " ".join(f"{r['key']} {r['min_distance_m']}m" for r in rows),
              fill=(255, 255, 255), font=font_mid)
    draw.text((16, y + 96), "A=30p×24mm B=30p×28mm C=24p×28mm", fill=(255, 225, 150), font=font_mid)
    for index, (row, shot) in enumerate(zip(rows, shots)):
        top = head + index * (tile_h + band)
        draw.text((16, top + 6), f"{row['key']} {row['name']} 実質{row['mm35']:g}mm", fill=(255, 255, 255), font=font_big)
        verdict = "入る" if row["fits"][str(SHOT_DISTANCE_M)] else "切れる"
        draw.text((16, top + 112), f"縁から {SHOT_DISTANCE_M:g}m・高さ 1.5m で {verdict}", fill=(255, 225, 150), font=font_mid)
        image = cv2.cvtColor(cv2.imread(str(shot)), cv2.COLOR_BGR2RGB)
        sheet.paste(Image.fromarray(cv2.resize(image, (tile_w, tile_h), interpolation=cv2.INTER_AREA)), (0, top + band))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, quality=90)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    parser.add_argument("--video", type=Path)
    parser.add_argument("--wav", type=Path)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--at", type=float, default=40.0)
    parser.add_argument("--no-render", action="store_true")
    args = parser.parse_args()
    rows = table()
    print(json.dumps(rows, ensure_ascii=False))
    print("30p のズームの上限(距離: mm):", {d: longest_zoom_30p(d) for d in DISTANCES_M})
    if args.no_render:
        return
    shots = [shoot(row, args) for row in rows]
    draw_sheet(rows, shots, args.out)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
