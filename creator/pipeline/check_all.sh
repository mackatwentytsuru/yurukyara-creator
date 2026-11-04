#!/bin/sh
# 作った物を、まとめて機械で検査する(人が見る前に、毎回通す)。どれかが落ちると、終わりの番号が 1 になる。
# 使い方: sh check_all.sh <build.blend> <pack のフォルダ> <元の絵> <出力フォルダ> [帯の名前,…]
# 検査: ① character.json の形 ② GLB の予算 ③ 埋まりと浮き ④ 元の絵と比べた抜け ⑤ ブラウザ(three.js)で撮れる ⑥ 視線で体の骨が回り続けない
# 出力: <出力フォルダ>/contact.json、gaps.json、gaps.png、browser/browser_front.png など、check.txt(結果)
# ここが全部通っても、見た目の合格ではない。形・質感・色は、ブラウザの絵を作り手以外の AI に見せて判定する。
HERE=$(cd "$(dirname "$0")" && pwd)
ENV_SH="$HERE/check_all.sh"; . "$HERE/../env.sh"
# Git Bash では、パスを Windows の形にそろえる(/x/… のまま Blender や node へ渡すと、別の場所に書かれて、絵が迷子になる)
BLEND=$(cygpath -m "$1"); PACK=$(cygpath -m "$2"); ORIG=$(cygpath -m "$3"); OUT=$(cygpath -m "$4"); HUG=$5
B=$BLENDER
mkdir -p "$OUT"
LOG="$OUT/check.txt"; : > "$LOG"
FAIL=0
say() { echo "$1" | tee -a "$LOG"; }

"$PY" "$HERE/pk02_check_character.py" "$PACK" > "$OUT/_pk02.txt" 2>&1 && say "① OK character.json" || { say "① NG character.json"; tail -5 "$OUT/_pk02.txt" | tee -a "$LOG"; FAIL=1; }
"$PY" "$HERE/pk03_glb_report.py" "$PACK" --json "$OUT/glb.json" > "$OUT/_pk03.txt" 2>&1
head -1 "$OUT/_pk03.txt" | tee -a "$LOG"
if grep -q "^WARN" "$OUT/_pk03.txt"; then say "② 注意 GLB の予算"; grep "^WARN" "$OUT/_pk03.txt" | tee -a "$LOG"; else say "② OK GLB の予算"; fi

"$B" -b "$BLEND" -t 4 -P "$HERE/m03_contact.py" -- --json "$OUT/contact.json" --near 0.02 --hug "${HUG:-,}" 2>&1 | grep -E "^M03" > "$OUT/_m03.txt"
if grep -q "^M03 NG" "$OUT/_m03.txt"; then say "③ NG 埋まりと浮き"; grep "^M03 NG" "$OUT/_m03.txt" | tee -a "$LOG"; FAIL=1; else say "③ OK 埋まりと浮き"; fi

"$B" -b -t 4 -P "$HERE/m02_shot.py" -- "$BLEND" "$OUT/shots" --views front --size 1024 --transparent > /dev/null 2>&1
if "$PY" "$HERE/s05_gaps.py" "$ORIG" "$OUT/shots/shot_front.png" --out "$OUT/gaps.png" --json "$OUT/gaps.json" > "$OUT/_s05.txt" 2>&1; then
  say "④ OK 抜けなし"
else
  say "④ NG 抜けあり(赤い所が gaps.png。腕・脚・耳は W.limb、輪郭の不足は形を直す)"; cat "$OUT/_s05.txt" | tee -a "$LOG"; FAIL=1
fi

# ⑤ ブラウザで撮る。サーバーは自分で立て、自分の番号だけを止める
# 空いている番号を OS に選ばせる。決め打ちだと、同時に動く別の検査のサーバーへつながり、別のキャラを撮って OK を出す(試験で実際に起きた)
PORT=$("$PY" -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1])")
PARENT=$(cd "$PACK/.." && pwd); NAME=$(basename "$PACK")
SERVE=$(cygpath -m "$REPO/creator/viewer/serve.py")
MSYS_NO_PATHCONV=1 "$PY" "$SERVE" "$PORT" "--mount=/trial=$(cygpath -m "$PARENT" 2>/dev/null || echo "$PARENT")" > /dev/null 2>&1 &
SRV=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -sf -o /dev/null "http://127.0.0.1:$PORT/creator/viewer/index.html" && break; sleep 1; done
SHOT=$(cygpath -m "$REPO/creator/skilltest/shot_browser.mjs")
if MSYS_NO_PATHCONV=1 node "$SHOT" "$PORT" "/trial/$NAME/character.json" "$OUT/browser" > "$OUT/_shot.txt" 2>&1; then
  say "⑤ OK ブラウザで撮れた($OUT/browser/)"
else
  say "⑤ NG ブラウザで読めない"; tail -3 "$OUT/_shot.txt" | tee -a "$LOG"; FAIL=1
fi
LOOK=$(cygpath -m "$REPO/creator/skilltest/test_look_drift.mjs")
if MSYS_NO_PATHCONV=1 node "$LOOK" "$PORT" "/trial/$NAME/character.json" --frames 300 > "$OUT/_look.txt" 2>&1; then
  say "⑥ OK 視線で体の骨が回り続けない"
else
  say "⑥ NG 視線の回転が積み上がる"; tail -3 "$OUT/_look.txt" | tee -a "$LOG"; FAIL=1
fi
# 止めた時の「Terminated」の表示は、bash 以外の sh(Mac)で出るので、まとめて捨てる
{ kill "$SRV"; wait "$SRV"; } 2> /dev/null

[ "$FAIL" = 0 ] && say "全部 OK(見た目の合格ではない)" || say "落ちた検査あり"
# 直すたびの様子を残す(動画の早回しと、試行錯誤の記録に使う)
HIST="$OUT/history/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$HIST"
cp "$LOG" "$HIST/" 2> /dev/null
cp "$OUT/browser/browser_front.png" "$OUT/browser/browser_q.png" "$OUT/gaps.png" "$HIST/" 2> /dev/null
exit "$FAIL"
