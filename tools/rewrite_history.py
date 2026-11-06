#!/usr/bin/env python3
"""公開の前に、履歴から社内の語・個人のパス・お店のデータを外す(git filter-repo)。

いつも「写し」で書き換える。元のリポジトリ・GitHub には何もしない(push しない。push の命令は最後に表示するだけ)。
本番(土 21:00、本人の OK 済み)も同じ台本で写しを作り、合わせ係が表示された命令で push する。

使い方:
  python tools/rewrite_history.py --source <元のリポジトリ> --work <作業フォルダ(空)> \\
      --rules <置き換えの規則.local.txt> --terms <確かめの語.local.txt> [--mailmap <mailmap.local.txt>] \\
      [--keep main --keep yurukyara-dev] [--drop-tags]

  --rules   git filter-repo の --replace-text の形(「literal:元==>先」「regex:元==>先」)。本文とコミットの文の両方に使う
  --terms   書き換えた後に 0 件を確かめる語(1 行 1 語。「cs:」で始まる行は大文字と小文字を区別する)
  --keep    残す線(既定 main と yurukyara-dev)。ほかの線は写しから消す(元のリポジトリには残る)
  規則・語・mailmap のファイルには社内の語が入るので、リポジトリに入れない(.local.txt にする)。

する事(順に。どこかで止まったら、そこで終わる。元のリポジトリは変わらない):
  1. 元の全部の線を bundle で控える(backup_all.bundle)
  2. 元を --mirror で写す(mirror.git)。残す線とタグ以外の参照を消す
  3. 残す線の先にあるファイルの一覧を作り、それ以外のファイルを全部の履歴から外す(--paths-from-file)
  4. 規則で本文とコミットの文を置き換え、mailmap で作者のメールを替える
  5. commit-map(古い SHA → 新しい SHA)を作業フォルダに写す
  6. 確かめ: 語ごとに `git log --all -S` とコミットの文の件数(0 であること)、残す線のファイルの一覧が前と同じ、コミットの数
  7. report.json と、本番で使う push の命令を出す
終わりの番号: 0 = 語が 0 件で済んだ、1 = 語が残った、2 = 動かせない
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time


def run(args, cwd=None, check=True, capture=True):
    p = subprocess.run(args, cwd=cwd, capture_output=capture, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(args[:4])} … が失敗しました: {(p.stderr or '').strip()[:400]}")
    return p.stdout if capture else ""


def git(cwd, *args, check=True):
    return run(["git", "-c", "core.quotepath=off", *args], cwd=cwd, check=check)


def load_terms(path):
    with open(path, encoding="utf-8") as f:
        return [t.strip() for t in f if t.strip() and not t.lstrip().startswith("#")]


def compile_terms(terms):
    out = []
    for t in terms:
        cs = t.startswith("cs:")
        word = t[3:] if cs else t
        out.append((t, re.compile(re.escape(word), 0 if cs else re.I)))
    return out


def scan_terms(repo, terms):
    """全部の線の全部のコミットで、足された行とコミットの文を 1 回で流し読みし、語ごとの件数を返す(中身は出さない)。"""
    pats = compile_terms(terms)
    cmd = ["git", "-c", "core.quotepath=off", "log", "--all", "-p", "--no-color", "--no-ext-diff", "--unified=0",
           "--format=@@@COMMIT %H%n%B"]
    proc = subprocess.Popen(cmd, cwd=repo, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    hits = {}
    in_body = True
    for line in proc.stdout:
        if line.startswith("@@@COMMIT "):
            in_body = True
            continue
        if line.startswith("diff --git "):
            in_body = False
            continue
        if not in_body and (not line.startswith("+") or line.startswith("+++ ")):
            continue
        where = "message" if in_body else "content"
        for name, rx in pats:
            if rx.search(line):
                row = hits.setdefault(name, {"content": 0, "message": 0})
                row[where] += 1
    proc.wait()
    return hits


def tracked(repo, ref):
    return set(git(repo, "ls-tree", "-r", "--name-only", ref).splitlines())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--terms", required=True)
    ap.add_argument("--mailmap", default="")
    ap.add_argument("--keep", action="append", default=[])
    ap.add_argument("--drop-tags", action="store_true")
    a = ap.parse_args()
    keep = a.keep or ["main", "yurukyara-dev"]
    t0 = time.time()
    steps = {}

    for path, label in [(a.rules, "規則"), (a.terms, "確かめの語")] + ([(a.mailmap, "mailmap")] if a.mailmap else []):
        if not os.path.isfile(path):
            print(f"止めました: {label}のファイルが読めません({path})")
            return 2
    terms = load_terms(a.terms)
    if not terms:
        print("止めました: 確かめの語が空です")
        return 2
    if os.path.exists(a.work) and os.listdir(a.work):
        print(f"止めました: 作業フォルダが空ではありません({a.work})")
        return 2
    os.makedirs(a.work, exist_ok=True)
    src = os.path.abspath(a.source)
    mirror = os.path.join(a.work, "mirror.git")

    # 1 控え
    s = time.time()
    git(src, "bundle", "create", os.path.join(os.path.abspath(a.work), "backup_all.bundle"), "--all")
    steps["1_bundle_s"] = round(time.time() - s, 1)

    # 2 写して、残す線とタグ以外を消す
    s = time.time()
    run(["git", "clone", "-q", "--mirror", "--no-local", src, mirror])
    refs = git(mirror, "for-each-ref", "--format=%(refname)").splitlines()
    kept_refs = [f"refs/heads/{b}" for b in keep]
    missing = [r for r in kept_refs if r not in refs]
    if missing:
        print(f"止めました: 残す線がありません: {missing}")
        return 2
    before = {b: tracked(mirror, f"refs/heads/{b}") for b in keep}
    dropped = []
    for r in refs:
        if r in kept_refs or (r.startswith("refs/tags/") and not a.drop_tags):
            continue
        git(mirror, "update-ref", "-d", r)
        dropped.append(r)
    commits_before = int(git(mirror, "rev-list", "--count", "--all").strip() or 0)
    steps["2_mirror_s"] = round(time.time() - s, 1)

    # 3・4 書き換え
    s = time.time()
    keep_paths = os.path.join(a.work, "keep_paths.txt")
    with open(keep_paths, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(sorted(set().union(*before.values()))) + "\n")
    cmd = [sys.executable, "-m", "git_filter_repo", "--force", "--paths-from-file", os.path.abspath(keep_paths),
           "--replace-text", os.path.abspath(a.rules), "--replace-message", os.path.abspath(a.rules)]
    if a.mailmap:
        cmd += ["--mailmap", os.path.abspath(a.mailmap)]
    run(cmd, cwd=mirror)
    steps["3_filter_s"] = round(time.time() - s, 1)

    # 5 commit-map
    cm = os.path.join(mirror, "filter-repo", "commit-map")
    if os.path.isfile(cm):
        shutil.copy(cm, os.path.join(a.work, "commit-map.txt"))

    # 6 確かめ
    s = time.time()
    hits = scan_terms(mirror, terms)
    after = {b: tracked(mirror, f"refs/heads/{b}") for b in keep}
    same_files = {b: sorted(before[b] ^ after[b])[:20] for b in keep if before[b] != after[b]}
    commits_after = int(git(mirror, "rev-list", "--count", "--all").strip() or 0)
    emails = sorted(set(git(mirror, "log", "--all", "--format=%ae%n%ce").split()))
    steps["4_verify_s"] = round(time.time() - s, 1)

    report = {
        "keep": keep,
        "dropped_refs": len(dropped),
        "commits_before": commits_before,
        "commits_after": commits_after,
        "files_changed_names": same_files,
        "terms_checked": len(terms),
        "terms_left": len(hits),
        "author_email_kinds": len(emails),
        "author_emails_noreply": all(e.endswith("@users.noreply.github.com") for e in emails),
        "seconds": steps,
        "total_seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(a.work, "report.json"), "w", encoding="utf-8") as f:
        json.dump({**report, "terms_left_detail": hits}, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if hits:
        print(f"語が残っています: {len(hits)} 語(中身は report.json。画面には出さない)")
    print("\n本番で push する時の命令(合わせ係が、本人の OK の後に自分で打つ。この台本は push しない):")
    print(f"  cd {mirror}")
    print("  git remote add public <GitHub の URL>   # 元の origin は --mirror の写しに付いたまま。宛先を確かめてから")
    for b in keep:
        print(f"  git push --force public refs/heads/{b}:refs/heads/{b}")
    print("  # 保管の線を GitHub から外すと決まった時だけ: git push public --delete before-pivot")
    return 1 if hits else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f"止めました: {e}")
        sys.exit(2)
