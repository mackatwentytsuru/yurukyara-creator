"""UE のキャラだけの通しの連番を、ブラウザ版の character_box.json と比べる。

使い方: python check_led_ue.py <連番のフォルダ> <character_box.json> [--every N]
足(枠の下)、身長(枠の高さ)、中心 x(枠の左右の真ん中)の差を、5680x1240 の座標で出す。
連番は 3838x1240 の正方形の画素なので、横は描いた幅で 5680 に戻す。
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

CANVAS_W = 5680
THRESHOLD = 128  # 白いキャラの半分の明るさ。縁の中間調の真ん中で切る


def measure(path):
    """白いキャラの枠 [x0, y0, x1, y1](ブラウザ版と同じく右と下は外側の端)。横は 5680 の座標。"""
    picture = np.asarray(Image.open(path).convert("L"))
    mask = picture >= THRESHOLD
    if not mask.any():
        return None
    xs, ys = np.where(mask.any(axis=0))[0], np.where(mask.any(axis=1))[0]
    to_canvas = CANVAS_W / picture.shape[1]
    return [xs[0] * to_canvas, int(ys[0]), (xs[-1] + 1) * to_canvas, int(ys[-1]) + 1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("boxes", type=Path)
    parser.add_argument("--every", type=int, default=1)
    parser.add_argument("--foot-shift", type=float, default=0.0, help="比べる元の足の高さとの差(古い版の 1212 と今の 1198 なら -14)")
    args = parser.parse_args()
    boxes = {row["frame"]: row for row in json.loads(args.boxes.read_text(encoding="utf-8"))["frames"]}
    files = sorted(args.frames.glob("f.*.png"), key=lambda p: int(re.search(r"f\.(\d+)", p.name).group(1)))[::args.every]
    rows, skipped = [], 0
    for path in files:
        frame = int(re.search(r"f\.(\d+)", path.name).group(1))
        ours = measure(path)
        theirs = boxes.get(frame, {}).get("box")
        if frame not in boxes:
            skipped += 1
            continue
        if theirs is not None:
            theirs = [theirs[0], theirs[1] + args.foot_shift, theirs[2], theirs[3] + args.foot_shift]
        if ours is None or theirs is None:
            rows.append({"frame": frame, "ue_seen": ours is not None, "browser_seen": theirs is not None})
            continue
        rows.append({"frame": frame, "foot": ours[3] - theirs[3], "height": (ours[3] - ours[1]) - (theirs[3] - theirs[1]),
                     "center_x": (ours[0] + ours[2]) / 2 - (theirs[0] + theirs[2]) / 2, "top": ours[1] - theirs[1],
                     "width": (ours[2] - ours[0]) - (theirs[2] - theirs[0]), "ue": [round(v, 1) for v in ours], "browser": theirs})
    both = [r for r in rows if "foot" in r]
    disagree = [r for r in rows if "foot" not in r and r["ue_seen"] != r["browser_seen"]]
    summary = {"frames": len(rows), "both_seen": len(both), "not_in_browser_box": skipped, "seen_disagree_count": len(disagree), "seen_disagree": [r["frame"] for r in disagree][:20]}
    for key in ("foot", "height", "center_x", "top", "width"):
        if both:
            values = np.array([r[key] for r in both])
            summary[key] = {"mean": round(float(values.mean()), 2), "abs_max": round(float(np.abs(values).max()), 2)}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    for r in both[:: max(1, len(both) // 6)]:
        print({k: (round(float(v), 2) if isinstance(v, (int, float)) or hasattr(v, "item") else v) for k, v in r.items()})


if __name__ == "__main__":
    main()
