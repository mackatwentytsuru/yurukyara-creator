#!/usr/bin/env python3
"""公開の前に、履歴から社内の語・他の AI の名前・個人のパス・お店や会場のデータ・AI の署名入りの絵を外す(git filter-repo)。

いつも「写し」で書き換える。元のリポジトリ・GitHub には何もしない(push しない。push の命令は最後に表示するだけ)。
本番(土 21:00、本人の OK 済み)も同じ台本で写しを作り、合わせ係が表示された命令で push する。

使い方:
  python tools/rewrite_history.py --source <元のリポジトリ> --work <作業フォルダ(空)> \\
      --rules <置き換えの規則.local.txt> --terms <確かめの語.local.txt> \\
      [--keep main --keep yurukyara-dev --keep archive/three-pillars:before-pivot] \\
      [--drop-paths <外す場所.local.txt>] [--strip-ai-images] [--mailmap <mailmap.local.txt>] [--drop-tags]

  --rules        git filter-repo の --replace-text の形(「literal:元==>先」「regex:元==>先」)。本文とコミットの文の両方に使う。
                 filter-repo は literal の行を全部先に当て、その後に regex の行を書いた順に当てる
  --terms        書き換えた後に 0 件を確かめる語(形は tools/termlist.py: 既定は大文字と小文字を区別しない、
                 cs: は区別、re:・rei: は正規表現)。中身・コミットの文・ファイルの名前の全部で見る
  --keep         残す線。「元:新しい名前」で名前を替える(例 archive/three-pillars:before-pivot)。ほかの線は写しから消す
  --drop-paths   全部の履歴から丸ごと外す場所(1 行 1 つ。/ で終わる行はその下の全部、ほかは fnmatch の形。# は注)
  --strip-ai-images  画像生成の AI の署名(C2PA と「AI が作った」の印・生成の指示の文)が入った絵の版を、全部の履歴から外す
  --mailmap      作者の名前とメールを替える時だけ(本人の答え Q-0053 は「今のメールのまま」なので、本番では使わない)
  規則・語・外す場所・mailmap のファイルには社内の語が入るので、リポジトリに入れない(.local.txt にする)。

する事(順に。どこかで止まったら、そこで終わる。元のリポジトリは変わらない):
  1. 元の全部の線を bundle で控える(backup_all.bundle)
  2. 元を --mirror で写す(mirror.git)。残す線とタグ以外の参照を消す
  3. 残す線の先にあるファイルの一覧から、外す場所を除いた物だけを残し、それ以外を全部の履歴から外す
  4. AI の署名入りの絵の版を探して外し、規則で本文とコミットの文を置き換える(mailmap はある時だけ)
  5. 線の名前を替え、commit-map(古い SHA → 新しい SHA)を作業フォルダに写す
  6. 確かめ: 語(中身・コミットの文・ファイルの名前)が 0 件、AI の署名入りの絵が 0 件、
     残す線の先のファイルが「前 − 外すと決めた物」と同じ、線ごとのコミットの数
  7. report.json と、本番で使う push の命令(と、GitHub から消す古い線)を出す
終わりの番号: 0 = 全部 0 件で済んだ、1 = 何か残った(report.json を見る)、2 = 動かせない
"""
import argparse
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import termlist  # noqa: E402

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
IMAGE_MAGIC = (b"\x89PNG", b"\xff\xd8\xff", b"RIFF", b"GIF8")
# C2PA(内容の出どころの署名)の箱の印と、その中の「AI が作った」を示す語
C2PA_MARKS = (b"c2pa", b"caBX", b"jumb")
AI_MARKS = (b"trainedAlgorithmicMedia", b"OpenAI", b"ChatGPT", b"gpt-image", b"DALL-E", b"DALL\xc2\xb7E",
            b"Gemini", b"Imagen", b"Firefly", b"Midjourney", b"SynthID")
