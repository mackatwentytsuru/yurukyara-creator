#!/bin/zsh
# iPad「撮影記録」から送られる映像・位置・音を、この Mac で受けて記録する。ダブルクリックで動く。
export PATH=/opt/homebrew/bin:$PATH
SSD="/Volumes/tsuru backu"
if [ -d "$SSD" ]; then
  BASE="$SSD/サンプル会場_撮影_1103"
else
  BASE="$HOME/sample_work/サンプル会場_撮影_1103"
  echo "※ 外付け SSD(tsuru backu)が見つかりません。この Mac の中に記録します: $BASE"
fi
mkdir -p "$BASE"
OUT="$BASE/$(date +%m%d_%H%M%S)"
mkdir -p "$OUT"
TS=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null | head -1)
IP=$(ipconfig getifaddr en0)
echo ""
echo "=== iPad の「送り先」に入れる IP ==="
echo "  Tailscale: $TS    (同じ Wi-Fi の中: $IP)"
echo "  ポート: 9100"
echo "記録先: $OUT"
echo "iPad の録画ボタンを押すたびに、take_001、take_002 … と分かれます。5 秒おきに「コマ・毎秒・欠け」が出ます。全部終わったら Control+C。"
echo "$OUT" > "$HOME/sample_work/last_take.txt"
python3 "$HOME/sample_work/rx/pc_stream_receiver.py" --out "$OUT" --port 9100 --split-takes
echo ""
echo "終わりました。記録: $OUT"
echo "次は「記録を直す.command」をダブルクリック。"
read -r "?Enter で閉じる"
