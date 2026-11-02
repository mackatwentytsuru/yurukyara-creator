"""撮った絵を数字で確かめる。カメラの式で LED の面が写る範囲を出し、明るさと継ぎ目を測る。

使い方: python measure_cuts.py  (work/ue_show/render の各カットの最後の絵を読む)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ue"))
from stage_layout import CAMERAS, LED_Z_BOTTOM, LED_Z_TOP, led_plates  # noqa: E402

RENDER = Path("work/ue_show/render")
ART_ASPECT = round(1412 / 1.48 / 1035, 3)  # 元の絵の縦横(絵に置いた 1412x1035 から伸ばした 1.48 倍を戻す)
W, H = 1920, 1080
SENSOR_W = 23.76
CUT_CAMERA = {"Cut1_StandWide": "wide", "Cut2_StandClose": "close", "Cut3_LedCharacter": "wide",
              "Cut4_DoorOpen": "wide", "Check_Grid": "wide"}
FACE_PREFIX = {"A": "LED_A", "B": "LED_B", "C": "LED_C"}


def project(camera, point):
    pos = np.array(camera["pos"], float)
    forward = np.array(camera["target"], float) - pos
    forward /= np.linalg.norm(forward)
    right = np.cross((0.0, 0.0, 1.0), forward)
    right /= np.linalg.norm(right)
    up = np.cross(forward, right)
    d = np.array(point, float) - pos
    depth = d @ forward
    k = camera["focal"] / (SENSOR_W / 2) * (W / 2)
    return (W / 2 + k * (d @ right) / depth, H / 2 - k * (d @ up) / depth)


def face_mask(camera, plates):
    image = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(image)
    for p in plates:
        (x0, y0), (x1, y1) = p["start"], p["end"]
        corners = [(x0, y0, LED_Z_BOTTOM), (x1, y1, LED_Z_BOTTOM), (x1, y1, LED_Z_TOP), (x0, y0, LED_Z_TOP)]
        draw.polygon([project(camera, c) for c in corners], fill=255)
    return np.array(image) > 0


def latest_frame(cut):
    frames = sorted((RENDER / cut).glob("*.png"))
    return frames[-1] if frames else None


def measure_face(rgb, mask):
    pixels = rgb[mask]
    return {
        "mean": round(float(pixels.mean()), 1),
        "saturated_pct": round(float((pixels.max(axis=1) == 255).mean() * 100), 2),
        "white_pct": round(float((pixels.min(axis=1) >= 250).mean() * 100), 2),
        "black_pct": round(float((pixels.max(axis=1) <= 8).mean() * 100), 2),
    }


def red_columns(rgb, row, x_from, x_to):
    """row の行で、赤い線の x を探す。"""
    line = rgb[row, x_from:x_to].astype(int)
    hit = np.where((line[:, 0] > 110) & (line[:, 1] < 70) & (line[:, 2] < 70))[0]
    return None if hit.size == 0 else float(hit.mean() + x_from)


def check_seams(rgb, camera):
    """絵の x=1279(A の右端)と x=3039(C の左端)の赤線が、面の端に来ているか。"""
    z = 450.0
    results = {}
    for label, edge in (("A right edge x=1279", (-237.7, 0.0, z)), ("C left edge x=3039", (236.7, 0.0, z))):
        px, py = project(camera, edge)
        found = red_columns(rgb, int(py), int(px) - 25, int(px) + 25)
        results[label] = {"expected_px": round(px, 1), "found_px": found}
    return results


def changed_box(rgb_a, rgb_b, threshold=45):
    """2 枚で大きく変わった所の範囲(周りの小さな差は数えない)。"""
    from scipy import ndimage

    diff = np.abs(rgb_a.astype(int) - rgb_b.astype(int)).max(axis=2) > threshold
    labels, count = ndimage.label(diff)
    if count == 0:
        return None
    sizes = ndimage.sum_labels(np.ones_like(labels), labels, range(1, count + 1))
    ys, xs = np.where(labels == int(np.argmax(sizes)) + 1)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def load(cut):
    return np.array(Image.open(latest_frame(cut)).convert("RGB"))


def measure_characters():
    """③の絵のキャラの縦横、①の立体のキャラの足元を測る。"""
    if latest_frame("Check_Background") is not None:
        box = changed_box(load("Cut3_LedCharacter"), load("Check_Background"))
        if box:
            w, h = box[2] - box[0], box[3] - box[1]
            print("Cut3 picture character box", box, "w/h", round(w / h, 3),
                  "source art w/h", ART_ASPECT)
    if latest_frame("Check_NoCharacter") is not None:
        box = changed_box(load("Cut1_StandWide"), load("Check_NoCharacter"))
        camera = CAMERAS["wide"]
        foot = project(camera, (0, 180, 90))
        head = project(camera, (0, 180, 250))
        print("Cut1 stage character box", box, "expected foot y", round(foot[1]), "head y", round(head[1]))


def main():
    plates, _ = led_plates()
    for cut, cam_name in CUT_CAMERA.items():
        frame = latest_frame(cut)
        if frame is None:
            print(cut, "no frame")
            continue
        rgb = np.array(Image.open(frame).convert("RGB"))
        camera = CAMERAS[cam_name]
        print(cut, frame.name, rgb.shape)
        for face, prefix in FACE_PREFIX.items():
            mask = face_mask(camera, [p for p in plates if p["name"].startswith(prefix)])
            print("  ", face, measure_face(rgb, mask))
        if cut == "Check_Grid":
            print("   seams", check_seams(rgb, camera))
        for name in ("A", "C"):
            points = [p for p in plates if p["name"].startswith(FACE_PREFIX[name])]
            ends = [project(camera, (*points[0]["start"], 346)), project(camera, (*points[-1]["end"], 346))]
            print("   face", name, "screen x", [round(e[0]) for e in ends])
    measure_characters()


if __name__ == "__main__":
    main()
