#!/bin/zsh
# 受けた記録を、合成に渡せる形(frames.jsonl・video.mp4・audio.wav・meta.json)に直す。ダブルクリックで動く。
export PATH=/opt/homebrew/bin:$PATH
OUT=$(cat "$HOME/sample_work/last_take.txt" 2>/dev/null)
read -r "?直す記録のフォルダ(Enter で最後のテイク: $OUT): " X
[ -n "$X" ] && OUT="$X"
found=0
for T in "$OUT"/take_* "$OUT"; do
  [ -f "$T/index.jsonl" ] || continue
  [ -s "$T/index.jsonl" ] || continue
  [ -d "$T/撮影記録の形" ] && continue
  LOG=$(python3 "$HOME/sample_work/rx/pc_to_frames.py" --rx "$T" --out "$T/撮影記録の形" 2>&1)
  echo "$LOG"
  echo "できた物: $T/撮影記録の形/(frames.jsonl・video.mp4・audio.wav・meta.json、校正が使えれば alignment_A/B/C.json)"
  # 校正の結果の 1 行(点の数・残差。使えないときは理由)。rx に dots_align.py と stage_layout.py も置いておく
  echo "  $(echo "$LOG" | grep '^校正' | tail -1)"
  found=1
done
if [ "$found" = 0 ]; then echo "直す記録が見つかりません(全部直してあるか、記録がありません): $OUT"; fi
read -r "?Enter で閉じる"
