"""目の周りの前後を、作り手以外の目(新しい文脈の Claude 2 つ。Haiku 5.5 と Sonnet 5.5)に見せ、「どちらの目の周りが滑らか・自然か」を問う。
判定役は j01_judge.py と同じ(ask_claude。Claude だけ)。自分では判定しない。

使い方: python creator/skilltest/eye_judge.py <前のフォルダ> <後のフォルダ> <作業フォルダ> [id,id,…]
決まり: 1 体につき、順番を入れ替えた 2 種類(前が左 / 後が左)の絵を、各判定役に各 3 回見せる(合計 6 回)。答えは「左」「右」「同じ」の 1 語。
        絵に文字や名前は入れない。作業フォルダの名前にも前後の語を入れない。形が崩れた答えは問い直し、無効なら数えない。
出力: <作業フォルダ>/eye_judge.json(答えをそのまま)と、標準出力の集計(後のほうが良い / 前のほうが良い / 同じ)。
"""
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import j01_judge as J  # noqa: E402

PANEL = 700
ANSWER = re.compile(r"^\W*答え\W*[::]\W*(左|右|同じ)\W*$", re.M)
BRIEF = """あなたは見た目の判定役です。直さず、見て判定だけをします。同じフォルダの sheet.png を Read で開いて見てください(画像は見えます)。

sheet.png は、同じキャラクターの顔のアップを 3D で描いた絵 2 枚を、左右に並べたものです。2 枚は、目の周りの作りだけが少し違うかもしれません(まったく同じかもしれません)。

問い: 目の周り(目の縁、目と顔の面の境、目のすぐ外の毛や面の肌ざわり)が、より滑らかで自然に見えるのは、左と右のどちらですか。差が分からないときは「同じ」と答えてください。

答えの形は、次の 1 行だけです。「左」「右」「同じ」の 1 語で答えてください。

答え: 左

(上は形の見本です。絵を見て答えてください。)

そのあとに 1 行だけ、「D: 」に続けて、目の周りで気になった所を書いてかまいません。
"""


def make_job(id_, left, right, work):
    os.makedirs(os.path.join(work, "answers"), exist_ok=True)
    a = Image.open(left).convert("RGB").resize((PANEL, PANEL), Image.LANCZOS)
    b = Image.open(right).convert("RGB").resize((PANEL, PANEL), Image.LANCZOS)
    sheet = Image.new("RGB", (PANEL * 2 + 20, PANEL), "white")
    sheet.paste(a, (0, 0))
    sheet.paste(b, (PANEL + 20, 0))
    sheet.save(os.path.join(work, "sheet.png"))
    with open(os.path.join(work, "brief.md"), "w", encoding="utf-8") as f:
        f.write(BRIEF)


def ask_once(name, fn, work, n):
    for attempt in range(J.RETRIES + 1):
        text = fn(work, os.path.join(work, "answers", f"{name}_{n}_{attempt}.txt"))
        m = ANSWER.findall(text or "")
        if m:
            return {"word": m[0], "retries": attempt}
    return {"word": None, "retries": J.RETRIES}


def main():
    before, after, root = sys.argv[1:4]
    ids = sys.argv[4].split(",") if len(sys.argv) > 4 else ["yokoso", "robo", "f_led", "d_lantern"]
    jobs = []
    for id_ in ids:
        for order, (l, r) in (("x1", (before, after)), ("x2", (after, before))):
            work = os.path.join(root, f"{id_}_{order}").replace("\\", "/")
            make_job(id_, os.path.join(l, f"{id_}_eye.png"), os.path.join(r, f"{id_}_eye.png"), work)
            jobs.append((id_, order, work, order == "x1"))  # x1 = 前が左
    results = {}
    with ThreadPoolExecutor(4) as pool:
        futs = []
        for name, fn in J.judges():
            for id_, order, work, before_left in jobs:
                for n in range(J.ROUNDS):
                    futs.append((name, id_, order, n, before_left, pool.submit(ask_once, name, fn, work, n)))
        for name, id_, order, n, before_left, fu in futs:
            r = fu.result()
            w = r["word"]
            better = None if w is None else ("同じ" if w == "同じ" else ("前" if (w == "左") == before_left else "後"))
            results.setdefault(id_, {}).setdefault(name, []).append({"order": order, "round": n, "word": w, "better": better, "retries": r["retries"]})
    with open(os.path.join(root, "eye_judge.json"), "w", encoding="utf-8") as f:
        json.dump({"rule": "各判定役に、順番を入れ替えた 2 種 × 各 3 回。答えは 左/右/同じ。better は前後に直した値", "results": results}, f, ensure_ascii=False, indent=1)
    for id_, per in results.items():
        for name, rows in per.items():
            c = {k: sum(1 for r in rows if r["better"] == k) for k in ("後", "前", "同じ")}
            bad = sum(1 for r in rows if r["better"] is None)
            print(f"{id_} {name}: 後のほうが良い {c['後']} / 前のほうが良い {c['前']} / 同じ {c['同じ']} / 無効 {bad}(計 {len(rows)} 回)")


if __name__ == "__main__":
    main()
