"""run_clean_trial.sh の記録(log.jsonl)を、端末の画面のような早回しの動画にする。Claude Code が何をしたかを、そのまま見せるための素材。

使い方: python creator/skilltest/log_replay.py <log.jsonl> <出力.mp4> [--seconds 25] [--font 字のファイル]
1 行 = 道具の呼び出し 1 回か、作業役の文 1 つ。記録にない文は足さない。手元のパスは、公開してよい形に短くする。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1920, 1080
FPS = 30
MARGIN = 48
LINE_HEIGHT = 44
FONT_SIZE = 30
BG = (18, 20, 26)
COLORS = {"Skill": (120, 200, 255), "Read": (150, 160, 175), "Write": (130, 220, 150), "Edit": (130, 220, 150), "Bash": (240, 200, 120), "Grep": (150, 160, 175), "Glob": (150, 160, 175), "文": (235, 235, 240)}
MAX_CHARS = 92
FONT_CANDIDATES = ["C:/Windows/Fonts/meiryo.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]


def shorten(text):
    """手元のパスと改行を消して、1 行にする。"""
    text = re.sub(r"[A-Za-z]:[/\\]\S*?repo[/\\]", "", text)
    text = re.sub(r"cd \S*repo && ", "", text)
    text = re.sub(r"[A-Za-z]:[/\\]\S*[/\\](\S+)", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_CHARS] + ("…" if len(text) > MAX_CHARS else "")


def lines_of(path):
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for raw in f:
            try:
                e = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if e.get("type") != "assistant":
                continue
            for c in e["message"]["content"]:
                if c.get("type") == "text" and c["text"].strip():
                    out.append(("文", shorten(c["text"])))
                elif c.get("type") == "tool_use":
                    arg = c["input"]
                    detail = arg.get("command") or arg.get("file_path") or arg.get("skill") or arg.get("pattern") or ""
                    out.append((c["name"], shorten(str(detail))))
    return out


def frame(lines, upto, font):
    im = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(im)
    rows = (HEIGHT - 2 * MARGIN) // LINE_HEIGHT
    for i, (kind, text) in enumerate(lines[max(0, upto - rows):upto]):
        y = MARGIN + i * LINE_HEIGHT
        color = COLORS.get(kind, COLORS["Read"])
        d.text((MARGIN, y), (kind if kind != "文" else "●"), font=font, fill=color)
        d.text((MARGIN + 130, y), text, font=font, fill=COLORS["文"] if kind == "文" else (200, 205, 215))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("out")
    ap.add_argument("--seconds", type=float, default=25.0)
    ap.add_argument("--font")
    args = ap.parse_args()
    font_path = next((p for p in [args.font] + FONT_CANDIDATES if p and os.path.exists(p)), None)
    if not font_path:
        raise SystemExit("字のファイルが見つかりません(--font で渡す)")
    font = ImageFont.truetype(font_path, FONT_SIZE)
    lines = lines_of(args.log)
    if not lines:
        raise SystemExit("記録に行がありません")
    tmp = tempfile.mkdtemp()
    try:
        for i in range(len(lines)):
            frame(lines, i + 1, font).save(os.path.join(tmp, f"f_{i:04d}.png"))
        rate = len(lines) / args.seconds
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", f"{rate:.4f}", "-i", os.path.join(tmp, "f_%04d.png"),
                        "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-map_metadata", "-1", args.out], check=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"書いた: {args.out}({len(lines)} 行、{args.seconds} 秒)")


if __name__ == "__main__":
    main()
