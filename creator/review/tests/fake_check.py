"""試験だけで使う「ゆるキャラチェックのふり」(Claude を呼ばない)。yuru_make.py --fake-check <分け方> が呼ぶ。

使い方: python creator/review/tests/fake_check.py <絵> <出力フォルダ> --class yuru|human|complex
出す物: <出力>/yuru_check.json(c01_yuru_check.py と同じ欄の形)
"""
import argparse
import json
from pathlib import Path

NEXT = {"yuru": ("look", "いい感じ!この絵からキャラを作るね。"),
        "human": ("offer_yurufy", "これはちょっとリアルな人の絵みたい。特徴を生かして、ゆるキャラにしてみる?(別の絵にもできるよ)"),
        "complex": ("offer_other_picture", "この絵は細かい所が多くて、そのままだと形を読み切れないみたい。主役を 1 つ選んで描き直すか、別の絵にしてみる?")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("out")
    ap.add_argument("--class", dest="cls", choices=list(NEXT), required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    nxt, msg = NEXT[a.cls]
    row = {"picture": Path(a.png).name, "class": a.cls, "next": nxt, "message": msg, "why": "判定役 2 つが同じ(試験のふり)",
           "judges": {}, "metrics": {}, "note": "試験のふり。Claude は呼んでいない"}
    (out / "yuru_check.json").write_text(json.dumps(row, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{row['picture']}: {a.cls}(試験のふり)")


if __name__ == "__main__":
    main()