# 画像生成の道具が PNG の文の箱に書く「生成の指示」(prompt・workflow・parameters)
GEN_TEXT = tuple(kind + key + b"\x00" for kind in (b"tEXt", b"iTXt", b"zTXt") for key in (b"parameters", b"prompt", b"workflow"))


def run(args, cwd=None, check=True, capture=True):
    p = subprocess.run(args, cwd=cwd, capture_output=capture, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(args[:4])} … が失敗しました: {(p.stderr or '').strip()[:400]}")
    return p.stdout if capture else ""


def git(cwd, *args, check=True):
    return run(["git", "-c", "core.quotepath=off", *args], cwd=cwd, check=check)


def ai_signed(data):
    """画像のバイト列に、画像生成の AI の印があるか(C2PA の箱+AI の語、IPTC の「AI が作った」、生成の指示の文)"""
    if not data.startswith(IMAGE_MAGIC):
        return False
    if b"trainedAlgorithmicMedia" in data:
        return True
    if any(m in data for m in C2PA_MARKS) and any(m in data for m in AI_MARKS):
        return True
    return any(m in data for m in GEN_TEXT)


def find_ai_images(repo, refs):
    """refs から辿れる全部の絵の版のうち、AI の印がある物 → {blob の id: [場所]}"""
    out = git(repo, "rev-list", "--objects", *refs)
    cand = {}
    for line in out.splitlines():
        sha, _, path = line.partition(" ")
        if path and path.lower().endswith(IMAGE_EXT):
            cand.setdefault(sha, set()).add(path)
    found = {}
    if not cand:
        return found
    p = subprocess.Popen(["git", "cat-file", "--batch"], cwd=repo, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for sha, paths in cand.items():
            p.stdin.write((sha + "\n").encode())
            p.stdin.flush()
            header = p.stdout.readline().split()
            if len(header) < 3 or header[1] != b"blob":
                continue
            data = p.stdout.read(int(header[2]))
            p.stdout.read(1)
            if ai_signed(data):
                found[sha] = sorted(paths)
    finally:
        p.stdin.close()
        p.wait()
    return found


def load_drop_patterns(path):
    if not path:
        return []
    with open(path, encoding="utf-8") as f:
        return [t.strip() for t in f if t.strip() and not t.lstrip().startswith("#")]


def dropped_by(path, patterns):
    for pat in patterns:
        if pat.endswith("/") and path.startswith(pat):
            return pat
        if fnmatch.fnmatchcase(path, pat):
            return pat
    return None


def scan_terms(repo, pats):
    """全部の線の全部のコミットで、足された行とコミットの文を 1 回で流し読みし、語ごとの件数を返す(中身は出さない)。"""
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
                row = hits.setdefault(name, {"content": 0, "message": 0, "path": 0})
                row[where] += 1
    proc.wait()
    return hits


def scan_path_names(repo, pats, hits):
    """履歴に出たことのある全部のファイルの名前を見る(中身の置き換えでは名前は替わらないため)"""
    names = set(git(repo, "log", "--all", "--format=", "--name-only").splitlines())
    for ref in git(repo, "for-each-ref", "--format=%(refname)").splitlines():
        names.update(git(repo, "ls-tree", "-r", "--name-only", ref).splitlines())
    for n in names:
        if not n:
            continue
        for name, rx in pats:
            if rx.search(n):
                row = hits.setdefault(name, {"content": 0, "message": 0, "path": 0})
                row["path"] += 1
    return hits


def tracked(repo, ref):
    return set(git(repo, "ls-tree", "-r", "--name-only", ref).splitlines())


def tip_blobs(repo, ref):
    """線の先のファイル → blob の id"""
    out = {}
    for line in git(repo, "ls-tree", "-r", ref).splitlines():
        meta, _, path = line.partition("	")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == "blob":
            out[path] = parts[2]
    return out


def parse_keep(items):
    pairs = []
    for k in items or ["main", "yurukyara-dev"]:
        old, _, new = k.partition(":")
        pairs.append((old, new or old))
    return pairs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--terms", required=True)
    ap.add_argument("--mailmap", default="")
    ap.add_argument("--keep", action="append", default=[])
    ap.add_argument("--drop-paths", default="")
    ap.add_argument("--strip-ai-images", action="store_true")
    ap.add_argument("--drop-tags", action="store_true")
    a = ap.parse_args()
    keep = parse_keep(a.keep)
    t0 = time.time()
    steps = {}

    files = [(a.rules, "規則"), (a.terms, "確かめの語")] + ([(a.mailmap, "mailmap")] if a.mailmap else []) \
        + ([(a.drop_paths, "外す場所")] if a.drop_paths else [])
    for path, label in files:
        if not os.path.isfile(path):
            print(f"止めました: {label}のファイルが読めません({path})")
            return 2
    try:
        pats = termlist.load(a.terms)
    except ValueError as e:
        print(f"止めました: {e}")
        return 2
    if not pats:
        print("止めました: 確かめの語が空です")
        return 2
    drops = load_drop_patterns(a.drop_paths)
    if os.path.exists(a.work) and os.listdir(a.work):
        print(f"止めました: 作業フォルダが空ではありません({a.work})")
        return 2
    os.makedirs(a.work, exist_ok=True)
    work = os.path.abspath(a.work)
    src = os.path.abspath(a.source)
    mirror = os.path.join(work, "mirror.git")

    # 1 控え
    s = time.time()
    git(src, "bundle", "create", os.path.join(work, "backup_all.bundle"), "--all")
    steps["1_bundle_s"] = round(time.time() - s, 1)

    # 2 写して、残す線とタグ以外を消す
    s = time.time()
    run(["git", "clone", "-q", "--mirror", "--no-local", src, mirror])
    refs = git(mirror, "for-each-ref", "--format=%(refname)").splitlines()
    kept_refs = [f"refs/heads/{old}" for old, _ in keep]
    missing = [r for r in kept_refs if r not in refs]
    if missing:
        print(f"止めました: 残す線がありません: {missing}")
        return 2
    new_names = [new for _, new in keep]
    clash = [n for n in new_names if new_names.count(n) > 1 or (f"refs/heads/{n}" in refs and f"refs/heads/{n}" not in kept_refs)]
    if clash:
        print(f"止めました: 新しい線の名前が重なります: {sorted(set(clash))}")
        return 2
    remote_branches = sorted({r.split("/", 3)[3] for r in refs if r.startswith("refs/remotes/origin/") and not r.endswith("/HEAD")})
    before_blobs = {old: tip_blobs(mirror, f"refs/heads/{old}") for old, _ in keep}
    before = {old: set(before_blobs[old]) for old, _ in keep}
    commits_before = {old: int(git(mirror, "rev-list", "--count", f"refs/heads/{old}").strip() or 0) for old, _ in keep}
    dropped = []
    for r in refs:
        if r in kept_refs or (r.startswith("refs/tags/") and not a.drop_tags):
            continue
        git(mirror, "update-ref", "-d", r)
        dropped.append(r)
    total_before = int(git(mirror, "rev-list", "--count", "--all").strip() or 0)
    steps["2_mirror_s"] = round(time.time() - s, 1)

    # 3 残す場所(残す線の先にある物 − 外す場所)
    s = time.time()
    union = set().union(*before.values())
    keep_set = sorted(p for p in union if not dropped_by(p, drops))
    intended = {old: sorted(p for p in before[old] if dropped_by(p, drops)) for old, _ in keep}
    keep_paths = os.path.join(work, "keep_paths.txt")
    with open(keep_paths, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(keep_set) + "\n")

    # 4 AI の署名入りの絵を探して外し、規則で置き換える
    ai_before = find_ai_images(mirror, ["--all"]) if a.strip_ai_images else {}
    cmd = [sys.executable, "-m", "git_filter_repo", "--force", "--paths-from-file", keep_paths,
           "--replace-text", os.path.abspath(a.rules), "--replace-message", os.path.abspath(a.rules)]
    if ai_before:
        ids = os.path.join(work, "ai_image_blobs.txt")
        with open(ids, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(sorted(ai_before)) + "\n")
        cmd += ["--strip-blobs-with-ids", ids]
    if a.mailmap:
        cmd += ["--mailmap", os.path.abspath(a.mailmap)]
    run(cmd, cwd=mirror)
    steps["3_filter_s"] = round(time.time() - s, 1)

    # 5 線の名前を替え、commit-map を控える
    for old, new in keep:
        if new != old:
            git(mirror, "branch", "-m", old, new)
    for name in ("commit-map", "ref-map"):
        p = os.path.join(mirror, "filter-repo", name)
        if os.path.isfile(p):
            shutil.copy(p, os.path.join(work, f"{name}.txt"))

    # 6 確かめ
    s = time.time()
    hits = scan_path_names(mirror, pats, scan_terms(mirror, pats))
    ai_after = find_ai_images(mirror, ["--all"])
    branches = {}
    unexpected = {}
    for old, new in keep:
        after = tracked(mirror, f"refs/heads/{new}")
        stripped = sorted(p for p in before[old] - after if not dropped_by(p, drops))
        stripped_ai = [p for p in stripped if before_blobs[old].get(p) in ai_before]
        diff = sorted((before[old] - set(intended[old]) - set(stripped_ai)) ^ after)
        if diff:
            unexpected[new] = diff[:30]
        branches[new] = {
            "from": old,
            "commits_before": commits_before[old],
            "commits_after": int(git(mirror, "rev-list", "--count", f"refs/heads/{new}").strip() or 0),
            "files_before": len(before[old]),
            "files_after": len(after),
            "dropped_by_policy": len(intended[old]),
            "dropped_ai_images": stripped_ai,
        }
    total_after = int(git(mirror, "rev-list", "--count", "--all").strip() or 0)
    emails = sorted(set(git(mirror, "log", "--all", "--format=%ae%n%ce").split()))
    steps["4_verify_s"] = round(time.time() - s, 1)

    left = len(hits) + len(ai_after) + len(unexpected)
    report = {
        "keep": [f"{o}:{n}" if o != n else o for o, n in keep],
        "dropped_refs": len(dropped),
        "commits_before_all": total_before,
        "commits_after_all": total_after,
        "branches": branches,
        "drop_patterns": len(drops),
        "ai_images_found": len(ai_before),
        "ai_images_left": len(ai_after),
        "unexpected_tree_changes": unexpected,
        "terms_checked": len(pats),
        "terms_left": len(hits),
        "mailmap_used": bool(a.mailmap),
        "author_email_kinds": len(emails),
        "seconds": steps,
        "total_seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(work, "report.json"), "w", encoding="utf-8") as f:
        json.dump({**report, "terms_left_detail": hits, "dropped_by_policy_detail": intended,
                   "ai_images_detail": ai_before}, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if left:
        print(f"残りがあります: 語 {len(hits)} 語・AI の署名の絵 {len(ai_after)} 枚・思わぬ木の違い {len(unexpected)} 本"
              "(語の中身は report.json。画面には出さない)")
    print("\n本番で push する時の命令(合わせ係が、本人の OK の後に自分で打つ。この台本は push しない):")
    print(f"  cd {mirror}")
    print("  git remote add public <GitHub の URL>   # 元の origin は --mirror の写しに付いたまま。宛先を確かめてから")
    for _, new in keep:
        print(f"  git push --force public refs/heads/{new}:refs/heads/{new}")
    stale = [b for b in remote_branches if b not in new_names]
    for b in stale:
        print(f"  git push public --delete {b}   # 古い履歴のまま残る線(書き換えていない)。控えは backup_all.bundle")
    print("  # 最後に git ls-remote public で、線が上の物だけ・SHA が写しと同じ事を見る")
    return 1 if left else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f"止めました: {e}")
        sys.exit(2)
