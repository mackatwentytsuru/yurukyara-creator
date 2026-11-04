"""run_clean_trial.sh の 1 回を、動画の早回しの素材にする。作業の記録から、絵の変わる様子と、作業役の動きを並べる。

使い方: python creator/skilltest/timelapse.py <作業フォルダ> <元の絵> <出力.mp4> [--seconds-per-round 1.5] [--font 字のファイル]
左: 元の絵。右: 検査の周ごとのブラウザの絵。下: 何周目か、検査の結果、作業役の最後の道具の呼び出しの数。
数字は記録からそのまま取る。絵は変えない。試行錯誤が分かるように、落ちた周も全部入れる。
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1920, 1080
BAR = 180
FPS = 30
FONT_CANDIDATES = ["C:/Windows/Fonts/meiryob.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"]
FONT_SIZE = 44
SMALL_SIZE = 32
OK_COLOR = (60, 160, 90)
NG_COLOR = (200, 60, 60)


def font_file(given):
    for path in [given] + FONT_CANDIDATES:
        if path and os.path.exists(path):
            return path
    raise SystemExit("字のファイルが見つかりません(--font で渡す)")


def fit(image, w, h):
    im = image.copy()
    im.thumbnail((w, h))
    canvas = Image.new("RGB", (w, h), "white")
    canvas.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return canvas


def rounds_of(work):
    """検査の周ごとに、時刻・絵・結果の文を返す。古い順。"""
    out = []
    folders = glob.glob(os.path.join(work, "repo", "_trials", "**", "check", "history", "*"), recursive=True)
    folders += glob.glob(os.path.join(work, "check", "history", "*"))  # 作業フォルダ直下に検査の履歴がある場合
    for folder in sorted(folders, key=os.path.basename):
        front = os.path.join(folder, "browser_front.png")
        txt = os.path.join(folder, "check.txt")
        if not (os.path.exists(front) and os.path.exists(txt)):
            continue
        lines = open(txt, encoding="utf-8").read().splitlines()
        marks = [ln for ln in lines if ln[:1] in "①②③④⑤⑥"]
        out.append(dict(front=front, ok=sum(" OK" in m[:5] for m in marks), total=len(marks), failed=[m[:18] for m in marks if " NG" in m[:5]]))
    return out


def tool_count(work):
    n = 0
    if not os.path.exists(os.path.join(work, "log.jsonl")):
        return None
    with open(os.path.join(work, "log.jsonl"), encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("type") == "assistant":
                n += sum(c.get("type") == "tool_use" for c in e.get("message", {}).get("content", []))
    return n


def frame(orig, r, i, total, big, small):
    canvas = Image.new("RGB", (WIDTH, HEIGHT), (245, 245, 245))
    h = HEIGHT - BAR
    canvas.paste(fit(orig, WIDTH // 2, h), (0, 0))
    canvas.paste(fit(Image.open(r["front"]).convert("RGB"), WIDTH // 2, h), (WIDTH // 2, 0))
    d = ImageDraw.Draw(canvas)
    d.text((40, h + 20), f"検査 {i + 1} 周目 / {total} 周", font=big, fill=(30, 30, 30))
    all_ok = not r["failed"]
    d.text((40, h + 90), "全部 OK" if all_ok else "落ちた: " + "、".join(r["failed"]), font=small, fill=OK_COLOR if all_ok else NG_COLOR)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("orig")
    ap.add_argument("out")
    ap.add_argument("--seconds-per-round", type=float, default=1.5)
    ap.add_argument("--font")
    args = ap.parse_args()
    rounds = rounds_of(args.work)
    if not rounds:
        raise SystemExit("検査の記録がありません")
    orig = Image.open(args.orig).convert("RGB")
    ff = font_file(args.font)
    big, small = ImageFont.truetype(ff, FONT_SIZE), ImageFont.truetype(ff, SMALL_SIZE)
    tmp = tempfile.mkdtemp()
    try:
        for i, r in enumerate(rounds):
            frame(orig, r, i, len(rounds), big, small).save(os.path.join(tmp, f"f_{i:04d}.png"))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(1 / args.seconds_per_round), "-i", os.path.join(tmp, "f_%04d.png"),
                        "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-map_metadata", "-1", args.out], check=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    n = tool_count(args.work)
    print(f"書いた: {args.out}(検査 {len(rounds)} 周、" + (f"道具の呼び出し {n} 回)" if n is not None else "道具の記録なし)"))


if __name__ == "__main__":
    main()
