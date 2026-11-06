#!/usr/bin/env python3
"""ファイルごとの「最初に入ったコミットの日」と、ほかの場所の物との似かたを表にする。

何のための道具か:
  提出物が「開発期間に作った物」だけかを、あとから何度でも確かめるための道具です。
  git の履歴(作った日 %ad と記録した日 %cd)と、期間より前にあった別の場所の物との
  中身の比べ(同一・行の重なり)を、TSV と読みやすい Markdown にします。読むだけで、何も書き換えません。

使い方:
  python tools/provenance.py --out provenance.tsv --md provenance.md
  python tools/provenance.py --period-start 2026-11-02T12:30:00+09:00 \
      --compare 名前=別の場所のフォルダ --compare 名前2=別のフォルダ ...

  --compare は何本でも指定できます。「名前=フォルダ」の形で、名前は表に出る札です。
    * git のフォルダは、期間の開始より前の最後のコミットの中身だけを比べます。
    * git でないフォルダは、更新日が期間の開始より前のファイルだけを比べます。

表の読み方:
  first_author / first_commit  最初に入ったコミットの作った日・記録した日(--follow で名前変更をたどる)
  first_any                    全部の枝をまとめた最初の日(枝の中に古い履歴があるか)
  pre_period                   作った日か記録した日が期間の開始より前なら yes
  exact                        中身がまったく同じ物が、期間前の別の場所にあれば、その場所
  best_match / ratio           行がいちばん重なる、別の場所の物(8 割以上 = --min-ratio で疑い)
  same_name / same_name_ratio  同じファイル名の物と、その行の重なり(名前だけ同じなら重なりは空)
  hint                         ファイルの先頭に「前に作った」「写し」などの手がかりがあれば、その行
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import hashlib
import os
import re
import subprocess
import sys
from collections import defaultdict

TEXT_EXT = {
    ".md", ".txt", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json",
    ".html", ".css", ".sh", ".yml", ".yaml", ".toml", ".svg", ".glsl", ".tsv",
    ".csv", ".cfg", ".ini", ".bat", ".ps1",
}
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
    ".next", ".cache", "worktrees",
}
HINT_RE = re.compile(
    r"前に作っ|以前作っ|流用|移植|転用|引き継|"
    r"copied from|ported from|adapted from|taken from|originally (?:from|written)|"
    r"previously (?:built|made|written)|prior work",
    re.IGNORECASE,
)
RESERVED = {"nul", "con", "prn", "aux"}   # Windows の特別な名前(読むと止まる)
MAX_TEXT = 1_000_000
MAX_HASH = 100_000_000
MIN_LINE = 6          # これより短い行(括弧だけなど)は数えない
MIN_LINES = 5         # 数える行がこれ未満のファイルは、行の比べをしない


EXTRA_SKIP = set()
WANT_SIZES = set()   # 本体のバイナリの大きさ(これと違う大きさのバイナリは、中身を読まない)


def git(repo, *args, check=True):
    p = subprocess.run(
        ["git", "-c", "core.quotepath=off", "-C", repo, *args],
        capture_output=True,
    )
    if check and p.returncode != 0:
        raise RuntimeError(p.stderr.decode("utf-8", "replace").strip() or "git failed")
    return p.stdout


def git_text(repo, *args, check=True):
    return git(repo, *args, check=check).decode("utf-8", "replace")


def blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def is_text_name(name):
    return os.path.splitext(name)[1].lower() in TEXT_EXT


def norm_lines(data):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    out = set()
    for ln in text.splitlines():
        s = ln.strip()
        if len(s) >= MIN_LINE:
            out.add(s)
    return out


def read_blobs(repo, shas):
    """git cat-file --batch で中身をまとめて読む。"""
    shas = list(dict.fromkeys(shas))
    if not shas:
        return {}
    p = subprocess.run(
        ["git", "-C", repo, "cat-file", "--batch"],
        input=("\n".join(shas) + "\n").encode(), capture_output=True,
    )
    buf, pos, res = p.stdout, 0, {}
    for sha in shas:
        nl = buf.index(b"\n", pos)
        head = buf[pos:nl].split()
        if len(head) < 3 or head[1] == b"missing":
            pos = nl + 1
            continue
        size = int(head[2])
        res[sha] = buf[nl + 1: nl + 1 + size]
        pos = nl + 1 + size + 1
    return res


def parse_dt(s):
    return dt.datetime.fromisoformat(s)


# ---------- 1. 最初に入ったコミット ----------

def first_added(repo, ref, path, all_refs):
    args = ["log", "--follow", "--diff-filter=A", "--format=%H|%aI|%cI|%s"]
    args += ["--all"] if all_refs else [ref]
    args += ["--", path]
    lines = [l for l in git_text(repo, *args, check=False).splitlines() if l.strip()]
    if not lines:  # 追加として出なければ、触れた最初のコミット
        args = ["log", "--follow", "--format=%H|%aI|%cI|%s"]
        args += ["--all"] if all_refs else [ref]
        args += ["--", path]
        lines = [l for l in git_text(repo, *args, check=False).splitlines() if l.strip()]
    if not lines:
        return None
    h, a, c, s = lines[-1].split("|", 3)
    return {"hash": h[:7], "author": a, "commit": c, "subject": s}


# ---------- 2. 比べる相手(期間前の別の場所) ----------

class Corpus:
    """比べる相手の全部。blob の sha → 出どころ、行 → 出どころ の索引を持つ。"""

    def __init__(self):
        self.sha_src = {}                       # blob sha → "札:パス"
        self.files = []                         # (札, パス, 行の集合)
        self.inv = defaultdict(list)            # 行 → ファイル番号の列
        self.names = defaultdict(list)          # ファイル名 → [(札, パス, 行の集合 or None)]
        self.notes = []

    def add_name(self, label, path, lines):
        self.names[os.path.basename(path)].append((label, path, lines))

    def add_text(self, label, path, lines):
        self.add_name(label, path, lines)
        if lines is None or len(lines) < MIN_LINES:
            return
        i = len(self.files)
        self.files.append((label, path, len(lines)))
        for ln in lines:
            self.inv[hash(ln)].append(i)

    def add_git(self, label, root, cutoff):
        # 期間の開始より前の最後のコミットを、枝ごとにたどる
        refs = git_text(root, "for-each-ref", "--format=%(refname)", check=False).split()
        commits = set()
        for r in refs:
            c = git_text(root, "rev-list", "-1", f"--before={cutoff}", r, check=False).strip()
            if c:
                commits.add(c)
        seen, todo = set(), []
        for c in commits:
            out = git(root, "ls-tree", "-r", "-l", "-z", c, check=False).decode("utf-8", "replace")
            for ent in out.split("\0"):
                if not ent.strip():
                    continue
                meta, _, path = ent.partition("\t")
                parts = meta.split()
                if len(parts) < 4 or parts[1] != "blob":
                    continue
                sha, size = parts[2], int(parts[3]) if parts[3].isdigit() else 0
                if any(seg in SKIP_DIRS for seg in path.split("/")):
                    continue
                if (sha, path) in seen:
                    continue
                seen.add((sha, path))
                self.sha_src.setdefault(sha, f"{label}:{path}")
                if is_text_name(path) and size <= MAX_TEXT:
                    todo.append((sha, path))
                else:
                    self.add_name(label, path, None)
        blobs = read_blobs(root, [s for s, _ in todo])
        for sha, path in todo:
            if sha in blobs:
                self.add_text(label, path, norm_lines(blobs[sha]))
        self.notes.append(f"{label}: git・{len(commits)} 個の枝の先・{len(seen)} ファイル(期間前の最後のコミットまで)")

    def add_tree(self, label, root, cutoff_ts):
        n = 0
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in SKIP_DIRS and d not in EXTRA_SKIP]
            for f in fn:
                full = os.path.join(dp, f)
                if f.lower() in RESERVED:
                    continue
                try:
                    st = os.stat(full)
                    if st.st_mtime >= cutoff_ts or st.st_size > MAX_HASH:
                        continue
                    if not (is_text_name(f) and st.st_size <= MAX_TEXT) and st.st_size not in WANT_SIZES:
                        rel0 = os.path.relpath(full, root).replace(os.sep, "/")
                        self.add_name(label, rel0, None)
                        continue
                    with open(full, "rb") as fh:
                        data = fh.read()
                except OSError:
                    continue
                try:
                    rel = os.path.relpath(full, root).replace(os.sep, "/")
                except ValueError:
                    continue
                n += 1
                self.sha_src.setdefault(blob_sha(data), f"{label}:{rel}")
                if is_text_name(f) and len(data) <= MAX_TEXT:
                    self.add_text(label, rel, norm_lines(data))
                else:
                    self.add_name(label, rel, None)
        self.notes.append(f"{label}: git でない・更新日が期間前の {n} ファイル")

    def best(self, lines):
        if lines is None or len(lines) < MIN_LINES:
            return None, 0.0
        counts = defaultdict(int)
        for ln in lines:
            for i in set(self.inv.get(hash(ln), ())):
                counts[i] += 1
        if not counts:
            return None, 0.0
        i, c = max(counts.items(), key=lambda kv: kv[1])
        label, path, _ = self.files[i]
        return f"{label}:{path}", c / len(lines)


    def same_name(self, name, lines):
        """同じファイル名の物のうち、行がいちばん重なる物(名前だけ同じなら比は空)。"""
        cands = self.names.get(name, [])
        if not cands:
            return "", None
        best, br = None, -1.0
        for label, path, ls in cands:
            r = -1.0
            if lines and ls:
                r = len(lines & ls) / len(lines)
            if r > br:
                best, br = f"{label}:{path}", r
        return best, (br if br >= 0 else None)


GENERIC = {"index.js", "index.html", "README.md", "package.json", "package-lock.json",
           ".gitignore", ".gitkeep", "__init__.py", "SKILL.md", "style.css", "main.js",
           "character.json", ".env.example", "vite.config.js", ".gitattributes", "settings.json"}


# ---------- 3. 表を作る ----------

def folder_key(path, depth):
    parts = path.split("/")
    return "/".join(parts[:depth]) if len(parts) > depth else (parts[0] if len(parts) == 1 else "/".join(parts[:-1]))


def suspect_reason(r, min_ratio):
    why = []
    if r["pre_period"] == "yes":
        why.append("日付が期間前")
    if r["exact"]:
        why.append("期間前の物と同一")
    if r["ratio"] and float(r["ratio"]) >= min_ratio:
        why.append(f"行の重なり {r['ratio']}")
    if r["same_name_ratio"] and float(r["same_name_ratio"]) >= min_ratio:
        why.append(f"同じ名前の物と重なり {r['same_name_ratio']}")
    if r["hint"]:
        why.append("先頭に「前に作った」などの語")
    return "・".join(why)


def write_public_md(args, start, rows, suspects, groups, firsts_all, corpus, checked):
    """リポジトリに入れる版。比べた相手の名前・パス・近い物の名前は出さず、数と重なりの値だけを出す。"""
    n_src = len(corpus.notes)
    n_files = len(corpus.files)
    real = [r for r in suspects if r["path"] not in checked]
    with open(args.public_md, "w", encoding="utf-8", newline="\n") as f:
        f.write("<!-- 自動生成: tools/provenance.py --public-md。手で直さない -->\n\n")
        f.write("# 期間の表(ファイルごとの最初のコミットと、期間前の物との比べ)\n\n")
        f.write(f"- 調べた版: `{args.ref}`、ファイル {len(rows)} 本\n")
        f.write(f"- 期間の開始: {start.isoformat()}(これより前に書いたコードは使わない決まり)\n")
        if firsts_all:
            f.write(f"- 最初に入った日の幅: {firsts_all[0]} 〜 {firsts_all[-1]}\n")
        f.write(f"- 比べた相手: 作者の手元にあった期間前の物 {n_src} か所(スキル・フック・作業役・命令・道具と、前のリポジトリ)、"
                f"合わせて {n_files} ファイル。場所の名前はここに書かない\n")
        f.write(f"- 期間前の疑い: {len(suspects)} 本(うち中身を読んで期間前の物ではないと確かめた物 {len(suspects) - len(real)} 本、残り {len(real)} 本)\n")
        f.write("- 見つけ方: 最初に入ったコミットの日(作った日と記録した日)、中身が同一か、行が 8 割以上重なるか、先頭の「前に作った」などの語。"
                "名前を変えた物もたどる。似ていないことは、写していないことの証明ではない\n")
        f.write("\n## 疑いの一覧\n\n")
        if suspects:
            f.write("| ファイル | 作った日 | 疑いの理由 | 確かめた結果 |\n|---|---|---|---|\n")
            for r in suspects:
                f.write(f"| {r['path']} | {r['first_author'][:16]} | {suspect_reason(r, args.min_ratio)} | {checked.get(r['path'], '未確認')} |\n")
        else:
            f.write("なし\n")
        f.write("\n## フォルダごとのまとめ\n\n")
        f.write("| フォルダ | 本数 | 最初の日(早い) | 最初の日(遅い) | 日付が期間前 | 同一 | 行が重なる |\n|---|---|---|---|---|---|---|\n")
        for k in sorted(groups):
            g = groups[k]
            d = sorted(r["first_author"] for r in g if r["first_author"])
            pre = sum(r["pre_period"] == "yes" for r in g)
            ex_ = sum(bool(r["exact"]) for r in g)
            rt = sum(1 for r in g if r["ratio"] and float(r["ratio"]) >= args.min_ratio)
            f.write(f"| {k} | {len(g)} | {d[0][:16] if d else ''} | {d[-1][:16] if d else ''} | {pre} | {ex_} | {rt} |\n")
        f.write("\n## ファイルごとの表\n\n")
        f.write("| ファイル | 作った日 | 記録した日 | 最初のコミット | 期間前 | いちばん近い物との行の重なり |\n|---|---|---|---|---|---|\n")
        for r in rows:
            f.write(f"| {r['path']} | {r['first_author'][:16]} | {r['first_commit'][:16]} | {r['hash'][:7]} | {r['pre_period']} | {r['ratio']} |\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".", help="調べるリポジトリ(既定: いま)")
    ap.add_argument("--ref", default="HEAD", help="調べる版(既定: HEAD)")
    ap.add_argument("--period-start", default="2026-11-02T12:00:00+09:00",
                    help="期間の開始(ISO 8601。既定: 2026-11-02T12:00:00+09:00)")
    ap.add_argument("--compare", action="append", default=[], metavar="札=フォルダ",
                    help="期間前の別の場所。何本でも")
    ap.add_argument("--exclude", action="append", default=[], metavar="フォルダ名",
                    help="比べる相手の中で飛ばすフォルダ名。何本でも")
    ap.add_argument("--min-ratio", type=float, default=0.8, help="疑いにする行の重なり(既定 0.8)")
    ap.add_argument("--out", default="provenance.tsv", help="TSV の出力先")
    ap.add_argument("--md", default="provenance.md", help="Markdown の出力先")
    ap.add_argument("--depth", type=int, default=2, help="Markdown のまとめのフォルダの深さ(既定 2)")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--public-md", default="", help="公開してよい形の Markdown(比べた相手の名前とパスを出さない)")
    ap.add_argument("--checked", action="append", default=[], metavar="ファイル=理由",
                    help="中身を読んで、期間前の物ではないと確かめた疑い。公開の表に理由を出す")
    args = ap.parse_args()

    repo = args.repo
    EXTRA_SKIP.update(args.exclude)
    start = parse_dt(args.period_start)
    cutoff_ts = start.timestamp()
    cutoff_git = start.isoformat()

    # 追跡ファイル(blob の sha つき)
    raw = git(repo, "ls-tree", "-r", "-l", "-z", args.ref).decode("utf-8", "replace")
    entries = []
    for ent in raw.split("\0"):
        if not ent.strip():
            continue
        meta, _, path = ent.partition("\t")
        parts = meta.split()
        if len(parts) >= 4 and parts[1] == "blob":
            entries.append((path, parts[2], int(parts[3]) if parts[3].isdigit() else 0))
    entries.sort()

    WANT_SIZES.update(z for p, _, z in entries if not is_text_name(p) and z > 0)

    # 比べる相手を集める
    corpus = Corpus()
    for spec in args.compare:
        label, _, root = spec.partition("=")
        if not root or not os.path.isdir(root):
            print(f"[skip] {spec}: フォルダが見つかりません", file=sys.stderr)
            continue
        if os.path.isdir(os.path.join(root, ".git")):
            corpus.add_git(label, root, cutoff_git)
        else:
            corpus.add_tree(label, root, cutoff_ts)

    # 最初のコミット
    def job(e):
        path = e[0]
        on_ref = first_added(repo, args.ref, path, False)
        anyref = first_added(repo, args.ref, path, True)
        return path, on_ref, anyref

    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        firsts = {p: (a, b) for p, a, b in ex.map(job, entries)}

    # 中身の比べ
    texts = {}
    want = [(p, s) for p, s, z in entries if is_text_name(p) and z <= MAX_TEXT]
    blobs = read_blobs(repo, [s for _, s in want]) if corpus.files else {}
    for p, s in want:
        if s in blobs:
            texts[p] = norm_lines(blobs[s])

    rows = []
    for path, sha, size in entries:
        a, b = firsts[path]
        fa = parse_dt(a["author"]) if a else None
        fc = parse_dt(a["commit"]) if a else None
        fany = None
        if b:
            fany = min(parse_dt(b["author"]), parse_dt(b["commit"]))
        pre = "yes" if (fa and fa < start) or (fc and fc < start) or (fany and fany < start) else "no"
        exact = corpus.sha_src.get(sha, "") if size > 0 else ""   # 空のファイルは同じで当たり前
        best, ratio = corpus.best(texts.get(path)) if path in texts else (None, 0.0)
        nm, nr = ("", None)
        if os.path.basename(path) not in GENERIC:
            nm, nr = corpus.same_name(os.path.basename(path), texts.get(path))
        hint = ""
        if path in texts:
            try:
                head = blobs[sha].decode("utf-8", "replace").splitlines()[:30]
                for ln in head:
                    if HINT_RE.search(ln):
                        hint = ln.strip()[:120]
                        break
            except KeyError:
                pass
        rows.append({
            "path": path, "size": size,
            "kind": "text" if is_text_name(path) else "binary",
            "first_author": a["author"] if a else "", "first_commit": a["commit"] if a else "",
            "hash": a["hash"] if a else "", "first_any": fany.isoformat() if fany else "",
            "pre_period": pre, "exact": exact,
            "best_match": best or "", "ratio": f"{ratio:.2f}" if best else "",
            "same_name": nm or "", "same_name_ratio": f"{nr:.2f}" if nr is not None else "",
            "hint": hint, "subject": a["subject"] if a else "",
        })

    cols = ["path", "size", "kind", "first_author", "first_commit", "hash", "first_any",
            "pre_period", "exact", "best_match", "ratio", "same_name", "same_name_ratio", "hint", "subject"]
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        f.write("\t".join(cols) + "\n")
        for r in rows:
            f.write("\t".join(str(r[c]).replace("\t", " ").replace("\n", " ") for c in cols) + "\n")

    # Markdown
    suspects = [r for r in rows if r["pre_period"] == "yes" or r["exact"]
                or (r["ratio"] and float(r["ratio"]) >= args.min_ratio)
                or (r["same_name_ratio"] and float(r["same_name_ratio"]) >= args.min_ratio) or r["hint"]]
    groups = defaultdict(list)
    for r in rows:
        groups[folder_key(r["path"], args.depth)].append(r)
    firsts_all = sorted(r["first_author"] for r in rows if r["first_author"])
    with open(args.md, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"# 期間と由来の表\n\n")
        f.write(f"- 調べた版: `{args.ref}`、ファイル {len(rows)} 本\n")
        f.write(f"- 期間の開始: {start.isoformat()}\n")
        if firsts_all:
            f.write(f"- 最初に入った日の幅: {firsts_all[0]} 〜 {firsts_all[-1]}\n")
        f.write(f"- 期間前の疑い(日付が前・同一・行が {args.min_ratio:.0%} 以上重なる・手がかりの行): {len(suspects)} 本\n")
        for n in corpus.notes:
            f.write(f"- 比べた相手 {n}\n")
        f.write("\n## フォルダごとのまとめ\n\n")
        f.write("| フォルダ | 本数 | 最初の日(早い) | 最初の日(遅い) | 日付が期間前 | 同一 | 行が重なる | 手がかり |\n|---|---|---|---|---|---|---|---|\n")
        for k in sorted(groups):
            g = groups[k]
            d = sorted(r["first_author"] for r in g if r["first_author"])
            pre = sum(r["pre_period"] == "yes" for r in g)
            ex_ = sum(bool(r["exact"]) for r in g)
            rt = sum(1 for r in g if r["ratio"] and float(r["ratio"]) >= args.min_ratio)
            hn = sum(bool(r["hint"]) for r in g)
            f.write(f"| {k} | {len(g)} | {d[0][:16] if d else ''} | {d[-1][:16] if d else ''} | {pre} | {ex_} | {rt} | {hn} |\n")
        f.write("\n## 疑いの一覧\n\n")
        if suspects:
            f.write("| ファイル | 最初の日(作った日) | 日付が前 | 同一 | 近い物 | 重なり | 手がかり |\n|---|---|---|---|---|---|---|\n")
            for r in suspects:
                f.write(f"| {r['path']} | {r['first_author'][:16]} | {r['pre_period']} | {r['exact']} | {r['best_match']} | {r['ratio']} | {r['hint']} |\n")
        else:
            f.write("なし\n")
        f.write("\n## ファイルごとの表\n\n")
        f.write("| ファイル | 種類 | 作った日 | 記録した日 | コミット | 期間前 | 近い物 | 重なり |\n|---|---|---|---|---|---|---|---|\n")
        for r in rows:
            f.write(f"| {r['path']} | {r['kind']} | {r['first_author'][:16]} | {r['first_commit'][:16]} | {r['hash']} | {r['pre_period']} | {r['best_match']} | {r['ratio']} |\n")

    if args.public_md:
        checked = dict(c.partition("=")[::2] for c in args.checked)
        write_public_md(args, start, rows, suspects, groups, firsts_all, corpus, checked)
    print(f"{len(rows)} ファイル → {args.out}, {args.md}(疑い {len(suspects)} 本)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
