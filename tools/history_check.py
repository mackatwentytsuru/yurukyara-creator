"""公開の前に、全コミットの中身と本文を点検する。履歴は書き換えない。見るだけ。

使い方: python tools/history_check.py [--terms 語の一覧.txt] [--json 出力.json]
  語の一覧: 1 行に 1 語。人名など、リポジトリに書けない語を書く。tools/history_terms.local.txt(リポジトリに入れない)を自動で読む。
見る物: 全コミットで足された行と、コミットの本文。バイナリは見ない。
出す物: 語ごとの件数、最初に現れたコミットとファイル。行の中身は表示しない(鍵を画面に出さないため)。
終わりの番号: 0 = 何もなし、1 = 見つかった(止めて報告する)、2 = 動かせない。
"""
import json
import os
import re
import subprocess
import sys

# 鍵の形。誤検知を減らすため、長さを見る
KEY_PATTERNS = {
    "Anthropic の鍵": r"sk-ant-[A-Za-z0-9_-]{20,}",
    "OpenAI 形式の鍵": r"\bsk-[A-Za-z0-9]{32,}",
    "Google の鍵": r"\bAIza[A-Za-z0-9_-]{30,}",
    "GitHub の鍵": r"\bgh[pousr]_[A-Za-z0-9]{30,}",
    "AWS の鍵": r"\bAKIA[A-Z0-9]{16}\b",
    "秘密鍵": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "鍵らしい代入": r"(?i)\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['\"][A-Za-z0-9_\-]{20,}['\"]",
}
# 探す語(人名など)はリポジトリに書かない。手元のファイルから読む
LOCAL_TERMS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "history_terms.local.txt")


def load_terms(path):
    with open(path, encoding="utf-8") as f:
        return [t.strip() for t in f if t.strip() and not t.startswith("#")]


def scan(patterns):
    """全コミットの足された行と本文を流し読みし、(名前 → 件数・最初の場所)を返す。"""
    cmd = ["git", "-c", "core.quotepath=false", "log", "--all", "--reverse", "-p", "--no-color", "--no-ext-diff", "--unified=0", "--format=@@@COMMIT %H%n%B"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    found = {}
    commit, path = "", "(コミットの本文)"
    count = 0
    for line in proc.stdout:
        if line.startswith("@@@COMMIT "):
            commit, path = line.split()[1][:8], "(コミットの本文)"
            count += 1
            continue
        if line.startswith("+++ "):
            path = line[4:].strip().removeprefix("b/")
            continue
        if line.startswith(("--- ", "-", "@@", "diff ", "index ")):
            continue
        for name, rx in patterns.items():
            if rx.search(line):
                row = found.setdefault(name, {"count": 0, "first_commit": commit, "files": {}})
                row["count"] += 1
                row["files"][path] = row["files"].get(path, 0) + 1
    if proc.wait() != 0:
        print("git log が失敗した")
        sys.exit(2)
    return found, count


def main():
    a = sys.argv[1:]
    terms = load_terms(LOCAL_TERMS) if os.path.exists(LOCAL_TERMS) else []
    if not terms:
        print("注意: 語の一覧がない。鍵の形だけを見る(tools/history_terms.local.txt に 1 行 1 語で書く)")
    out = None
    if "--terms" in a:
        terms += load_terms(a[a.index("--terms") + 1])
    if "--json" in a:
        out = a[a.index("--json") + 1]
    patterns = {k: re.compile(v) for k, v in KEY_PATTERNS.items()}
    patterns.update({t: re.compile(re.escape(t)) for t in terms})
    found, commits = scan(patterns)
    print(f"点検したコミット {commits} 件、探した物 {len(patterns)} 種類(鍵の形 {len(KEY_PATTERNS)}、語 {len(terms)})")
    for name, row in sorted(found.items(), key=lambda kv: -kv[1]["count"]):
        top = sorted(row["files"].items(), key=lambda kv: -kv[1])[:5]
        print(f"見つかった: {name} {row['count']} 件(最初 {row['first_commit']})")
        for f, n in top:
            print(f"    {n} 件 {f}")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(found, f, ensure_ascii=False, indent=1)
    if not found:
        print("何も見つからなかった")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
