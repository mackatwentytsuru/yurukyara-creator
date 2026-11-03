#!/bin/zsh
# 受けた記録を、合成に渡せる形(frames.jsonl・video.mp4・audio.wav・meta.json)に直す。ダブルクリックで動く。
export PATH=/opt/homebrew/bin:$PATH
OUT=$(cat "$HOME/sample_work/last_take.txt" 2>/dev/null)
read -r "?直す記録のフォルダ(Enter で最後のテイク: $OUT): " X
[ -n "$X" ] && OUT="$X"
if [ ! -f "$OUT/index.jsonl" ]; then echo "記録が見つかりません: $OUT"; read -r "?Enter で閉じる"; exit 1; fi
python3 "$HOME/sample_work/rx/pc_to_frames.py" --rx "$OUT" --out "$OUT/撮影記録の形"
echo ""
echo "できた物: $OUT/撮影記録の形/(frames.jsonl・video.mp4・audio.wav・meta.json)"
read -r "?Enter で閉じる"
