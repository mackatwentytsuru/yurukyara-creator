"""ブラウザの絵を、作り手以外の目で判定する。作った担当に、自分の出来を判定させないための道具。

使い方: python creator/pipeline/j01_judge.py <元の絵> <撮った絵のフォルダ> <出力フォルダ> [--part 部分の名前] [--fur]
  --part: 難しい部分(耳、たすき など)の形も問う。--fur: 布・ぬいぐるみのキャラなら、毛足の質感も問う。
出力: <出力フォルダ>/browser_cmp.png・answers/・judge.json。合格なら終わりの番号 0、不合格なら 1。

判定の決まり:
- 同じ絵を各判定役に 3 回見せる。2 回以上「はい」なら、その判定役の「はい」。2 つの判定役の両方が「はい」で合格。
- 答えは「はい」「いいえ」の 1 語だけ。それ以外(ほぼはい、など)は数えず、問い直す。問い直しても無効なら「はい」に数えない。
- 絵に文字や数字を入れない(見出しの数字を見て答える例が出たため)。
- 合格しても、使う人の目が優先。

判定役: 何も設定しなければ、新しい文脈の Claude を 2 つ(CLAUDE_MODEL_1・CLAUDE_MODEL_2)。
別の AI を使うときは、環境変数 JUDGE_CMD_1・JUDGE_CMD_2 にコマンドを書く({dir}=絵と問いのフォルダ、{prompt}=問いのファイル、{out}=答えを書くファイル)。
"""
import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

CLAUDE_MODEL_1 = "claude-haiku-5-5"
CLAUDE_MODEL_2 = "claude-sonnet-5-5"
ROUNDS = 3
RETRIES = 2
NEED_YES = 2
SHOTS = ("browser_front.png", "browser_q.png", "browser_close.png")
SHEET_HEIGHT = 900
TIMEOUT_S = 600
FIRST_JUDGE_WORKERS = 4
ANSWER = re.compile(r"^\W*([ABCE])\W*[::]\W*(はい|いいえ)\W*$", re.M)
Q_SAME = "A. 同じキャラに見えるか。"
Q_FUR = "B. ブラウザの絵に、毛足のある布・ぬいぐるみ(フェルトや起毛した布)の質感が出ているか。粒立って汚れて見える、ざらつきすぎ、つるっとしている場合は「いいえ」。"
Q_COLOR = "C. ブラウザの絵の色は、元のイラストに近いか。"
Q_PART = "E. {part}の形・大きさ・位置は、元のイラストに近いか。細い、小さい、平ら、位置が違う場合は「いいえ」。"
BRIEF = """あなたは見た目の判定役です。直さず、見て判定だけをします。同じフォルダの browser_cmp.png を Read で開いて見てください(画像は見えます)。

browser_cmp.png は、左から、元のイラスト({kind})、そのキャラを 3D にして Web ブラウザで描いた絵の、正面・斜め・顔のアップ、です。

次の {n} つの問いに答えてください。

{questions}

答えの形は、次の {n} 行だけです。「はい」か「いいえ」の 1 語で答えてください。「ほぼはい」「おおむね」など、ほかの言葉は使わないでください。迷うときは「いいえ」にしてください。

{form}

(上は形の見本です。絵を見て答えてください。)

そのあとに 1 行だけ、「D: 」に続けて、いちばん直すべき所を書いてかまいません。
"""


def axes_of(part, fur):
    axes = {"A": "同じキャラ"}
    if fur:
        axes["B"] = "毛足"
    axes["C"] = "色"
    if part:
        axes["E"] = part
    return axes


