"""描いた元の絵(PNG)を、作り手以外の目で判定する。j01_judge.py と同じ決まりと道具(新しい文脈の Claude: Haiku 5.5・Sonnet 5.5、各 3 回)。

使い方: python creator/pipeline/d04_judge_draw.py <元の絵.png> <出力フォルダ>
問い(全部「はい」「いいえ」の 1 語):
  A. ゆるキャラらしいか(丸い・単純な形・かわいい)  B. 顔が読めるか(目と口)  C. 3D にしやすい形か(部品が分かれて見え、立たせられる)
出力: <出力フォルダ>/judge.json と answers/。3 つとも両方の判定役で「はい」なら合格(終わりの番号 0)。
合格しても、使う人の目が優先。判定役の答えを見て絵を直すのは良いが、合格を狙って判定だけを繰り返さない。
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import j01_judge as j  # noqa: E402

BRIEF = """あなたは見た目の判定役です。直さず、見て判定だけをします。同じフォルダの draw.png を Read で開いて見てください(画像は見えます)。

draw.png は、ゆるキャラ(マスコットキャラクター)の絵です。次の {n} つの問いに答えてください。

A. ゆるキャラらしいか。丸みのあるやさしい形で、形が単純で、かわいく、日本のゆるキャラ・ぬいぐるみのマスコットとして通る場合は「はい」。細かすぎる、鋭い、写実的、怖い、ふつうのイラストに見える場合は「いいえ」。
B. 顔が読めるか。目と口の位置がすぐ分かり、表情(笑っている、など)が読み取れる場合は「はい」。
C. 3D の立体にしやすい形か。頭・胴・手・足などの部品が丸い塊として分かれて見え、足元で立たせられそうな場合は「はい」。部品が細すぎる、薄い、浮いている、形が複雑な場合は「いいえ」。

答えの形は、次の {n} 行だけです。「はい」か「いいえ」の 1 語で答えてください。「ほぼはい」「おおむね」など、ほかの言葉は使わないでください。迷うときは「いいえ」にしてください。

A: はい
B: いいえ
C: はい

(上は形の見本です。絵を見て答えてください。)

そのあとに 1 行だけ、「D: 」に続けて、いちばん直すべき所を書いてかまいません。
"""
AXES = {"A": "ゆるキャラらしい", "B": "顔が読める", "C": "3D にしやすい"}


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    png, out = sys.argv[1], sys.argv[2].replace("\\", "/")
    os.makedirs(os.path.join(out, "answers"), exist_ok=True)
    shutil.copyfile(png, os.path.join(out, "draw.png"))
    with open(os.path.join(out, "brief.md"), "w", encoding="utf-8") as f:
        f.write(BRIEF.format(n=len(AXES)))
    rows = j.judge_many([dict(label=os.path.splitext(os.path.basename(png))[0], work=out, axes=AXES)])
    sys.exit(0 if all(next(iter(rows.values())).values()) else 1)


if __name__ == "__main__":
    main()
