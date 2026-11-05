"""sync_pair.py の確かめ(合成): 同じ明るさの出来事(フラッシュ・暗転・フラッシュ)を、B が 1.37 秒遅れ(B は 24 fps、時刻は不ぞろい)で写した 2 本から、ずれを取り戻せるか。"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_pair  # noqa: E402

FF = "ffmpeg"


def level(x):
    """時刻 x での LED の明るさ(フラッシュ 3.0 秒・暗転 6.0 秒・フラッシュ 9.0 秒)。"""
    if 3.0 <= x < 3.4:
        return 200
    if 6.0 <= x < 6.3:
        return 2
    if 9.0 <= x < 9.5:
        return 200
    return 40


def make(folder: Path, fps: float, shift: float, jitter: float, seed: int):
    rng = np.random.default_rng(seed)
    count = int(14 * fps)
    t = np.arange(count) / fps + rng.uniform(-jitter, jitter, count)
    frames = np.stack([np.full((72, 128), level(v - shift) + rng.normal(0, 1.5), np.float32) for v in t]).clip(0, 255).astype(np.uint8)
    folder.mkdir(parents=True, exist_ok=True)
    p = subprocess.Popen([FF, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "128x72", "-r", str(fps), "-i", "-",
                          "-c:v", "libx264", "-pix_fmt", "yuv420p", str(folder / "video.mp4")], stdin=subprocess.PIPE)
    p.communicate(frames.tobytes())
    (folder / "frames.jsonl").write_text("\n".join(json.dumps({"i": i, "pts": float(v)}) for i, v in enumerate(t)), encoding="utf-8")


def main():
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / "a", Path(d) / "b"
        make(a, 30.0, 0.0, 0.002, 1)
        make(b, 24.0, 1.37, 0.004, 2)
        ev_a = sync_pair.events(a / "video.mp4", sync_pair.load_pts(a), FF)
        ev_b = sync_pair.events(b / "video.mp4", sync_pair.load_pts(b), FF)
        r = sync_pair.best_offset(ev_a, ev_b)
        print("A の出来事", [(round(t, 2), s) for t, s in ev_a], " B の出来事", [(round(t, 2), s) for t, s in ev_b])
        print("結果:", r)
        ok = r is not None and abs(r["offset_sec"] - 1.37) <= 0.1 and r["matched"] >= 5
        print("合格" if ok else "不合格", f"(正解 1.37 秒、誤差 {abs(r['offset_sec'] - 1.37):.3f} 秒)" if r else "")
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
