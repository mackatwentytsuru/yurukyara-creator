"""mix_final.py の試験。素材は中で作る(音源・動画をリポジトリに入れない)。
元の音(既定は ue_show の show_mix.wav。無ければ合成の音)を遅らせ、残響と雑音を足し、0.1% 伸ばした偽の実写音で、ずれの実測の誤差を見る。
使い方: python -X utf8 test_mix_final.py [show_mix.wav]
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

sys.path.insert(0, str(Path(__file__).parent))
import mix_final as mf

MUSIC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"work\ue_show\show_build\mc_try\audio\show_mix.wav")
TOL = 0.010
RNG = np.random.default_rng(7)


def synth_music(seconds=130):
    """音源が無いときの代わり: 拍と音程のある、くり返さない音。"""
    t = np.arange(int(seconds * mf.SR)) / mf.SR
    f0 = 220 * 2 ** (RNG.integers(0, 12, int(seconds * 4)) / 12)
    phase = np.cumsum(np.repeat(f0, mf.SR // 4)[:t.size]) * 2 * np.pi / mf.SR
    x = 0.3 * np.sin(phase) * (0.5 + 0.5 * np.sin(2 * np.pi * 2 * t) ** 2) + 0.05 * RNG.standard_normal(t.size)
    return np.stack([x, x]).astype(np.float32)


def load_music():
    return mf.decode(MUSIC) if MUSIC.exists() else synth_music()


def room_ir(rt60=0.7, length=1.0):
    n = int(length * mf.SR)
    t = np.arange(n) / mf.SR
    tail = RNG.standard_normal(n) * 10 ** (-3 * t / rt60)  # 60 dB 落ちるのが rt60 秒
    tail[:int(0.01 * mf.SR)] = 0  # 直接音のすぐ後の 10 ms は空ける
    tail *= np.sqrt(1.5 / (tail ** 2).sum())  # 残響のエネルギー = 直接音の 1.5 倍(直接音と残響の比 -1.8 dB)
    tail[0] = 1.0  # 直接音
    return tail


def fake_live(music, start, delay, stretch, seconds, wet=1.0, snr_db=8.0):
    """live(t) = music(start - delay + t / stretch) に残響と雑音。stretch = 1.001 なら実写は 0.1% 長い。"""
    t = np.arange(int(seconds * mf.SR)) / mf.SR
    dry = mf.sample_at(music, start - delay + t / stretch)
    out = []
    for ch in dry:
        wetch = fftconvolve(ch, room_ir())[:ch.size]
        sig = ch + wet * wetch
        noise = RNG.standard_normal(sig.size)
        noise = np.convolve(noise, np.ones(8) / 8, mode="same")  # 低めに偏らせた雑音
        out.append(sig + noise * mf.rms(sig) * 10 ** (-snr_db / 20) / mf.rms(noise))
    return np.stack(out).astype(np.float32)


def check_estimate(music, start, delay, stretch, seconds):
    live = fake_live(music, start, delay, stretch, seconds)
    est = mf.measure_offset(live, music, start + 0.4, search=3.0, log=lambda *_: None)  # 開始秒の見込みも 0.4 秒ずらしておく
    a_true, b_true = start - delay, 1 / stretch
    worst = 0.0
    for t in np.linspace(0, seconds, 9):
        worst = max(worst, abs((est["a"] + est["b"] * t) - (a_true + b_true * t)))
    print(f"  ずれ {delay:+.3f}s・伸び {100 * (stretch - 1):.2f}%・{seconds:.0f}秒: 推定 a={est['a']:.4f}(正解 {a_true:.4f}) "
          f"b={est['b']:.6f}(正解 {b_true:.6f}) 全体の最悪誤差 {worst * 1000:.2f} ms 補正={est['stretch_applied']}")
    assert worst <= TOL, f"誤差 {worst * 1000:.1f} ms が 10 ms を超えた"
    return est


def test_offset_and_stretch():
    music = load_music()
    check_estimate(music, 42.0, 1.234, 1.001, 40)
    check_estimate(music, 44.0, -0.8, 1.001, 38)  # 実写の音が先に鳴る向き
    check_estimate(music, 60.0, 1.234, 1.0, 12)  # 伸びなし・短い


def test_align_puts_music_on_the_video_timeline():
    """混ぜる前に並べた実写の音と元の音が、同じ時間で重なる(相互相関の山がほぼ 0)。"""
    music = load_music()
    start, delay, stretch, dur = 45.0, 1.234, 1.001, 30.0
    live = fake_live(music, start, delay, stretch, dur + 4)
    est = mf.measure_offset(live, music, start, log=lambda *_: None)
    live_a, music_a = mf.align(live, music, start, est["a"], est["b"], dur)
    x, y = mf.to_mono16(live_a), mf.to_mono16(music_a)
    for t in (3.0, dur / 2, dur - 3.0):  # 頭・真ん中・終わり
        m, z = mf.match_window(x, y, t, 4.0, t, 0.5)
        print(f"  並べた後 {t:5.1f} 秒のずれ {1000 * (m - t):+.2f} ms(z={z:.0f})")
        assert abs(m - t) <= TOL


def test_full_run_keeps_frames_and_loudness():
    """10 秒の映像(lavfi)で通す。コマ数・長さが同じ、約 -14 LUFS、ピーク -1 dBFS 以下、メタデータが無い。"""
    music = load_music()
    start, delay, stretch = 60.0, 1.234, 1.001
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        live = fake_live(music, start, delay, stretch, 10.0)
        wav = tmp / "live.wav"
        mf.write_wav_f32(wav, live)
        mus = tmp / "music.wav"
        mf.write_wav_f32(mus, music)
        vid = tmp / "v.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30000/1001:duration=10",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-metadata", "title=secret", "-y", str(vid)], check=True)
        frames_in, fps_in, dur_in = mf.probe_video(vid)
        out = tmp / "o.mp4"
        res = mf.build(vid, wav, mus, out, start, log=print)
        frames_out, fps_out, dur_out = mf.probe_video(out)
        info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,pix_fmt,bit_rate:format_tags",
                               "-of", "default=nw=1", str(out)], capture_output=True, text=True).stdout
        print(info.replace("\n", " "))
        assert (frames_out, fps_out) == (frames_in, fps_in), (frames_out, frames_in)
        assert abs(res["lufs"] - mf.TARGET_LUFS) <= 1.0, res["lufs"]
        assert res["peak_dbfs"] <= mf.TARGET_TP, res["peak_dbfs"]
        assert "secret" not in info and "title" not in info.lower() and "Lavf" not in info
        assert "codec_name=aac" in info and "pix_fmt=yuv420p" in info and "codec_name=h264" in info
        head = out.read_bytes()[:64]
        # faststart: moov が mdat より前
        raw = out.read_bytes()
        assert raw.find(b"moov") < raw.find(b"mdat")
        assert abs(res["estimate"]["a"] - (start - delay)) <= TOL


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        print(t.__name__)
        t()
    print(f"{len(tests)} 件合格")
