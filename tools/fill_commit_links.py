#!/usr/bin/env python3
"""書き換えた後の履歴へのリンクを、文書に入れる。

文書には、書き換える前の短い SHA で `{{commit:007e795}}` と書いておく。履歴の書き換え(tools/rewrite_history.py)の
作業フォルダにできる commit-map.txt(古い SHA → 新しい SHA)を読み、`<リポジトリの URL>/commit/<新しい SHA>` に置き換える。

使い方:
  python tools/fill_commit_links.py --map <作業フォルダ>/commit-map.txt --repo https://github.com/<持ち主>/<名前> docs/HOW_WE_BUILT.md docs/HOW_WE_BUILT.en.md
  (どう作ったかは日本語の docs/HOW_WE_BUILT.md と英語の docs/HOW_WE_BUILT.en.md の 2 つ。両方を渡す)
  --check だけを付けると、書かずに、全部の印が置き換えられるかだけを見る。
終わりの番号: 0 = 全部置き換えた(か、置き換えられる)、1 = 見つからない・書き換えで消えた・1 つに決まらない印がある、2 = 動かせない
"""
import argparse
import re
import sys

MARK = re.compile(r"\{\{commit:([0-9a-f]{7,40})\}\}")
GONE = "0" * 40


def load_map(path):
    pairs = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2 and re.fullmatch(r"[0-9a-f]{40}", parts[0]):
                pairs[parts[0]] = parts[1]
    return pairs


def resolve(short, pairs):
    """短い SHA → (新しい SHA か None, 理由)"""
    hits = [old for old in pairs if old.startswith(short)]
    if not hits:
        return None, "書き換えの表に無い"
    if len(hits) > 1:
        return None, "1 つに決まらない(もっと長い SHA を書く)"
    new = pairs[hits[0]]
    if new == GONE:
        return None, "書き換えで中身が無くなり、消えた"
    return new, ""


def fill(text, pairs, repo):
    problems = []

    def sub(m):
        new, why = resolve(m.group(1), pairs)
        if not new:
            problems.append(f"{m.group(1)}: {why}")
            return m.group(0)
        return f"{repo.rstrip('/')}/commit/{new}"

    return MARK.sub(sub, text), problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--map", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    try:
        pairs = load_map(a.map)
    except OSError as e:
        print(f"止めました: 書き換えの表が読めません({e})")
        return 2
    if not pairs:
        print("止めました: 書き換えの表が空です")
        return 2
    bad = 0
    for path in a.files:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        out, problems = fill(text, pairs, a.repo)
        marks = len(MARK.findall(text))
        for p in problems:
            print(f"{path}: {p}")
        bad += len(problems)
        if not a.check and not problems and out != text:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(out)
        print(f"{path}: 印 {marks} 個、置き換えられない物 {len(problems)} 個{'(書いていない)' if a.check or problems else ''}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
