"""レンズの校正の試し: 点の格子の絵を LED に出し、UE で撮って既知の歪みをかけ、「写真」を作る。

使い方: python make_calib_trial.py <出力フォルダ> <正解のレンズ json> [--dots 点の位置 json と絵が無いときに作る]
出力: dots.json、led_dots.mp4、poses.json(UE に渡す)。--apply で撮った連番に歪みをかけて photos/ と board_video.mp4 にする。
試し専用。本物のレンズの校正は place/shootlog/lens_calib.py を使う。
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "ue")]

from lens import apply_st, load_lens, required_overscan, st_map, ue_camera, undistort_normalized  # noqa: E402
from ue_axes import axes_to_rotator  # noqa: E402

CANVAS_W, CANVAS_H = 5680, 1240
FACES = {
    # 面: 絵の x の範囲(中央の面と重ならない所)、cm/画素、面の中心の UE の位置、絵の左端の UE の x
    "A": {"px": (40, 917), "cm_per_px": 512.0 / 1279.0, "center": (-540.0, 0.0, 346.0)},
    "C": {"px": (3385, 4249), "cm_per_px": 1056.0 / 2641.0, "center": (560.0, 0.0, 346.0)},
}
ROW_RANGE = (40, 1200)
COLS, ROWS = 13, 16
DOT_RADIUS_PX = 12
BIG_RADIUS_PX = 22
MARKS = {"A": [[6, 7], [8, 7], [6, 8]], "C": [[6, 7], [7, 7], [6, 9]]}  # 真ん中に置く。端だと画面から切れる
VIEWS = [("A", -20, 12, 620, 0), ("A", 20, 12, 620, -80), ("A", -20, -8, 620, 60), ("A", 22, -9, 620, 40),
         ("C", -20, 12, 620, 80), ("C", 20, 12, 620, -60), ("C", -22, -8, 620, 0), ("C", 20, -9, 620, 40)]
CAMERA_Z = 170.0
BLUR_SIGMA = 1.0
NOISE_SIGMA = 2.0
SEED = 5
MEDIA_SECONDS = 2


def make_dots(out):
    spec = {"faces": {}}
    image = Image.new("L", (CANVAS_W, CANVAS_H), 0)
    draw = ImageDraw.Draw(image)
    for face, info in FACES.items():
        x0, x1 = info["px"]
        points = []
        for row in range(ROWS):
            for col in range(COLS):
                x = x0 + (x1 - x0) * col / (COLS - 1)
                y = ROW_RANGE[0] + (ROW_RANGE[1] - ROW_RANGE[0]) * row / (ROWS - 1)
                radius = BIG_RADIUS_PX if [col, row] in MARKS[face] else DOT_RADIUS_PX
                draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
                points.append([col, row, x * info["cm_per_px"], y * 0.4, x, y])
        spec["faces"][face] = {"cols": COLS, "rows": ROWS, "marks": MARKS[face], "points": points}
    (out / "dots.json").write_text(json.dumps(spec), encoding="utf-8")
    small = image.resize((2840, 620), Image.LANCZOS)
    raw = np.asarray(small.convert("RGB")).tobytes()
    process = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2840x620",
                                "-r", "30", "-i", "-", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "12", "-bf", "0",
                                "-g", "30", "-an", str(out / "led_dots.mp4")], stdin=subprocess.PIPE)
    for _ in range(30 * MEDIA_SECONDS):
        process.stdin.write(raw)
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("点の映像を書けない")


def board_media(out, board_png):
    """盤の絵(5680x1240)を LED の映像にする。"""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", str(MEDIA_SECONDS), "-r", "30", "-i", str(board_png),
                    "-vf", "scale=2840:620:flags=area,format=yuv420p", "-c:v", "libx264", "-crf", "12", "-bf", "0", "-g", "30",
                    "-an", str(out / "led_dots.mp4")], check=True, stdin=subprocess.DEVNULL)


def pose_rows(lens, views=None):
    rows = []
    focal = lens["K"][0] * 36.0 / lens["width"]
    for index, (face, yaw_shift, pitch_shift, y_cam, x_shift) in enumerate(views or VIEWS):
        target = np.array(FACES[face]["center"], dtype=float)
        position = np.array([target[0] + x_shift, y_cam, CAMERA_Z])
        aim = target - position
        aim /= np.linalg.norm(aim)
        pitch = float(np.degrees(np.arcsin(aim[2]))) + pitch_shift
        yaw = float(np.degrees(np.arctan2(aim[1], aim[0]))) + yaw_shift
        rows.append({"f": index, "x": float(position[0]), "y": float(position[1]), "z": float(position[2]),
                     "pitch": pitch, "yaw": yaw, "roll": float(2.0 * (index % 3 - 1)), "focal": focal})
    return rows


def prepare(out, lens_path, board_png=None):
    out.mkdir(parents=True, exist_ok=True)
    if board_png:
        board_media(out, board_png)
    else:
        make_dots(out)
    lens = load_lens(lens_path)
    needed = required_overscan(undistort_normalized(lens), lens)
    camera = ue_camera(lens, needed * 1.02)
    views = [("A", yaw, pitch, depth, shift) for depth, shift in ((520, 0), (620, -60), (760, 60))
             for yaw, pitch in ((-22, 12), (22, 12), (-22, -8), (22, -8), (0, 0))] if board_png else None
    config = {"rows": pose_rows(lens, views), "sensor_mm": [camera["sensor_w_mm"], camera["sensor_h_mm"]],
              "resolution": [camera["render_w"], camera["render_h"]], "media": (out / "led_dots.mp4").resolve().as_posix(),
              "frames_dir": (out / "frames").resolve().as_posix(), "camera": camera}
    (out / "poses.json").write_text(json.dumps(config, indent=1), encoding="utf-8")
    print("overscan", round(camera["overscan"], 4), camera["render_w"], camera["render_h"])


def apply_truth(out, lens_path):
    lens = load_lens(lens_path)
    config = json.loads((out / "poses.json").read_text(encoding="utf-8"))
    table = st_map(lens, config["camera"])
    photos = out / "photos"
    photos.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    for path in sorted((out / "frames" / "Calib_Trial").glob("f.*.png")):
        image = cv2.GaussianBlur(apply_st(cv2.imread(str(path)), table), (0, 0), BLUR_SIGMA).astype(np.float32)
        noisy = image + rng.normal(0, NOISE_SIGMA, (*image.shape[:2], 1)).astype(np.float32)
        cv2.imwrite(str(photos / path.name.replace("f.", "photo_")), noisy.clip(0, 255).astype(np.uint8))
    print("wrote", photos)


def photos_to_video(out):
    """写真を 1 本の動画にする(校正の道具は動画を読む)。"""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "10", "-i", str(out / "photos" / "photo_%04d.png"),
                    "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", str(out / "board_video.mp4")],
                   check=True, stdin=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    parser.add_argument("lens", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--board", type=Path, help="点の格子の代わりに、この盤の絵を映す(5680x1240)")
    args = parser.parse_args()
    if args.apply:
        apply_truth(args.out, args.lens)
        photos_to_video(args.out)
    else:
        prepare(args.out, args.lens, args.board)


if __name__ == "__main__":
    main()
