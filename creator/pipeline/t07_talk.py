"""段 ⑦ 話す: 検査を通った pack を characters/<id>/ に置き、会話の画面で実際に話させて確かめる(1 回の命令)。

使い方: python creator/pipeline/t07_talk.py <pack> <id> --name <表示の名前> --out <出力フォルダ>
        [--persona <性格の文.md>] [--words "<元の言葉>"] [--run <run.jsonl の場所>] [--force] [--no-build]
すること:
  1. pk04_install.py で characters/<id>/ に置く
  2. character.json に契約 K1 の origin(言葉から・描いたのは Claude)と looks(3d は最上位、2d は元の SVG)を足し、validate_character.py で確かめる
  3. web を組み立て(vite build)、空いた番号でサーバーを起こす(頭脳と声の鍵は外す = 仮の頭脳・字幕と口パクだけ。費用は出ない。お店のデータは空)
  4. web_talk_check.mjs(GPU で描く。CPU の描画なら止まる)で、読み込み・返事・口・表情か動きを確かめる
  5. 自分で起こしたサーバーの番号(PID)だけを止める
終わりの番号: 0 = 話せた、1 = できない所がある。結果は <出力>/web_check.json。
GPU を使うので、大きな PC では先に機械の札と GPU の鍵を取る。
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PY = sys.executable
SAMPLES = REPO / "creator" / "samples"
DROP = ("ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY")
QUESTIONS = "こんにちは、はじめまして|あなたのお名前と、好きなことを教えて"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def add_k1(char_path, cid, words):
    d = json.loads(char_path.read_text(encoding="utf-8"))
    d.setdefault("schema_version", 1)
    if words:
        d["origin"] = {"input": "words", "words": words, "drawn_by": "claude",
                       "created": time.strftime("%Y-%m-%dT%H:%M:%S+09:00")}
    svg = SAMPLES / f"{cid}_元の絵.svg"
    looks = {"default": "3d", "3d": {"at": "top"}}
    if svg.exists():
        import xml.etree.ElementTree as ET
        root = ET.fromstring(svg.read_text(encoding="utf-8"))
        char = [c for c in root if c.tag.endswith("g") and c.get("id") == "char"]
        parts = [g.get("id") for g in char[0]] if char else []
        looks["2d"] = {"svg": os.path.relpath(svg, char_path.parent).replace(os.sep, "/"), "parts": parts}
    d["looks"] = looks
    char_path.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def stop(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("id")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--persona")
    ap.add_argument("--words")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-build", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cmd = [PY, str(REPO / "creator/pipeline/pk04_install.py"), a.pack, a.id, "--name", a.name]
    if a.persona:
        cmd += ["--persona", a.persona]
    if a.force:
        cmd.append("--force")
    if subprocess.run(cmd).returncode:
        sys.exit(1)
    cj = REPO / "characters" / a.id / "character.json"
    add_k1(cj, a.id, a.words)
    if subprocess.run([PY, str(REPO / "creator/specs/validate_character.py"), str(cj)]).returncode:
        sys.exit(1)
    if subprocess.run([PY, str(REPO / "creator/pipeline/pk02_check_character.py"), str(cj.parent)]).returncode:
        sys.exit(1)
    npm = "npm.cmd" if os.name == "nt" else "npm"
    if not a.no_build and subprocess.run([npm, "run", "build"], cwd=REPO / "web").returncode:
        sys.exit(1)
    port = free_port()
    env = {k: v for k, v in os.environ.items() if k not in DROP and not k.startswith("CLAUDE_CODE_")}
    env.update(PORT=str(port), SHOP_DATA_FILE=str(REPO / "creator/setup/shop_empty.json"))
    log = open(out / "server.log", "w", encoding="utf-8")
    srv = subprocess.Popen(["node", "server/index.mjs"], cwd=REPO / "web", env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2)
                break
            except OSError:
                time.sleep(1)
        rc = subprocess.run(["node", str(REPO / "creator/pipeline/web_talk_check.mjs"), "--port", str(port), "--character", a.id,
                             "--out", str(out), "--questions", QUESTIONS], timeout=600).returncode
    finally:
        stop(srv)
        log.close()
    print("話す確かめ:", "OK" if rc == 0 else "NG", f"({out / 'web_check.json'})")
    sys.exit(0 if rc == 0 else 1)


if __name__ == "__main__":
    main()