def write_brief(path, part, fur):
    questions = [Q_SAME] + ([Q_FUR] if fur else []) + [Q_COLOR] + ([Q_PART.format(part=part)] if part else [])
    keys = [q[0] for q in questions]
    words = ["はい", "いいえ", "はい", "いいえ"]
    text = BRIEF.format(
        kind="布のぬいぐるみ風のゆるキャラ" if fur else "キャラクター",
        n=len(questions),
        questions="\n".join(questions),
        form="\n".join(f"{k}: {w}" for k, w in zip(keys, words)),
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def make_sheet(orig_path, shots_dir, out_dir):
    """元の絵とブラウザの絵を、文字なしで横に並べる。"""
    orig = Image.open(orig_path).convert("RGB")
    h = SHEET_HEIGHT
    ims = [orig.resize((int(orig.width * h / orig.height), h))]
    ims += [Image.open(os.path.join(shots_dir, n)).convert("RGB").resize((h, h)) for n in SHOTS]
    sheet = Image.new("RGB", (sum(i.width for i in ims), h), "white")
    x = 0
    for im in ims:
        sheet.paste(im, (x, 0))
        x += im.width
    sheet.save(os.path.join(out_dir, "browser_cmp.png"))


def clean_env():
    """Claude Code の中から呼んでも、別の文脈で動くように、親の印を外す。"""
    return {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_CODE_")}


def ask_claude(model, work_dir, out_path):
    with open(os.path.join(work_dir, "brief.md"), encoding="utf-8") as f:
        prompt = f.read()
    cmd = [shutil.which("claude") or "claude", "-p", "--model", model, "--allowedTools", "Read", "--output-format", "text"]
    try:
        p = subprocess.run(cmd, input=prompt, cwd=work_dir, env=clean_env(), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(p.stdout)
    return p.stdout


def ask_command(template, work_dir, out_path):
    prompt = os.path.join(work_dir, "brief.md")
    cmd = [a.format(dir=work_dir, prompt=prompt, out=out_path) for a in shlex.split(template)]
    try:
        subprocess.run(cmd, cwd=os.path.expanduser("~"), capture_output=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    try:
        with open(out_path, encoding="utf-8-sig", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def judges():
    """[(名前, 問う関数)] を返す。"""
    out = []
    for i, model in ((1, CLAUDE_MODEL_1), (2, CLAUDE_MODEL_2)):
        template = os.environ.get(f"JUDGE_CMD_{i}")
        if template:
            out.append((f"j{i}", lambda w, o, t=template: ask_command(t, w, o)))
        else:
            out.append((f"j{i}", lambda w, o, m=model: ask_claude(m, w, o)))
    return out


def parse(text, axes):
    """問うた軸が全部 1 語で揃っているときだけ返す。"""
    found = {}
    for key, word in ANSWER.findall(text):
        found.setdefault(key, word)
    return found if set(axes) <= set(found) else None


def one_round(name, fn, work_dir, n, axes):
    """1 回分の答え。形が崩れていれば問い直す。問い直した回数も残す。"""
    for attempt in range(RETRIES + 1):
        got = parse(fn(work_dir, os.path.join(work_dir, "answers", f"{name}_{n}_{attempt}.txt")), axes)
        if got:
            return {"answer": got, "retries": attempt}
    return {"answer": None, "retries": RETRIES}


def tally(rounds, axes):
    out = {}
    for key in axes:
        yes = sum(1 for r in rounds if r["answer"] and r["answer"][key] == "はい")
        out[key] = {"yes": yes, "of": len(rounds), "pass": yes >= NEED_YES}
    return out


def prepare(orig_path, shots_dir, work, part, fur):
    work = work.replace("\\", "/")
    os.makedirs(os.path.join(work, "answers"), exist_ok=True)
    make_sheet(orig_path, shots_dir, work)
    write_brief(os.path.join(work, "brief.md"), part, fur)
    return work


def judge_many(jobs):
    """jobs: [{label, work, axes}]。1 つ目の判定役は並べ、2 つ目は 1 つずつ(並べると空が返る AI があった)。結果を判定し、judge.json を書く。"""
    (name1, fn1), (name2, fn2) = judges()
    results = {j["label"]: {name1: [None] * ROUNDS, name2: [None] * ROUNDS} for j in jobs}
    with ThreadPoolExecutor(FIRST_JUDGE_WORKERS) as pool:
        futures = {(j["label"], n): pool.submit(one_round, name1, fn1, j["work"], n, j["axes"]) for j in jobs for n in range(ROUNDS)}
    for (label, n), fu in futures.items():
        results[label][name1][n] = fu.result()
    for j in jobs:
        for n in range(ROUNDS):
            results[j["label"]][name2][n] = one_round(name2, fn2, j["work"], n, j["axes"])
    rows = {}
    for j in jobs:
        label, axes = j["label"], j["axes"]
        a, b = tally(results[label][name1], axes), tally(results[label][name2], axes)
        row = {k: a[k]["pass"] and b[k]["pass"] for k in axes}
        rows[label] = row
        cells = " / ".join(f"{axes[k]} {a[k]['yes']}/{ROUNDS}・{b[k]['yes']}/{ROUNDS} {'○' if row[k] else '×'}" for k in axes)
        bad = sum(1 for ai in results[label].values() for r in ai if r["answer"] is None)
        print(f"{label}: {cells}(無効 {bad} 回)")
        with open(os.path.join(j["work"], "judge.json"), "w", encoding="utf-8") as f:
            json.dump({"rule": "各判定役に 3 回、2 回以上はいで、その判定役のはい。両方で合格", "judges": results[label], "axes": axes, "pass": row, "visual_decided_by_owner": True}, f, ensure_ascii=False, indent=1)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("orig")
    ap.add_argument("shots")
    ap.add_argument("out")
    ap.add_argument("--part")
    ap.add_argument("--fur", action="store_true")
    args = ap.parse_args()
    work = prepare(args.orig, args.shots, args.out, args.part, args.fur)
    rows = judge_many([dict(label=os.path.basename(os.path.abspath(args.shots)), work=work, axes=axes_of(args.part, args.fur))])
    # 毛足は判定がぶれるので、合否には入れず数字だけ残す(creator/skilltest/結果表.md)
    sys.exit(0 if all(v for k, v in next(iter(rows.values())).items() if k != "B") else 1)


if __name__ == "__main__":
    main()
