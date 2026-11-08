#!/usr/bin/env python3
"""README の一番上の帯の絵 docs/images/banner.png(2560x800。GitHub では 1280 の幅で出る)を作る。

絵はこのリポジトリの characters/norrie/2d/body.svg の部品(笑顔)だけを使う。HTML を組み、ヘッドレスの Chrome で PNG に焼く。
使い方: python tools/make_banner.py [--chrome <chrome.exe>] [--out docs/images/banner.png]
終わりの番号: 0 = 作れた、2 = Chrome が見つからない・焼けなかった
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, "characters", "norrie", "2d", "body.svg")
CHROMES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]
WIDTH, HEIGHT, SCALE = 1280, 400, 2
SHOW = ("face.happy.eyes", "face.happy.mouth_closed")  # 笑顔の目と口だけ出す

PAGE = """<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
:root{--orange:#D97757;--orange-hi:#E8875B;--ink:#F3EDE4;--dim:#A39A8E;--panel:#1C1A18;--line:#3B332D}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:%(w)dpx;height:%(h)dpx;background:transparent;overflow:hidden}
body{font-family:"Noto Sans JP","Yu Gothic","Meiryo",sans-serif}
.win{position:absolute;left:14px;top:12px;right:14px;bottom:30px;border-radius:22px;overflow:hidden;
  background:radial-gradient(900px 420px at 86%% 55%%,rgba(217,119,87,.30),rgba(217,119,87,0) 62%%),
  linear-gradient(180deg,#221F1C,var(--panel));border:2px solid var(--line);
  box-shadow:0 8px 16px rgba(0,0,0,.30),0 0 0 1px rgba(217,119,87,.16)}
.grid{position:absolute;inset:0;background-image:radial-gradient(rgba(243,237,228,.07) 1.4px,transparent 1.6px);background-size:26px 26px;
  -webkit-mask-image:linear-gradient(90deg,#000,transparent 70%%);mask-image:linear-gradient(90deg,#000,transparent 70%%)}
.bar{position:absolute;left:0;right:0;top:0;height:52px;display:flex;align-items:center;gap:10px;padding:0 24px;border-bottom:2px solid var(--line);background:rgba(0,0,0,.18)}
.dot{width:14px;height:14px;border-radius:50%%;background:#4A413A}.dot.o{background:var(--orange)}
.ttl{margin-left:14px;font:500 17px/1 "Cascadia Mono",Consolas,monospace;color:var(--dim);letter-spacing:.02em}
.txt{position:absolute;left:56px;top:86px}
.cmd{font:500 19px/1 "Cascadia Mono",Consolas,monospace;color:var(--dim);margin-bottom:20px}
.cmd b{color:var(--orange);font-weight:500}
.h{display:flex;align-items:center;gap:16px;color:var(--ink)}
.h .p{font:700 72px/1 "Cascadia Mono",Consolas,monospace;color:var(--orange);margin-top:-6px;text-shadow:0 0 28px rgba(217,119,87,.55)}
.h h1{font-weight:900;font-size:62px;line-height:1.1;letter-spacing:.015em}
.sub{margin:16px 0 0 6px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:32px;color:var(--orange-hi);letter-spacing:.04em}
.cur{display:inline-block;width:16px;height:34px;background:var(--orange);border-radius:3px;opacity:.95}
.chips{margin:26px 0 0 6px;display:flex;gap:12px}
.chip{font:500 17px/1 "Cascadia Mono","Noto Sans JP",monospace;color:var(--dim);border:2px solid var(--line);border-radius:999px;padding:8px 16px;background:rgba(0,0,0,.2)}
.chip i{font-style:normal;color:var(--orange)}
.chara{position:absolute;right:98px;top:62px;height:276px;width:198px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.45))}
.chara svg{width:100%%;height:100%%;display:block}
.floor{position:absolute;right:60px;bottom:4px;width:280px;height:22px;border-radius:50%%;background:radial-gradient(closest-side,rgba(0,0,0,.45),transparent)}
%(hide)s
</style></head><body><div class="win"><div class="grid"></div>
<div class="bar"><span class="dot o"></span><span class="dot"></span><span class="dot"></span><span class="ttl">~/yurukyara-creator</span></div>
<div class="txt"><div class="cmd"><b>$</b> yuru-chara --start</div>
<div class="h"><span class="p">&gt;</span><h1>ゆるキャラクリエイター</h1></div>
<div class="sub">えらんで、こたえるだけ。<span class="cur"></span></div>
<div class="chips"><span class="chip"><i>●</i> 2分ほどで話しはじめる</span><span class="chip"><i>●</i> 2D も 3D も</span></div></div>
<div class="floor"></div><div class="chara">%(svg)s</div></div></body></html>"""


def build_html():
    with open(SVG, encoding="utf-8") as f:
        svg = f.read()
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r'\s(width|height)="[\d.]+"', "", svg, count=2)  # viewBox のまま枠に合わせる
    hide = ['svg [id^="face."]{display:none}', "svg #back{display:none}"]
    hide += ['svg [id="%s"]{display:inline}' % s for s in SHOW]
    return PAGE % {"w": WIDTH, "h": HEIGHT, "svg": svg, "hide": "\n".join(hide)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--chrome", default="")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "images", "banner.png"))
    a = ap.parse_args(argv)
    chrome = a.chrome or next((c for c in CHROMES if os.path.exists(c)), "")
    if not chrome:
        print("Chrome が見つかりません(--chrome で教えてください)")
        return 2
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "banner.html")
        with open(page, "w", encoding="utf-8") as f:
            f.write(build_html())
        cmd = [chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
               f"--force-device-scale-factor={SCALE}", f"--window-size={WIDTH},{HEIGHT}",
               f"--user-data-dir={os.path.join(tmp, 'profile')}", f"--screenshot={os.path.abspath(a.out)}",
               "file:///" + page.replace(os.sep, "/")]
        subprocess.run(cmd, capture_output=True, timeout=90)
    if not os.path.exists(a.out):
        print("PNG を焼けませんでした")
        return 2
    print("作りました:", a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
