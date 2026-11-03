#!/bin/zsh
# iPad「撮影記録」の中の超広角の録画を、SSD へ写す。iPad を USB でこの Mac につないで、ダブルクリック。iPad の中のファイルは消さない。
export PATH=/opt/homebrew/bin:$PATH
DEV=00008103-001959392279001E
SSD="/Volumes/tsuru backu"
if [ -d "$SSD" ]; then BASE="$SSD/サンプル会場_撮影_1103/超広角"; else BASE="$HOME/sample_work/超広角"; fi
OUT="$BASE/$(date +%m%d_%H%M%S)"
mkdir -p "$OUT"
echo "写しています: $OUT"
xcrun devicectl device copy from --device "$DEV" --domain-type appDataContainer --domain-identifier dev.hackathon.shootlog --source Documents/ultrawide --destination "$OUT" 2>&1 | tail -2
ls -la "$OUT"
read -r "?Enter で閉じる"
