#!/usr/bin/env python3
"""主役の呼び名の点検。ノリーは自分のことも「ノリー」と呼ぶ(11/7 に人が決めた)。
伸ばす棒の無い形を、名前として書いている所を探す。

使い方:
  python tools/name_check.py [--rev <コミットか木>] [--skip-file <外す場所の一覧>]... [--allow <語>]... [--repo <フォルダ>]

見る物: git が見張っているファイルのうち、文字のファイル(先頭 8000 バイトに 0 が無い物。git と同じ見分け方)。
  既定は作業フォルダの今の中身。--rev を付けると、そのコミットか木の中身(git merge-tree --write-tree の仮の木も見られる)。
誤りにする物:
  - 片仮名の ノ と リ の 2 字で、後ろに伸ばす棒(ー)が無い物。ただし、前が片仮名の物(長い片仮名の語の一部)と、
    許した語(同じ 2 字を 2 回重ねた語・〜ツッコミ・悪〜・〜気。--allow で足せる)の中は外す
  - 英語の名前の古い形(N で始まる 4 字の 1 語)。英語の名前は Norrie
外す場所:
  - docs/plan/(土 21:00 の書き換えで公開の木から外す)
  - --skip-file の一覧。書き換え(tools/rewrite_history.py)の --drop-paths と同じ形で、同じ読み方を使う:
    / で終わる行はその下の全部、ほかは fnmatch、# は注。old: の行は今の版が残るので外さない。
    環境変数 NAME_CHECK_SKIP(os.pathsep で区切る)でも渡せる
.claude/ の下の当たりは「注意」(司令塔が置くファイル。板の控えを直して司令塔へ渡す)。誤りの数に入れない。
終わりの番号: 0 = 誤り 0(注意はあってよい)、1 = 誤りあり、2 = 動かせない(git が無い・コミットが無い・一覧が読めない)
push の点検(tools/prepush_check.py)とは別の道具。流れの途中で、ほかの流れの push を止めないため。
"""
import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I でも同じフォルダの部品を読む
from rewrite_history import dropped_by, load_drop_patterns  # noqa: E402

BARE = "\u30ce\u30ea"  # 伸ばす棒の無い形(片仮名の ノ と リ)。この道具の中には、その 2 字を続けて書かない
BAR = "ーｰ"  # 伸ばす棒(全角と半角)
KATAKANA = "ァ-ヺーｦ-ﾝ"  # 前がこの字なら、長い片仮名の語の一部
JA_RX = re.compile(f"(?<![{KATAKANA}]){BARE}(?![{BAR}])")
EN_RX = re.compile(r"\bNor[i]\b", re.ASCII)  # 英語の名前の古い形(大文字と小文字を区別する。変数の nori などは見ない)
DEFAULT_ALLOW = (BARE * 2, BARE + "ツッコミ", "悪" + BARE, BARE + "気")
BUILTIN_SKIP = ["docs/plan/"]
WARN_PREFIX = ".claude/"
TEXT_PROBE = 8000
RULES = ((JA_RX, "伸ばす棒の無い呼び名(「ノリー」と書く)"), (EN_RX, "英語の名前の古い形(Norrie と書く)"))


class Stop(Exception):
    """動かせない(終わりの番号 2)"""


