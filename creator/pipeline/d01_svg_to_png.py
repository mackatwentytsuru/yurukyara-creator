"""SVG を PNG(1254×1254、白背景)にする。Chrome のヘッドレスで撮る(GPU を使わない 2D)。

使い方: python creator/pipeline/d01_svg_to_png.py <入力.svg> [<出力.png>] [--size 1254] [--noshadow]
  出力を省くと、入力と同じ名前の .png を同じフォルダに書く。
  --noshadow: 床の影(id="shadow" の <g>)を外した版を <出力>_noshadow.png にも書く。
              測る道具(s03_compare・s05_gaps・check_all)は影を体と数えるので、測る絵は影なしを使う。
Chrome の場所は、環境変数 CHROME_PATH、無ければ入っていそうな場所から探す。
終わりの番号: 0 = 撮れた、1 = 撮れなかった。
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
]


def find_chrome():
    p = os.environ.get("CHROME_PATH")
    if p and Path(p).exists():
        return p
    for c in CANDIDATES:
        if Path(c).exists():
            return c
    return shutil.which("google-chrome") or shutil.which("chrome") or shutil.which("chromium")


def strip_shadow(svg_text):
    """id="shadow" の要素(<g> など)を外した SVG の文字を返す。無ければそのまま。"""
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    root = ET.fromstring(svg_text)
    removed = 0
    for parent in list(root.iter()):
        for child in list(parent):
            if child.get("id") == "shadow":
                parent.remove(child)
                removed += 1
    return ET.tostring(root, encoding="unicode"), removed


def shoot(svg_text, out_png, size=1254):
    chrome = find_chrome()
    if not chrome:
        print("Chrome が見つかりません。CHROME_PATH に実行ファイルを渡してください", file=sys.stderr)
        return False
    body = re.sub(r"^\s*<\?xml[^>]*\?>", "", svg_text)
    html = ("<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;overflow:hidden;background:#fff}"
            "svg{display:block}</style></head><body>" + body + "</body></html>")
    with tempfile.TemporaryDirectory(prefix="d01_") as tmp:
        page = Path(tmp) / "page.html"
        page.write_text(html, encoding="utf-8")
        out = Path(out_png).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        cmd = [chrome, "--headless=new", f"--screenshot={out}", f"--window-size={size},{size}",
               "--default-background-color=FFFFFFFF", "--disable-gpu", "--hide-scrollbars",
               f"--user-data-dir={Path(tmp) / 'ud'}", page.as_uri()]   # 絶対パスの file URL(相対は撮れない)
        try:
            subprocess.run(cmd, capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            print("Chrome が 60 秒で終わりませんでした", file=sys.stderr)
            return False
    return out.exists() and out.stat().st_size > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("svg")
    ap.add_argument("png", nargs="?")
    ap.add_argument("--size", type=int, default=1254)
    ap.add_argument("--noshadow", action="store_true")
    a = ap.parse_args()
    svg_path = Path(a.svg)
    out = Path(a.png) if a.png else svg_path.with_suffix(".png")
    text = svg_path.read_text(encoding="utf-8")
    ok = shoot(text, out, a.size)
    print(("撮れました: " if ok else "撮れませんでした: ") + str(out))
    if ok and a.noshadow:
        text2, n = strip_shadow(text)
        out2 = out.with_name(out.stem + "_noshadow.png")
        ok2 = shoot(text2, out2, a.size)
        print(f"影なし(id=shadow を {n} 個外す): " + (str(out2) if ok2 else "撮れませんでした"))
        ok = ok and ok2
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
