"""拍の位置で曲を切りつなぎ、頭が曲の頭の wav を作る(短い等電力クロスフェード)。
  search: 区間 [x_lo, x_hi] の拍 X から、小節の整数倍(1 小節 = 4 拍)あとの Y へ飛ぶ案を、つなぎ目の前後の
          音の高さの構成の類似・音量差・歌声の谷で採点して上位を出す(低いほどよい)。
  make:   --x X --y Y --end E で [0,X] + [Y,E] をつなぎ、--out に書く。Y-X は小節の整数倍にして、拍と小節の位置を保つ。
使い方:
  python cut_song.py search --src 曲.wav --stems <vocals.wav> --beat T0 --bpm B --x-lo 9 --x-hi 22 --end 43.4 --bars 4 5 6
  python cut_song.py make   --src 曲.wav --x 15.0 --y 23.0 --end 43.4 --out cut.wav [--fade 0.12]
"""
import argparse
import numpy as np, soundfile as sf, librosa

WIN = 0.4


def chroma_vec(x, sr):
    c = librosa.feature.chroma_stft(y=x, sr=sr, n_fft=4096, hop_length=1024).mean(axis=1)
    return c / (np.linalg.norm(c) + 1e-9)


def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)


def search(a):
    x, sr = sf.read(a.src, dtype="float32")
    xm = x.mean(axis=1) if x.ndim > 1 else x
    v, vsr = sf.read(a.stems, dtype="float32")
    vm = v.mean(axis=1)
    ref = np.percentile(np.abs(vm), 95)
    period = 60.0 / a.bpm
    beats = a.beat + period * np.arange(int((a.end - a.beat) / period))
    rows = []
    for X in beats[(beats >= a.x_lo) & (beats <= a.x_hi)]:
        for bars in a.bars:
            Y = X + bars * 4 * period
            if Y > a.chorus_start:
                continue
            A = xm[int((X - WIN) * sr):int(X * sr)]
            B = xm[int(Y * sr):int((Y + WIN) * sr)]
            cc = float(chroma_vec(A, sr) @ chroma_vec(B, sr))
            dd = abs(rms_db(A) - rms_db(B))

            def vdb(t):
                s = vm[int((t - 0.04) * vsr):int((t + 0.04) * vsr)]
                return 20 * np.log10(np.sqrt((s ** 2).mean()) / ref + 1e-9)
            vx, vy = vdb(X), vdb(Y)
            cost = (1 - cc) * 5 + dd / 3 + (max(vx, -30) + 30) / 15 + (max(vy, -30) + 30) / 15
            rows.append((round(cost, 3), round(float(X), 2), round(float(Y), 2), bars, round(cc, 3), round(dd, 1),
                         round(vx, 1), round(vy, 1), round(a.end - (Y - X), 2)))
    rows.sort()
    print("cost X Y bars chroma_cos dB_diff vocal_dB_at_X vocal_dB_at_Y total_len")
    for r in rows[:12]:
        print(*r)


def make(a):
    x, sr = sf.read(a.src, dtype="float32", always_2d=True)
    n = int(round(a.fade * sr))
    X, Y, E = (int(round(t * sr)) for t in (a.x, a.y, a.end))
    t = np.linspace(0, np.pi / 2, n)[:, None]
    mid = x[X - n:X] * np.cos(t) + x[Y - n:Y] * np.sin(t)
    out = np.concatenate([x[:X - n], mid, x[Y:E]])
    sf.write(a.out, out, sr, subtype="PCM_16")
    print("wrote", a.out, "len_sec", round(len(out) / sr, 3))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["search", "make"])
    ap.add_argument("--src", required=True)
    ap.add_argument("--stems")
    ap.add_argument("--beat", type=float, default=0.0)
    ap.add_argument("--bpm", type=float)
    ap.add_argument("--x-lo", type=float)
    ap.add_argument("--x-hi", type=float)
    ap.add_argument("--chorus-start", type=float, default=1e9)
    ap.add_argument("--bars", type=int, nargs="+", default=[4, 5, 6])
    ap.add_argument("--x", type=float)
    ap.add_argument("--y", type=float)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--out")
    ap.add_argument("--fade", type=float, default=0.12)
    a = ap.parse_args()
    {"search": search, "make": make}[a.mode](a)


if __name__ == "__main__":
    main()