def git(root, *args, data=None):
    try:
        p = subprocess.run(["git", "-c", "core.quotepath=off", *args], cwd=root, input=data, capture_output=True)
    except (FileNotFoundError, NotADirectoryError) as e:
        raise Stop(f"git を動かせません({root}): {e.strerror}") from None
    if p.returncode != 0:
        raise Stop(f"git {args[0]} が失敗しました: {p.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return p.stdout


def tracked_files(root, rev):
    """[(場所, 中身のバイト列)]。rev が無ければ作業フォルダの今の中身、あればその木"""
    if not rev:
        out = []
        for path in git(root, "ls-files", "-z").decode("utf-8").split("\0"):
            full = os.path.join(root, path)
            if path and os.path.isfile(full) and not os.path.islink(full):
                with open(full, "rb") as f:
                    out.append((path, f.read()))
        return out
    try:
        tree = git(root, "rev-parse", "--verify", "--quiet", f"{rev}^{{tree}}").decode().strip()
    except Stop:
        raise Stop(f"コミットか木が見つかりません: {rev}") from None
    entries = []
    for row in git(root, "ls-tree", "-r", "-z", "--full-tree", tree).decode("utf-8").split("\0"):
        meta, _, path = row.partition("\t")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == "blob" and parts[0] != "120000":
            entries.append((path, parts[2]))
    blobs = read_blobs(root, sorted({sha for _, sha in entries}))
    return [(path, blobs.get(sha, b"")) for path, sha in entries]


def read_blobs(root, shas):
    """{sha: 中身}(git cat-file --batch を 1 回)"""
    out = git(root, "cat-file", "--batch", data=("\n".join(shas) + "\n").encode()) if shas else b""
    blobs, i = {}, 0
    while i < len(out):
        nl = out.index(b"\n", i)
        head = out[i:nl].split()
        if len(head) < 3:
            i = nl + 1
            continue
        size = int(head[2])
        blobs[head[0].decode()] = out[nl + 1:nl + 1 + size]
        i = nl + 1 + size + 1
    return blobs


def allowed_spans(line, allow):
    spans = []
    for word in allow:
        start = line.find(word)
        while start >= 0:
            spans.append((start, start + len(word)))
            start = line.find(word, start + 1)
    return spans


def line_hits(line, allow):
    """[(列(0 から), 理由)]"""
    spans = allowed_spans(line, allow)
    found = []
    for rx, why in RULES:
        for m in rx.finditer(line):
            if not any(a <= m.start() and m.end() <= b for a, b in spans):
                found.append((m.start(), why))
    return sorted(found)


def scan(files, skips, allow):
    """→ (誤り, 注意, 見た文字のファイルの数, 外した数)。誤りと注意は表示する行の並び"""
    errors, warns, seen, skipped = [], [], 0, 0
    for path, data in files:
        if dropped_by(path, skips):
            skipped += 1
            continue
        if b"\0" in data[:TEXT_PROBE]:
            continue
        seen += 1
        for no, raw in enumerate(data.decode("utf-8", "replace").split("\n"), 1):
            line = raw.rstrip("\r")
            for col, why in line_hits(line, allow):
                excerpt = line[max(0, col - 12):col + 14].strip()
                target = warns if path.startswith(WARN_PREFIX) else errors
                target.append(f"{path}:{no}:{col + 1}: {why} …{excerpt}…")
    return errors, warns, seen, skipped


def load_skips(paths):
    skips = list(BUILTIN_SKIP)
    for path in paths:
        try:
            drops, _old_versions_only = load_drop_patterns(path)
        except OSError as e:
            raise Stop(f"外す場所の一覧が読めません({path}): {e.strerror}") from None
        skips.extend(drops)
    return skips


def main(argv=None):
    ap = argparse.ArgumentParser(description="主役の呼び名の点検(伸ばす棒の無い形を名前に使っていないか)")
    ap.add_argument("--repo", default=".", help="リポジトリのフォルダ(既定は今のフォルダ)")
    ap.add_argument("--rev", default="", help="このコミットか木の中身を見る(既定は作業フォルダの今の中身)")
    ap.add_argument("--skip-file", action="append", default=[], help="外す場所の一覧(書き換えの --drop-paths と同じ形)")
    ap.add_argument("--allow", action="append", default=[], help="許す語(当たりの 2 字を含む語)")
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(errors="replace")  # 表示できない字があっても止まらない(Windows の古い文字コードへ流す時)
    env_skips = [p for p in os.environ.get("NAME_CHECK_SKIP", "").split(os.pathsep) if p]
    root = git(a.repo, "rev-parse", "--show-toplevel").decode("utf-8").strip()
    files = tracked_files(root, a.rev)
    errors, warns, seen, skipped = scan(files, load_skips(env_skips + a.skip_file), DEFAULT_ALLOW + tuple(a.allow))
    for row in errors:
        print(f"誤り: {row}")
    for row in warns:
        print(f"注意(.claude の下。板の控えを直して司令塔へ): {row}")
    print(f"名前の点検: 誤り {len(errors)} 件・注意 {len(warns)} 件(見た文字のファイル {seen}・外した場所のファイル {skipped})")
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Stop as e:
        print(f"名前の点検を止めました: {e}")
        sys.exit(2)
