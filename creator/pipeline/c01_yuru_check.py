"""ゆるキャラチェック: 入れた絵を、最初に 3 つに分ける(最初の設計の決め)。分かれ道の次の手も決める。

使い方: python creator/pipeline/c01_yuru_check.py <絵.png> <出力フォルダ> [--no-ai] [--reuse]
分け方:
  yuru    ゆるキャラ・マスコットとして扱いやすい(単純な形・顔が読める)→ 次: そのまま ① 見る段へ
  human   人の顔・人物の写真や写実寄りの絵 → 次: 「ゆるキャラにしてみる?」と提案(特徴を生かして yc-0-draw で描き直す)か、別の絵にする
  complex 複雑すぎる(景色・物が多い・細かい部品だらけ)→ 次: 別の絵にする か、主役を 1 つ選んで描き直す
決め方:
  1. 新しい文脈の Claude 2 つ(Haiku 5.5・Sonnet 5.5。j01_judge と同じ呼び方)が、各 3 回、A/B/C の 1 文字で答える。2 回以上同じ答えなら、その判定役の答え。
  2. 2 つが同じなら、それに決める。割れたら、画素の数字(下)の答えで決める。数字も決められなければ complex(使う人に選んでもらう)。
  3. --no-ai は数字だけで決める(試験・手元で速く見る用。精度は低い)。
  数字: 背景が白っぽいか・色の数・細かさ(輪郭の画素の割合)・肌の色の割合・小さな塊の数。2 つの判定役は同じ系統の Claude なので、独立した確かめではない。
出力: <出力フォルダ>/yuru_check.json(class・next・message・judges・metrics)。終わりの番号は常に 0(分けられなかったときだけ 2)。
"""
import argparse
import colorsys
import json
import os
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import j01_judge as J  # noqa: E402

LETTER = {"A": "yuru", "B": "human", "C": "complex"}
NEXT = {
    "yuru": ("look", "いい感じ!この絵からキャラを作るね。"),
    "human": ("offer_yurufy", "これはちょっとリアルな人の絵みたい。特徴を生かして、ゆるキャラにしてみる?(別の絵にもできるよ)"),
    "complex": ("offer_other_picture", "この絵は細かい所が多くて、そのままだと形を読み切れないみたい。主役を 1 つ選んで描き直すか、別の絵にしてみる?"),
}
BRIEF = """あなたは絵の仕分け役です。直さず、見て仕分けだけをします。同じフォルダの pic.png を Read で開いて見てください(画像は見えます)。

これから、この絵をもとに、丸くて単純な「ゆるキャラ」の 3D を作ります。その前に、絵が次のどれに当たるかを 1 つ選んでください。

A. ゆるキャラ・マスコット。丸みのある単純な形のキャラが 1 体だけ描かれていて、顔(目と口)が読める。背景はほとんど無い。
B. 人の顔・人物。実在しそうな人の写真や、写実寄り・似顔絵ふうの人の絵(人の顔の比率、肌・髪・鼻・唇が描き込まれている)。
C. 複雑な絵。景色・建物・たくさんの物、細かい部品や模様だらけ、キャラが 1 体に決められない絵。

答えの形は、次の 1 行だけです。A・B・C のどれか 1 文字で答えてください。迷うときは C にしてください。

答え: A

(上は形の見本です。絵を見て答えてください。)

そのあとに 1 行だけ、「理由: 」に続けて短く理由を書いてかまいません。
"""
ANS = re.compile(r"答え\s*[:：]\s*\**\s*([ABC])(?![A-Za-z])")
ANS_LINE = re.compile(r"^\W*([ABC])(?:[\s.。:：]|$)", re.M)   # 「A. ゆるキャラ…」「C」だけの行(見本の形を外した答え)
ROUNDS, NEED = 3, 2


