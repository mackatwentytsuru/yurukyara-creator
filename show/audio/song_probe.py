"""a1 の 3 本の f0(基本周波数)を測る。pyworld。"""
import sys, subprocess, tempfile, os
import numpy as np, soundfile as sf, pyworld as pw

FS = 44100


def load(path):
    tmp = os.path.join(tempfile.gettempdir(), "probe_tmp.wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-ac", "1", "-ar", str(FS), tmp], check=True)
    x, _ = sf.read(tmp)
    return x.astype(np.float64)


def f0_of(x):
    f0, t = pw.harvest(x, FS, f0_floor=80, f0_ceil=800, frame_period=5.0)
    return pw.stonemask(x, f0, t, FS), t


def phrases(f0, gap_frames=24, min_frames=20):
    v = f0 > 0
    runs, start, last = [], None, None
    for i, a in enumerate(v):
        if a:
            if start is None:
                start = i
            elif i - last > gap_frames:
                runs.append((start, last)); start = i
            last = i
    if start is not None:
        runs.append((start, last))
    return [(s, e) for s, e in runs if e - s >= min_frames]


if __name__ == "__main__":
    for p in sys.argv[1:]:
        x = load(p)
        f0, t = f0_of(x)
        v = f0[f0 > 0]
        ph = phrases(f0)
        midi = 69 + 12 * np.log2(v / 440)
        print(os.path.basename(p), f"dur={len(x)/FS:.2f}s voiced={len(v)*0.005:.2f}s",
              f"f0 {v.min():.0f}-{v.max():.0f}Hz median {np.median(v):.0f}Hz",
              f"midi std={midi.std():.2f} phrases={len(ph)}",
              [(round(s*0.005, 2), round(e*0.005, 2)) for s, e in ph])
