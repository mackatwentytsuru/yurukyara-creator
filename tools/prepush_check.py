"""Stops a push when the tracked files hold a key, a pre-period character or another file that must not go out."""
import os
import re
import subprocess
import sys

# .env だけでなく .env.local・.env.production なども止める(見本の .env.example・.env.sample は上げてよい)
BLOCKED_FILES = re.compile(r"(\.vrm|\.vrma|\.pem|\.key|\.crt|(^|/)\.env(?!\.(example|sample)$)(\.[\w-]+)?)$", re.I)
SECRETS = re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}|sk_[a-f0-9]{30,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}")
# 入れない名前はリポジトリに書かない。外のファイル(1 行 1 語。# で始まる行は注)から読む。無ければ、黙って通さず止める
WORDS_FILE = os.environ.get("PREPUSH_TERMS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "prepush_terms.local.txt")


def load_words(path):
    try:
        with open(path, encoding="utf-8") as f:
            terms = [t.strip() for t in f if t.strip() and not t.lstrip().startswith("#")]
    except OSError:
        return None
    return re.compile("|".join(re.escape(t) for t in terms), re.I) if terms else None


WORDS = load_words(WORDS_FILE)
if WORDS is None:
    print(f"push を止めました: 入れない名前の一覧がありません({WORDS_FILE})")
    sys.exit(1)


def git(*args):
    return subprocess.run(["git", "-c", "core.quotepath=off", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout


problems = []
for path in git("ls-files").splitlines():
    if BLOCKED_FILES.search(path):
        problems.append(f"{path}: このファイルは上げられません")
        continue
    try:
        text = open(path, encoding="utf-8").read()
    except (UnicodeDecodeError, OSError):
        continue
    if SECRETS.search(text):
        problems.append(f"{path}: 鍵らしい文字列があります")
    if WORDS.search(text):
        problems.append(f"{path}: 入れない名前があります")

if problems:
    print("push を止めました:")
    print("\n".join(problems))
    sys.exit(1)
print("push の点検: 問題なし")