def metrics(png):
    im = Image.open(png).convert("RGB").resize((512, 512))
    a = np.asarray(im).astype(int)
    border = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    bg_white = float((border.min(axis=1) >= 235).mean())
    fg = np.abs(a - 255).sum(axis=2) > 40
    fg_frac = float(fg.mean())
    q = (a // 32).reshape(-1, 3)
    _, counts = np.unique(q[fg.reshape(-1)] if fg.any() else q, axis=0, return_counts=True)
    colors = int((counts >= counts.sum() * 0.005).sum())
    g = a.mean(axis=2)
    mag = np.hypot(ndi.sobel(g, 0), ndi.sobel(g, 1))
    edges = mag > 120
    edge_frac = float(edges[fg].mean()) if fg.any() else 0.0
    px = (a[fg] / 255.0) if fg.any() else np.zeros((1, 3))
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in px[::max(len(px) // 15000, 1)]])
    skin = ((hsv[:, 0] <= 0.11) | (hsv[:, 0] >= 0.97)) & (hsv[:, 1] >= 0.15) & (hsv[:, 1] <= 0.55) & (hsv[:, 2] >= 0.45)
    skin_frac = float(skin.mean())
    lab, n = ndi.label(edges)
    small = int((ndi.sum(edges, lab, range(1, n + 1)) < 60).sum()) if n else 0
    return {"bg_white": round(bg_white, 3), "fg_frac": round(fg_frac, 3), "colors": colors,
            "edge_frac": round(edge_frac, 3), "skin_frac": round(skin_frac, 3), "small_blobs": small}


def by_numbers(m):
    """画素の数字だけの分け方(目安)。決められなければ None。"""
    # しきい値は、試験の絵 8 枚(creator/check/testset と作例 2 体)を見て決めた目安。割れた時の決め手にだけ使う
    if m["colors"] >= 40 or m["small_blobs"] >= 120:
        return "complex"
    if m["bg_white"] >= 0.9 and m["colors"] <= 35 and m["edge_frac"] <= 0.12:
        return "yuru"
    if m["skin_frac"] >= 0.12 and m["bg_white"] < 0.6:
        return "human"
    if m["bg_white"] < 0.5:
        return "complex"
    return None


def parse(text):
    """「答え: X」を探す(理由が先でも、同じ行に続いても拾う)。無ければ、A・B・C だけで始まる行。"""
    m = ANS.search(text or "")
    if m:
        return m.group(1)
    m = ANS_LINE.search(text or "")
    return m.group(1) if m else None


def ask(model, work, n, reuse=False):
    path = os.path.join(work, "answers", f"{model}_{n}.txt")
    if reuse and os.path.exists(path):
        return parse(open(path, encoding="utf-8").read())
    return parse(J.ask_claude(model, work, path))


def by_claude(png, out, reuse=False):
    os.makedirs(os.path.join(out, "answers"), exist_ok=True)
    shutil.copyfile(png, os.path.join(out, "pic.png"))
    with open(os.path.join(out, "brief.md"), "w", encoding="utf-8") as f:
        f.write(BRIEF)
    res = {}
    for model in (J.CLAUDE_MODEL_1, J.CLAUDE_MODEL_2):
        with ThreadPoolExecutor(ROUNDS) as pool:
            got = list(pool.map(lambda n: ask(model, out, n, reuse), range(ROUNDS)))
        best = max("ABC", key=got.count)
        res[model] = {"answers": got, "class": LETTER[best] if got.count(best) >= NEED else None}
    return res


def decide(judges, m):
    votes = [v["class"] for v in judges.values()] if judges else []
    if votes and votes[0] and all(v == votes[0] for v in votes):
        return votes[0], "判定役 2 つが同じ"
    num = by_numbers(m)
    if num:
        return num, "判定役が割れた(か、使わなかった)ので画素の数字で決めた" if judges else "画素の数字で決めた(--no-ai)"
    return "complex", "決めきれないので、使う人に選んでもらう"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("out")
    ap.add_argument("--no-ai", action="store_true")
    ap.add_argument("--reuse", action="store_true", help="answers/ に前の答えがあれば、聞き直さずに読み直す(費用 0)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    m = metrics(a.png)
    judges = {} if a.no_ai else by_claude(a.png, a.out, a.reuse)
    cls, why = decide(judges, m)
    nxt, msg = NEXT[cls]
    row = {"picture": os.path.basename(a.png), "class": cls, "next": nxt, "message": msg, "why": why,
           "judges": judges, "metrics": m, "numbers_say": by_numbers(m),
           "note": "判定役は同じ系統の Claude 2 つ。独立した確かめではない。最後は使う人が選べる(別の絵にする・ゆるキャラにしてみる)"}
    with open(os.path.join(a.out, "yuru_check.json"), "w", encoding="utf-8") as f:
        json.dump(row, f, ensure_ascii=False, indent=1)
    print(f"{row['picture']}: {cls} → {nxt}({why})  数字 {m}")
    sys.exit(0)


if __name__ == "__main__":
    main()
