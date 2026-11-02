"""ブラウザの絵を、作り手以外の AI 2 つに判定させる(sh judge_browser.sh から呼ぶ)。

判定の決まり:
- 同じ絵を各 AI に 3 回見せる。2 回以上「はい」なら、その AI の「はい」。2 つの AI の両方が「はい」で合格。
- 答えは「はい」「いいえ」の 1 語だけ。それ以外(ほぼはい、など)は数えず、問い直す。問い直しても無効なら「はい」に数えない。
- 絵に文字や数字を入れない(見出しの数字を見て答える例が出たため)。
- 合格しても、本人の目が優先。見た目の既定は本人が選ぶ。

使い方: python judge3.py <絵のフォルダ名> <試験のフォルダ…>(TRIAL_BASE からの相対、例 k_beak/p3_sonnet_medium)
出力: <試験>/judge_<絵のフォルダ名>/browser_cmp.png・answers/・judge.json
"""
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ["TRIAL_BASE"]
DEEPSEEK = os.environ["DEEPSEEK_JUDGE"]
GLM = os.path.join(HERE, "glm_judge.ps1")
BRIEF = os.path.join(HERE, "judge_brief.md")
ROUNDS = 3
RETRIES = 2
NEED_YES = 2
AXES = {"A": "同じキャラ", "B": "毛足", "C": "色"}
SHOTS = ("browser_front.png", "browser_q.png", "browser_close.png")
SHEET_HEIGHT = 900
TIMEOUT_S = 600
DEEPSEEK_WORKERS = 4
ANSWER = re.compile(r"^\W*([ABC])\W*[::]\W*(はい|いいえ)\W*$", re.M)


def make_sheet(trial, shots_name, out_dir):
    """元の絵とブラウザの絵を、文字なしで横に並べる。"""
    char = trial.split("/")[0]
    orig = Image.open(os.path.join(BASE, "jobs", char, "out.png")).convert("RGB")
    h = SHEET_HEIGHT
    ims = [orig.resize((int(orig.width * h / orig.height), h))]
    ims += [Image.open(os.path.join(BASE, trial, shots_name, n)).convert("RGB").resize((h, h)) for n in SHOTS]
    sheet = Image.new("RGB", (sum(i.width for i in ims), h), "white")
    x = 0
    for im in ims:
        sheet.paste(im, (x, 0))
        x += im.width
    sheet.save(os.path.join(out_dir, "browser_cmp.png"))


def ask(ai, work_dir, out_path):
    script = DEEPSEEK if ai == "deepseek" else GLM
    cmd = ["powershell", "-NoProfile", "-File", script, "-Dir", work_dir, "-PromptFile", os.path.join(work_dir, "brief.md"), "-Out", out_path]
    try:
        subprocess.run(cmd, cwd=os.path.expanduser("~"), capture_output=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return ""
    try:
        return open(out_path, encoding="utf-8-sig", errors="replace").read()
    except OSError:
        return ""


def parse(text):
    """A・B・C の 3 つが 1 語で揃っているときだけ返す。"""
    found = {}
    for key, word in ANSWER.findall(text):
        found.setdefault(key, word)
    return found if set(found) == set(AXES) else None


def one_round(ai, work_dir, n):
    """1 回分の答え。形が崩れていれば問い直す。問い直した回数も残す。"""
    for attempt in range(RETRIES + 1):
        out = os.path.join(work_dir, "answers", f"{ai}_{n}_{attempt}.txt")
        got = parse(ask(ai, work_dir, out))
        if got:
            return {"answer": got, "retries": attempt}
    return {"answer": None, "retries": RETRIES}


def tally(rounds):
    out = {}
    for key in AXES:
        yes = sum(1 for r in rounds if r["answer"] and r["answer"][key] == "はい")
        out[key] = {"yes": yes, "of": len(rounds), "pass": yes >= NEED_YES}
    return out


def main():
    shots_name, trials = sys.argv[1], sys.argv[2:]
    jobs = []
    for t in trials:
        work = os.path.join(BASE, t, "judge_" + shots_name).replace("\\", "/")
        os.makedirs(os.path.join(work, "answers"), exist_ok=True)
        make_sheet(t, shots_name, work)
        with open(BRIEF, encoding="utf-8") as f:
            open(os.path.join(work, "brief.md"), "w", encoding="utf-8").write(f.read())
        jobs.append((t, work))
    results = {t: {"deepseek": [None] * ROUNDS, "glm": [None] * ROUNDS} for t, _ in jobs}
    with ThreadPoolExecutor(DEEPSEEK_WORKERS) as pool:
        futures = {(t, n): pool.submit(one_round, "deepseek", w, n) for t, w in jobs for n in range(ROUNDS)}
    for (t, n), fu in futures.items():
        results[t]["deepseek"][n] = fu.result()
    for t, w in jobs:   # GLM は並べると空が返ることがあるので、1 つずつ
        for n in range(ROUNDS):
            results[t]["glm"][n] = one_round("glm", w, n)
    passed = {k: 0 for k in AXES}
    for t, w in jobs:
        ds, gl = tally(results[t]["deepseek"]), tally(results[t]["glm"])
        row = {k: ds[k]["pass"] and gl[k]["pass"] for k in AXES}
        for k in AXES:
            passed[k] += row[k]
        cells = " / ".join(f"{AXES[k]} {ds[k]['yes']}/{ROUNDS}・{gl[k]['yes']}/{ROUNDS} {'○' if row[k] else '×'}" for k in AXES)
        bad = sum(1 for ai in results[t].values() for r in ai if r["answer"] is None)
        print(f"{t}: {cells}(無効 {bad} 回)")
        json.dump({"rule": "各 AI に 3 回、2 回以上はいで、その AI のはい。両方で合格", "deepseek": results[t]["deepseek"], "glm": results[t]["glm"], "pass": row, "visual_decided_by_owner": True},
                  open(os.path.join(w, "judge.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    all_three = sum(1 for t, _ in jobs if all(tally(results[t]["deepseek"])[k]["pass"] and tally(results[t]["glm"])[k]["pass"] for k in AXES))
    print("合計: " + "、".join(f"{AXES[k]} {passed[k]}/{len(jobs)}" for k in AXES) + f"、3 つとも {all_three}/{len(jobs)}")


if __name__ == "__main__":
    main()
