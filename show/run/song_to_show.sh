#!/usr/bin/env bash
# 曲を替えるときの 1 行: 音 → 歌詞の秒 → 口 → 動きと舞台の予定 → UE のキャラ → LED の全編。
# 使い方: song_to_show.sh <曲の wav> <歌詞の元.json> <せりふの文> <答えの json> <会場の絵 png> <版の名前> [長さの秒]
#   途中まで: STOP_AFTER=plan(動きと予定まで)か STOP_AFTER=ue(UE のキャラまで)。全編を描かずに確かめるとき
# 環境変数: VRM、CLIPS、WORK、PY_AUDIO(demucs の入った python)、PY_WHISPER(faster-whisper の入った python)
set -eu
SONG="$1"; LYRICS_SOURCE="$2"; LINE_TEXT="$3"; ANSWER="$4"; PLATE="$5"; VERSION="$6"; SONG_LEN="${7:-43.4}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SHOW="$(cd "$HERE/.." && pwd -W)"
ROOT="${SHOW_BUILD_ROOT:-work/ue_show/show_build}"
OUT="$ROOT/$VERSION/audio"
JOB="$WORK/$VERSION"
LOCK_TOOL="machine_lock.py"
WHO="ハッカソン|キャラクターショー"
mkdir -p "$OUT" "$JOB"

echo "== 台本"
python - "$SHOW/show_script.json" "$JOB/script.json" "$LINE_TEXT" "$SONG_LEN" <<'PY'
import json, sys
script = json.load(open(sys.argv[1], encoding="utf-8"))
script["line"] = sys.argv[3]
script["song"]["len_sec"] = float(sys.argv[4])
json.dump(script, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY

echo "== 音"
python "$LOCK_TOOL" run --machine pc1 --kind gpu --who "$WHO" --job "音 $VERSION s:2bfec9e0" --minutes 6 --wait 20 -- "$PY_AUDIO" "$SHOW/audio/make_show_audio.py" --script "$JOB/script.json" --song "$SONG" --answer-file "$ANSWER" --cache-dir "$ROOT/tts_cache" --ledger "${TTS_LEDGER:-}" --out "$OUT"
SONG_START="$(python -c "import json,sys;print(next(s['start'] for s in json.load(open(sys.argv[1]))['sections'] if s['id']=='song'))" "$OUT/timeline.json")"

echo "== 歌詞の秒"
python "$LOCK_TOOL" run --machine pc1 --kind gpu --who "$WHO" --job "書き起こし $VERSION s:2bfec9e0" --minutes 6 --wait 20 -- "$PY_WHISPER" "$SHOW/audio/measure_lyrics.py" --out "$JOB/words.json" "song=$OUT/work/song_segment.wav@0"
python "$SHOW/audio/make_lyrics_times.py" --source "$LYRICS_SOURCE" --words "$JOB/words.json" --name song --out "$JOB/lyrics.json"

echo "== 口"
python "$SHOW/audio/make_sing_curves.py" --lyrics "$JOB/lyrics.json" --vocals "$OUT/vocals.wav" --timeline "$OUT/timeline.json" --song-start "$SONG_START" --out "$JOB/sing.json"

echo "== 動きと舞台の予定"
python "$SHOW/motion/make_show_plan.py" --timeline "$OUT/timeline.json" --lyrics "$JOB/lyrics.json" --song-start "$SONG_START" --base-stage "$SHOW/show_stage.json" --out-plan "$JOB/plan.json" --out-stage "$JOB/stage.json"
cp -f "$JOB/stage.json" "$SHOW/show_stage.json"
[ "${STOP_AFTER:-}" = "plan" ] && exit 0

echo "== UE のキャラ"
TIMELINE="$OUT/timeline.json" SING="$JOB/sing.json" WORK="$JOB" bash "$SHOW/run/sample_into_ue.sh" "$JOB/plan.json" sample_show
[ "${STOP_AFTER:-}" = "ue" ] && exit 0

echo "== LED の全編"
SHOW_CALIB_VIDEO="${SHOW_CALIB_VIDEO:-work/キャラクターショー/本番_1103/LEDに出す物/LED校正の頭_5680x1240.mov}" SHOW_WHO="$WHO" SHOW_DANCE_TRACK="$JOB/track_sample_show" SHOW_PLATE="$PLATE" bash "$SHOW/run/build_vrm_show.sh" "$VRM" "$VERSION" "$VERSION"
echo "できた: $VERSION"
