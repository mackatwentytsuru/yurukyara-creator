"""キャラ作りに要る道具を調べ、見つかった場所を creator/env.local.sh に書く。

使い方: python creator/setup/doctor.py [--write] [--json 出力.json] [--blender <実行ファイル>]
  何も付けないと調べるだけ。--write で env.local.sh に書く(前の値は env.local.sh.bak に残す)。
  --blender は、自動で見つからないときに、使う人に聞いた場所を渡す。
終わりの番号: 0 = 全部そろった、1 = 足りない物がある。足りない物と、その直し方を出す。

鍵の値は読まない。あるかないかだけを見る(環境変数の名前だけ)。
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ENV_LOCAL = os.path.join(REPO, "creator", "env.local.sh")
MIN_BLENDER = (4, 2)   # glTF の書き出しとシェイプキーを使う。5.2 で試験した
MIN_NODE = 20
PLAYWRIGHT = os.path.join(REPO, "web", "node_modules", "playwright-core", "index.mjs")
KEY_NAMES = {"ANTHROPIC_API_KEY": "会話の頭脳", "ELEVENLABS_API_KEY": "読み上げの声"}
BLENDER_GLOBS = [
    "C:/Program Files/Blender Foundation/Blender */blender.exe",
    "/Applications/Blender*.app/Contents/MacOS/Blender",
    os.path.expanduser("~/Applications/Blender*.app/Contents/MacOS/Blender"),
    "/usr/bin/blender",
    "/usr/local/bin/blender",
    "/snap/bin/blender",
]
CHROME_PLACES = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]
TIMEOUT_S = 60


def run(cmd):
    """コマンドの出力を返す。動かなければ None。"""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return p.stdout + p.stderr if p.returncode == 0 else None


def blender_version(path):
    """(主, 副) を返す。読めなければ None。"""
    out = run([path, "--version"])
    m = re.search(r"Blender (\d+)\.(\d+)", out or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def find_blender(given):
    if given:
        candidates = [given]
    else:
        candidates = [os.environ.get("BLENDER"), shutil.which("blender")]
        for pattern in BLENDER_GLOBS:
            candidates += sorted(glob.glob(pattern), reverse=True)
    for path in filter(None, candidates):
        ver = blender_version(path)
        if ver and ver >= MIN_BLENDER:
            return path, ver
    return None, None


def find_python():
    """PIL と numpy の入った Python を探す。"""
    candidates = [os.environ.get("PY"), sys.executable, shutil.which("python3"), shutil.which("python")]
    for path in filter(None, candidates):
        if run([path, "-c", "import PIL, numpy"]) is not None:
            return path
    return None


def find_chrome():
    if os.environ.get("CHROME_PATH") and os.path.exists(os.environ["CHROME_PATH"]):
        return os.environ["CHROME_PATH"]
    for name in ("google-chrome", "chrome", "chromium"):
        if shutil.which(name):
            return shutil.which(name)
    return next((p for p in CHROME_PLACES if os.path.exists(p)), None)


def node_major():
    out = run([shutil.which("node") or "node", "-v"])
    m = re.match(r"v(\d+)", out or "")
    return int(m.group(1)) if m else None


def shell_path(path):
    """env.local.sh に書く形。Windows の \\ は / にする(sh がそのまま読める)。"""
    return path.replace("\\", "/")


def check(args):
    blender, ver = find_blender(args.blender)
    py = find_python()
    chrome = find_chrome()
    node = node_major()
    items = [
        dict(name="sh", ok=bool(shutil.which("sh")), fix="Windows なら Git for Windows を入れる(Git Bash の sh を使う)"),
        dict(name="Blender", ok=bool(blender), value=blender, version=".".join(map(str, ver)) if ver else None,
             fix=f"https://www.blender.org/download/ から {MIN_BLENDER[0]}.{MIN_BLENDER[1]} 以降を入れる。別の場所にあるなら --blender <実行ファイル> で教える"),
        dict(name="Python(PIL・numpy)", ok=bool(py), value=py, fix="python -m pip install pillow numpy"),
        dict(name="Node.js", ok=bool(node and node >= MIN_NODE), version=node, fix=f"https://nodejs.org/ から {MIN_NODE} 以降を入れる"),
        dict(name="web の部品", ok=os.path.exists(PLAYWRIGHT), fix="cd web && npm install"),
        dict(name="Chrome", ok=bool(chrome), value=chrome, fix="Google Chrome を入れる。別の場所にあるなら CHROME_PATH に書く"),
        dict(name="claude", ok=bool(shutil.which("claude")), fix="Claude Code を入れて、ログインする(絵の判定を新しい文脈の Claude に頼むため)"),
    ]
    keys = {name: bool(os.environ.get(name)) for name in KEY_NAMES}
    return items, keys, dict(BLENDER=blender, PY=py, CHROME_PATH=chrome)


def write_env(values):
    keep = []
    if os.path.exists(ENV_LOCAL):
        shutil.copyfile(ENV_LOCAL, ENV_LOCAL + ".bak")
        with open(ENV_LOCAL, encoding="utf-8") as f:
            keep = [ln.rstrip("\n") for ln in f if not re.match(r"(BLENDER|PY|CHROME_PATH)=|export CHROME_PATH|# creator/setup/doctor", ln)]
    lines = ["# creator/setup/doctor.py が書いた。この手元の道具の場所(リポジトリに入れない)"]
    lines += [f'{k}="{shell_path(v)}"' for k, v in values.items() if v]
    if values.get("CHROME_PATH"):
        lines.append("export CHROME_PATH")
    with open(ENV_LOCAL, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines + keep) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--json")
    ap.add_argument("--blender")
    args = ap.parse_args()
    items, keys, values = check(args)
    missing = [i for i in items if not i["ok"]]
    for i in items:
        detail = i.get("version") or i.get("value") or ""
        print(f"{'OK ' if i['ok'] else 'NG '} {i['name']} {detail}".rstrip())
        if not i["ok"]:
            print(f"    直し方: {i['fix']}")
    for name, has in keys.items():
        state = "設定あり" if has else "なし(本人が環境変数に設定する。無くても仮の動きで試せる)"
        print(f"鍵 {KEY_NAMES[name]}({name}): {state}")
    if args.write:
        write_env(values)
        print(f"書いた: {ENV_LOCAL}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(dict(items=items, keys=keys, ok=not missing), f, ensure_ascii=False, indent=1)
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
