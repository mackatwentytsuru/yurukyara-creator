"""試験の段ごとに、作業役の記録(jsonl)から、使ったトークンを足し上げる(入れ子の呼び出しも含む)。

使い方: python sum_usage.py <空の設定フォルダ>/projects/<段のフォルダ>
同じ応答 id は 1 回だけ数える。出力: モデルごとの 入力・出力・キャッシュ作成・キャッシュ読みのトークン。
"""
import glob
import json
import os
import sys
from collections import defaultdict


def main():
    root = sys.argv[1]
    seen = set()
    tot = defaultdict(lambda: defaultdict(int))
    files = glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True)
    for f in files:
        sub = "subagents" in f
        for line in open(f, encoding="utf-8", errors="ignore"):
            try:
                j = json.loads(line)
            except Exception:
                continue
            m = j.get("message") or {}
            u = m.get("usage")
            if not u or j.get("type") != "assistant":
                continue
            key = m.get("id") or j.get("uuid")
            if key in seen:
                continue
            seen.add(key)
            name = (m.get("model") or "?") + ("(入れ子)" if sub else "")
            for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"):
                tot[name][k] += u.get(k, 0) or 0
            tot[name]["messages"] += 1
    for name, d in tot.items():
        print(name, dict(d))


if __name__ == "__main__":
    main()
