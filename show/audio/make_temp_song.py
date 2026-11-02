"""仮の曲を 1 本の wav にする(声と伴奏が混ざった物。本物の曲と同じ形の入力)。
伴奏は song_make.backing を 16 小節(BPM 140、64 拍 = 約 27.4 秒)に伸ばし、
音程補正した声(song_make.pitch_correct、5 フレーズ)を 2 回重ねる。
使い方: python make_temp_song.py --voice-src <読み上げの声(mp3/wav)> --out <出力.wav>
  声の元は環境変数 SHOW_TEMP_VOICE_SRC でも渡せる。API は呼ばない。
"""
import argparse, os, sys
import numpy as np, soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import song_make as sm

NBARS = 16
# 声の 5 フレーズ(5 小節ぶん)を置く小節。0〜3 小節目は静かな前奏の代わりの伴奏だけ(せりふを乗せる)。
VOICE_BARS = (4, 11)
VOICE_GAIN, BACKING_GAIN = 0.8, 0.4


def make(voice_src):
    bk = sm.backing(NBARS)
    y, _info, _ = sm.pitch_correct(voice_src)
    y = y / np.max(np.abs(y))
    voice = np.zeros_like(bk)
    for bar in VOICE_BARS:
        sm.add(voice, bar * 4 * sm.BEAT, y)
    mix = voice * VOICE_GAIN + bk / np.max(np.abs(bk)) * BACKING_GAIN
    k = 10 ** (-1.0 / 20) / np.max(np.abs(mix))
    return mix * k, voice * VOICE_GAIN * k  # (混ぜた物, 声だけ=測定の正解用)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--voice-src", default=os.environ.get("SHOW_TEMP_VOICE_SRC"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if not a.voice_src:
        sys.exit("声の元がない: --voice-src か環境変数 SHOW_TEMP_VOICE_SRC を指定する")
    mix, voice = make(a.voice_src)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    sf.write(a.out, np.column_stack([mix, mix]), sm.FS, subtype="PCM_24")
    stem = os.path.splitext(a.out)[0] + '_voice_truth.wav'
    sf.write(stem, np.column_stack([voice, voice]), sm.FS, subtype="PCM_24")
    print(f"ok {a.out} {len(mix) / sm.FS:.2f}s bpm={sm.BPM}")


if __name__ == "__main__":
    main()
