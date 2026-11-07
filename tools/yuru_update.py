#!/usr/bin/env python3
"""ゆるキャラクリエイターを新しい版にする道具。あなたのキャラ・性格・声・記憶・設定は消しません。

使い方(リポジトリの頭のフォルダで):
  python tools/yuru_update.py check [--quiet] [--once-a-day]  新しい版があるかを見る
  python tools/yuru_update.py apply [--rename 今のid=新しいid]  控えを取ってから、新しい版にする
  python tools/yuru_update.py undo                             いちばん新しい控えの時に戻す
  python tools/yuru_update.py status                           今の版・線・最後に見た時・いちばん新しい控え

- Python 3 の標準の物だけで動く(Windows・macOS・Linux)。git とネットの呼び出しには、どれも時間の上限がある。
- 鍵のファイル(web/.env など)は、名前を控えに書くだけ。中身は読まない・写さない・出さない。
- 使う人の物(自分のキャラ・記憶・設定・作る道の途中の物)は、消さない・上書きしない。
- 終わりの番号: 0 = できた(新しい版にした・もう新しい・見た)、1 = 何も変えずに止めた、3 = 途中で止まったので元に戻した。
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
STATE_FILE = ".yuru_update.json"   # 最後に見た時(git に入れない)
BACKUP_DIR = "backups"              # 控え(git に入れない)
VERSION_FILE = "VERSION"
NEWS_FILE = "docs/できるようになったこと.md"
OFFERS = "creator/review/upgrade_offers.py"
DOCTOR = "creator/setup/doctor.py"
WEB_LOCK = "web/package-lock.json"

# 使う人の物が入る所。ここの、git が見張っていないファイルは、全部その人の物として控えに入れる
USER_DIRS = ("characters", "creator/work", "creator/viewer/assets_local", "web/logs")
USER_FILES = ("creator/env.local.sh",)
# 鍵のファイル。名前だけを控えに書く(git は触らないので、その場所に残る)
KEY_FILE = re.compile(r"(^|/)\.env(\.[\w.-]+)?$")
KEY_SAMPLE = re.compile(r"\.(example|sample)$")
KEY_DIRS = (".vercel",)
SKIP_PARTS = {".git", "node_modules", "__pycache__"}
ID_FORM = re.compile(r"^[a-z0-9_]{1,32}$")
REQ_FILE = re.compile(r"(^|/)(requirements[^/]*\.txt|pyproject\.toml)$")
NEWS_HEAD = re.compile(r"^##\s*v?(\d+(?:\.\d+){1,3})(.*)$")
MERGE_MARKS = ("MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")

GIT_TIMEOUT = 60
FETCH_TIMEOUT = 30
QUIET_FETCH_TIMEOUT = 7     # 起動の時のおしらせ(10 秒の中で終わらせる)
MERGE_TIMEOUT = 120
NPM_TIMEOUT = 900
TOOL_TIMEOUT = 120
DOCTOR_TIMEOUT = 60
NODE_TIMEOUT = 30

UNDO_HINT = "元に戻すときは「元に戻して」と言うか、python tools/yuru_update.py undo"


class Stop(Exception):
    """何も変えずに止める(やさしい文つき)"""

    def __init__(self, msg, code=1):
        super().__init__(msg)
        self.msg, self.code = msg, code


class Offline(Exception):
    """新しい版の所に届かなかった"""


# ---------- 小さな道具 ----------

def say(text=""):
    print(text, flush=True)


def now():
    return datetime.datetime.now().astimezone()


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def absp(relpath):
    return os.path.join(ROOT, *relpath.split("/"))


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def child_env():
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "PYTHONIOENCODING": "utf-8"})
    return env


def run(cmd, timeout, cwd=None, env=None):
    """外の命令を時間の上限つきで流す。(番号, 出力) を返す。時間切れは TimeoutError"""
    try:
        p = subprocess.run(cmd, cwd=cwd or ROOT, env=env or child_env(), stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise TimeoutError(str(cmd[:2])) from e
    return p.returncode, p.stdout.decode("utf-8", "replace")


def git(*args, timeout=GIT_TIMEOUT, ok=(0,)):
    """git を流す。失敗は RuntimeError(文は外に出さない。鍵の入った住所が混じることがあるため)"""
    exe = shutil.which("git")
    if not exe:
        raise FileNotFoundError("git")
    env = child_env()
    if "GIT_SSH_COMMAND" not in env and "GIT_SSH" not in env:
        env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o ConnectTimeout=5"
    try:
        p = subprocess.run([exe, "-c", "core.quotepath=false", *args], cwd=ROOT, env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise TimeoutError("git " + args[0]) from e
    if p.returncode not in ok:
        raise RuntimeError(f"git {args[0]} ({p.returncode})")
    return p.stdout.decode("utf-8", "replace")


def git_z(*args):
    return [x for x in git(*args, "-z").split("\0") if x]


# ---------- 版と「できるようになったこと」 ----------

def parse_version(v):
    m = re.match(r"^v?(\d+(?:\.\d+){1,3})$", (v or "").strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def local_version():
    try:
        with open(absp(VERSION_FILE), encoding="utf-8") as f:
            return f.read().strip() or "dev"
    except OSError:
        return "dev"


def version_at(commit):
    try:
        return git("show", f"{commit}:{VERSION_FILE}").strip() or "dev"
    except RuntimeError:
        return "dev"


def is_newer(theirs, ours):
    t, o = parse_version(theirs), parse_version(ours)
    if t is None:
        return False
    return o is None or t > o


def news_sections(text):
    out, cur = [], None
    for line in text.splitlines():
        s = line.strip()
        m = NEWS_HEAD.match(s)
        if m:
            cur = {"version": m.group(1), "title": s[2:].strip(), "lines": []}
            out.append(cur)
        elif s.startswith("#"):
            cur = None
        elif cur is not None and s[:1] in "-*" and len(s) > 1:
            cur["lines"].append(s)
    return out


def news_between(text, low, high):
    """low より新しく high まで(両方とも版の文字)の節。low が読めない時は、いちばん新しい節だけ"""
    lo, hi = parse_version(low), parse_version(high)
    secs = news_sections(text)
    if lo is None:
        return secs[:1]
    return [s for s in secs if parse_version(s["version"]) > lo and (hi is None or parse_version(s["version"]) <= hi)]


def show_news(secs):
    if not secs:
        return
    say("新しくできるようになったこと:")
    for s in secs:
        say(f"  {s['title']}")
        for line in s["lines"]:
            say(f"    {line}")


# ---------- 今のようす ----------

def is_clone():
    if not os.path.exists(os.path.join(ROOT, ".git")):
        return False
    try:
        return git("rev-parse", "--is-inside-work-tree").strip() == "true" and \
            os.path.samefile(git("rev-parse", "--show-toplevel").strip(), ROOT)
    except (RuntimeError, TimeoutError, FileNotFoundError, OSError):
        return False


def busy_with_merge():
    for mark in MERGE_MARKS:
        try:
            p = git("rev-parse", "--git-path", mark).strip()
        except RuntimeError:
            continue
        if os.path.exists(p if os.path.isabs(p) else os.path.join(ROOT, p)):
            return True
    return False


def branch_info():
    """(線の名前, 取り先の名前, 取り先の remote)。取り先が無ければ None"""
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    if branch == "HEAD":
        return None, None, None
    try:
        up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").strip()
        remote = git("config", "--get", f"branch.{branch}.remote").strip()
    except RuntimeError:
        return branch, None, None
    return branch, up, remote


def fetch(remote, quiet=False):
    try:
        git("fetch", "--quiet", "--no-tags", remote, timeout=QUIET_FETCH_TIMEOUT if quiet else FETCH_TIMEOUT)
    except (RuntimeError, TimeoutError) as e:
        raise Offline() from e


def state_path():
    return os.path.join(ROOT, STATE_FILE)


def load_state():
    return read_json(state_path(), {}) or {}


def save_state(**kw):
    st = load_state()
    st.update(kw)
    try:
        write_json(state_path(), st)
    except OSError:
        pass


def backups():
    """控えの一覧(新しい順)。[(名前, manifest)]"""
    base = absp(BACKUP_DIR)
    if not os.path.isdir(base):
        return []
    out = []
    for name in sorted(os.listdir(base), reverse=True):
        man = read_json(os.path.join(base, name, "manifest.json"))
        if isinstance(man, dict) and man.get("tool") == "yuru_update":
            out.append((name, man))
    return out


# ---------- 使う人の物の地図 ----------

def tracked_set():
    return set(git_z("ls-files"))


def walk_files(relroot):
    top = absp(relroot)
    if os.path.isfile(top):
        yield relroot
        return
    for d, dirs, files in os.walk(top):
        dirs[:] = [x for x in dirs if x not in SKIP_PARTS]
        for f in files:
            yield rel(os.path.join(d, f))


def is_key_file(path):
    return bool(KEY_FILE.search(path)) and not KEY_SAMPLE.search(path)


def key_files():
    found = []
    for d in ("", "web", "creator"):
        base = absp(d) if d else ROOT
        if os.path.isdir(base):
            for name in sorted(os.listdir(base)):
                p = f"{d}/{name}" if d else name
                if is_key_file(p) and os.path.isfile(absp(p)):
                    found.append(p)
    found += [d + "/" for d in KEY_DIRS if os.path.isdir(absp(d))]
    return found


def user_files(tracked):
    """使う人の物(git が見張っていないファイル)。鍵のファイル・控え・おしらせの記録は入れない"""
    paths = set()
    for d in USER_DIRS + USER_FILES:
        if os.path.exists(absp(d)):
            paths.update(walk_files(d))
    paths.update(git_z("ls-files", "--others", "--exclude-standard"))
    keep = []
    for p in sorted(paths):
        if p in tracked or is_key_file(p) or p == STATE_FILE or p.startswith(BACKUP_DIR + "/"):
            continue
        if any(part in SKIP_PARTS for part in p.split("/")) or p.endswith(".tmp"):
            continue
        if os.path.isfile(absp(p)):
            keep.append(p)
    return keep


def my_character_ids(tracked):
    """characters/ の中で、git の見張る物が 1 つも無いフォルダ = その人が作ったキャラ"""
    base = absp("characters")
    if not os.path.isdir(base):
        return []
    sample = {p.split("/")[1] for p in tracked if p.startswith("characters/") and p.count("/") >= 2}
    return sorted(n for n in os.listdir(base) if os.path.isdir(os.path.join(base, n)) and n not in sample)


def tracked_changes():
    """見張られているファイルのうち、その人が変えた物。[(path, 'changed'|'deleted'|'added')]"""
    out = []
    items = git_z("status", "--porcelain=v1", "--untracked-files=no")
    i = 0
    while i < len(items):
        entry = items[i]
        xy, path = entry[:2], entry[3:]
        if "R" in xy or "C" in xy:
            i += 1  # 名前を替えた時は、次に前の名前が来る
        if xy[0] == "A":
            out.append((path, "added"))
        elif os.path.isfile(absp(path)):
            out.append((path, "changed"))
        else:
            out.append((path, "deleted"))
        i += 1
    return out


def incoming(head, target):
    """head から target までで変わったファイル {path: 'A'|'M'|'D'...}"""
    items = git_z("diff", "--name-status", "--no-renames", head, target)
    return {items[i + 1]: items[i] for i in range(0, len(items) - 1, 2)}


# ---------- check ----------

def cmd_check(args):
    if args.once_a_day:
        last = load_state().get("last_try", "")
        if last[:10] == now().date().isoformat():
            if not args.quiet:
                say("今日はもう確かめました。もう一度見るときは --once-a-day を付けずに流してください。")
            return 0
    if not shutil.which("git") or not is_clone():
        if not args.quiet:
            say("このフォルダは git clone で取ってきた物ではないので、新しい版を自動では確かめられません。")
            say("新しい版は、取ってきた所からもう一度取ってください。そのときは、自分のキャラ(characters/ の中の自分の子)を先に別の場所へ写してください。")
        return 0
    branch, up, remote = branch_info()
    if not up:
        if not args.quiet:
            where = f"今の線({branch})" if branch else "今の所"
            say(f"{where}には、新しい版の取り先が決まっていないので、確かめられません。")
        return 0
    save_state(last_try=now().isoformat(timespec="seconds"))
    try:
        fetch(remote, quiet=args.quiet)
    except Offline:
        if not args.quiet:
            say("いまは新しい版を確かめられませんでした(ネットにつながっていないか、取り先が答えませんでした)。あとでもう一度ためしてください。")
        return 0
    ours, target = local_version(), git("rev-parse", "@{u}").strip()
    theirs = version_at(target)
    ahead = int(git("rev-list", "--count", f"HEAD..{target}").strip() or 0)
    save_state(last_check=now().isoformat(timespec="seconds"), latest=theirs)
    if args.quiet:
        if is_newer(theirs, ours) and ahead:
            say(f"ゆるキャラクリエイターの新しい版 {theirs} があります(今は {ours})。「アップデートして」と言うと、キャラを消さずに新しくできます。")
        return 0
    say(f"今の版: {ours}")
    if not ahead:
        say("いちばん新しい版です。")
        return 0
    if is_newer(theirs, ours):
        say(f"新しい版 {theirs} があります。")
    else:
        say(f"小さな直しが {ahead} 個あります(版は {theirs} のまま)。")
    try:
        show_news(news_between(git("show", f"{target}:{NEWS_FILE}"), ours, theirs))
    except RuntimeError:
        pass
    say("「アップデートして」と言うか、python tools/yuru_update.py apply で新しくできます。")
    say("あなたのキャラ・性格・声・記憶・設定は消えません。先に控えを取り、あとで元に戻すこともできます。")
    return 0


# ---------- apply ----------

def ready_to_change():
    """変える前の確かめ。(線, 取り先, remote)"""
    if not shutil.which("git"):
        raise Stop("git が見つからないので、新しくできません。git を入れてから、もう一度ためしてください。")
    if not is_clone():
        raise Stop("このフォルダは git clone で取ってきた物ではないので、自動では新しくできません。")
    if busy_with_merge():
        raise Stop("いま git の別の作業(合わせる・付け直す)の途中なので、何も変えずに止めました。その作業を終えてから、もう一度ためしてください。")
    branch, up, remote = branch_info()
    if not branch:
        raise Stop("今は決まった線の上にいないので、自動では新しくできません。")
    if not up:
        raise Stop(f"今の線({branch})には、新しい版の取り先が決まっていないので、自動では新しくできません。")
    return branch, up, remote


def parse_renames(pairs):
    out = {}
    for pair in pairs or []:
        old, sep, new = pair.partition("=")
        if not sep or not ID_FORM.match(old) or not ID_FORM.match(new) or old == new:
            raise Stop(f"--rename は「今のid=新しいid」の形で書いてください(英小文字・数字・_ だけ): {pair}")
        out[old] = new
    return out


def collisions(tracked, changes_in, mine):
    added = [p for p, st in changes_in.items() if st.startswith("A")]
    new_ids = {p.split("/")[1] for p in added if p.startswith("characters/") and p.count("/") >= 2}
    same_ids = sorted(set(mine) & new_ids)
    return same_ids, new_ids, added


def check_renames(renames, same_ids, new_ids, mine, tracked):
    taken = set(os.listdir(absp("characters"))) if os.path.isdir(absp("characters")) else set()
    for old, new in renames.items():
        if old not in mine:
            raise Stop(f"「{old}」は、あなたが作ったキャラの中にありません。名前を確かめてください。")
        if new in taken or new in new_ids or any(p.startswith(f"characters/{new}/") for p in tracked):
            raise Stop(f"「{new}」は、もう使われている名前です。別の名前にしてください。")
    left = [i for i in same_ids if i not in renames]
    if left:
        lines = [f"新しい版に、あなたのキャラと同じ名前の見本のキャラが入ります: {', '.join(left)}",
                 "このままだと、あなたのキャラと見本がぶつかるので、何も変えずに止めました(あなたのキャラはそのままです)。",
                 "あなたのキャラの名前を替えてから進められます。いいときは、次のように頼んでください:"]
        lines += [f"  python tools/yuru_update.py apply --rename {i}={i}_mine" for i in left]
        lines.append("(名前を替えると、性格の画面で選んだ物は、もう一度選ぶことになります)")
        raise Stop("\n".join(lines))


def make_backup(head, branch, up, target, ours, theirs, files, changes):
    stamp = now().strftime("%Y%m%d-%H%M%S")
    name, n = stamp, 2
    while os.path.exists(absp(f"{BACKUP_DIR}/{name}")):
        name, n = f"{stamp}-{n}", n + 1
    base = absp(f"{BACKUP_DIR}/{name}")
    need = sum(os.path.getsize(absp(p)) for p in files) + sum(
        os.path.getsize(absp(p)) for p, k in changes if k != "deleted")
    free = shutil.disk_usage(ROOT).free
    if free < need * 2 + 200 * 1024 * 1024:
        raise Stop("ディスクの空きが足りないので、控えを取れません。何も変えずに止めました。空きを作ってから、もう一度ためしてください。")
    man = {
        "tool": "yuru_update", "made": now().isoformat(timespec="seconds"), "status": "started",
        "from_commit": head, "from_version": ours, "branch": branch, "upstream": up,
        "to_commit": target, "to_version": theirs,
        "user_files": [], "tracked_changes": [], "keys_left_in_place": key_files(),
        "renamed": [], "kept_new_version": [], "after": {},
    }
    for p in files:
        dst = os.path.join(base, "files", *p.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(absp(p), dst)
        digest = sha256_of(absp(p))
        if sha256_of(dst) != digest:
            raise Stop(f"控えを写した物が元と合わないので、止めました: {p}")
        man["user_files"].append({"path": p, "sha256": digest, "size": os.path.getsize(absp(p))})
    for p, kind in changes:
        item = {"path": p, "kind": kind}
        if kind != "deleted":
            dst = os.path.join(base, "tracked", *p.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(absp(p), dst)
            item["sha256"] = sha256_of(absp(p))
            if sha256_of(dst) != item["sha256"]:
                raise Stop(f"控えを写した物が元と合わないので、止めました: {p}")
        man["tracked_changes"].append(item)
    write_json(os.path.join(base, "manifest.json"), man)
    return name, base, man


def rename_character(old, new):
    src, dst = absp(f"characters/{old}"), absp(f"characters/{new}")
    os.rename(src, dst)
    cj = os.path.join(dst, "character.json")
    data = read_json(cj)
    if isinstance(data, dict) and data.get("id") == old:
        data["id"] = new
        write_json(cj, data)


def put_back_tracked(base, man, skip=()):
    """控えから、その人が変えた見張られたファイルを戻す"""
    for item in man["tracked_changes"]:
        p = item["path"]
        if p in skip:
            continue
        if item["kind"] == "deleted":
            if os.path.isfile(absp(p)):
                os.remove(absp(p))
        else:
            os.makedirs(os.path.dirname(absp(p)), exist_ok=True)
            shutil.copy2(os.path.join(base, "tracked", *p.split("/")), absp(p))


def renamed_path(p, renamed):
    for r in renamed:
        pre = f"characters/{r['from']}/"
        if p.startswith(pre):
            return f"characters/{r['to']}/" + p[len(pre):]
    return p


def current_hash(p):
    return sha256_of(absp(p)) if os.path.isfile(absp(p)) else None


def after_hashes(man):
    out = {}
    for item in man["user_files"]:
        p = renamed_path(item["path"], man["renamed"])
        out[p] = current_hash(p)
    return out


def run_npm_ci():
    npm = shutil.which("npm")
    if not npm:
        say("・アプリの部品が変わりました。Node.js 22 を入れてから、web のフォルダで npm ci をしてください。")
        return
    say("・アプリの部品が変わったので、入れ直しています(数分かかることがあります)…")
    try:
        code, _ = run([npm, "ci"], NPM_TIMEOUT, cwd=absp("web"))
    except (TimeoutError, OSError):
        code = None
    if code == 0:
        say("  アプリの部品を入れ直しました。")
    else:
        say("  アプリの部品を入れ直せませんでした。web のフォルダで npm ci をしてください。")


def run_python_tool(path, *args, timeout=TOOL_TIMEOUT):
    if not os.path.isfile(absp(path)):
        return None, ""
    try:
        return run([sys.executable, absp(path), *args], timeout)
    except (TimeoutError, OSError):
        return None, ""


def health_check():
    """鍵の要らない、すぐ終わる確かめ。作る道具(doctor.py)と、アプリのサーバーの文が読めるか"""
    lines = []
    if os.path.isfile(absp(DOCTOR)):
        code, _ = run_python_tool(DOCTOR, timeout=DOCTOR_TIMEOUT)
        if code == 0:
            lines.append("キャラを作る道具: そろっています。")
        elif code is None:
            lines.append("キャラを作る道具: 調べるのに時間がかかったので、飛ばしました。")
        else:
            lines.append("キャラを作る道具: 足りない物があります(アプリで話すだけなら要りません)。くわしくは python creator/setup/doctor.py")
    if os.path.isfile(absp("web/server/index.mjs")):
        node = shutil.which("node")
        code = None
        if node:
            try:
                code, _ = run([node, "--check", absp("web/server/index.mjs")], NODE_TIMEOUT)
            except (TimeoutError, OSError):
                code = None
        if not node:
            lines.append("アプリ: Node.js が見つかりません。Node.js 22 を入れてください。")
        elif code == 0 and os.path.isdir(absp("web/node_modules")):
            lines.append("アプリ: 読み込めます。")
        elif code == 0:
            lines.append("アプリ: 読み込めます。まだ部品が入っていないので、web のフォルダで npm ci をしてください。")
        else:
            lines.append("アプリ: うまく読み込めませんでした。" + UNDO_HINT)
    if lines:
        say("ようすの確かめ(鍵は使いません):")
        for line in lines:
            say(f"  {line}")


def cmd_apply(args):
    renames = parse_renames(args.rename)
    branch, up, remote = ready_to_change()
    try:
        fetch(remote)
    except Offline:
        raise Stop("新しい版の所に届きませんでした(ネットにつながっていないかもしれません)。何も変えていません。あとでもう一度ためしてください。")
    head = git("rev-parse", "HEAD").strip()
    target = git("rev-parse", "@{u}").strip()
    ours, theirs = local_version(), version_at(target)
    if int(git("rev-list", "--count", f"{head}..{target}").strip() or 0) == 0:
        say(f"もう、いちばん新しい版です({ours})。何も変えていません。")
        return 0
    try:
        git("merge-base", "--is-ancestor", head, target)
    except RuntimeError:
        raise Stop("このフォルダには、自分で記録した変更(コミット)があるので、自動では新しくできません。何も変えていません。")
    tracked = tracked_set()
    changes_in = incoming(head, target)
    mine = my_character_ids(tracked)
    same_ids, new_ids, added = collisions(tracked, changes_in, mine)
    check_renames(renames, same_ids, new_ids, mine, tracked)
    files = user_files(tracked)
    changes = tracked_changes()
    blocked = [p for p in added if p in set(files) and not any(p.startswith(f"characters/{i}/") for i in renames)]
    if blocked:
        raise Stop("新しい版に、あなたのファイルと同じ名前の物が入るので、何も変えずに止めました:\n" +
                   "\n".join(f"  {p}" for p in blocked) + "\nそのファイルを別の場所へ動かしてから、もう一度ためしてください。")

    name, base, man = make_backup(head, branch, up, target, ours, theirs, files, changes)
    say(f"控えを取りました: {BACKUP_DIR}/{name}(あなたの物 {len(files)} 個・あなたが直した見本 {len(changes)} 個)")
    try:
        for old, new in renames.items():
            rename_character(old, new)
            man["renamed"].append({"from": old, "to": new})
            say(f"あなたのキャラの名前を替えました: {old} → {new}")
        undo_paths = [p for p, k in changes if k != "added"]
        added_paths = [p for p, k in changes if k == "added"]
        for i in range(0, len(undo_paths), 50):
            git("checkout", "-q", "HEAD", "--", *undo_paths[i:i + 50])
        for i in range(0, len(added_paths), 50):
            git("reset", "-q", "--", *added_paths[i:i + 50])
        git("merge", "--ff-only", "-q", target, timeout=MERGE_TIMEOUT)
    except (RuntimeError, TimeoutError, OSError) as e:
        put_back(base, man, head)
        man["status"] = "failed"
        write_json(os.path.join(base, "manifest.json"), man)
        raise Stop("新しくする途中で止まったので、前のままに戻しました。あなたの物はそのままです。", code=3) from e

    both = [p for p, k in changes if k != "added" and p in changes_in]
    put_back_tracked(base, man, skip=set(both))
    man["kept_new_version"] = both
    man["status"] = "applied"
    write_json(os.path.join(base, "manifest.json"), man)

    if is_newer(theirs, ours):
        say(f"新しい版 {theirs} になりました(前は {ours})。あなたのキャラ・性格・声・記憶・設定は、そのままです。")
    else:
        say(f"小さな直しを入れました(版は {theirs})。あなたのキャラ・性格・声・記憶・設定は、そのままです。")
    if both:
        say("あなたが直した次のファイルは、新しい版でも直されていました。新しい版の物を使い、あなたの物は控えに残しました:")
        for p in both:
            say(f"  {p}  → 控え: {BACKUP_DIR}/{name}/tracked/{p}")
    changed = list(changes_in)
    if WEB_LOCK in changed:
        run_npm_ci()
    for p in changed:
        if REQ_FILE.search(p) and changes_in[p] != "D":
            say(f"・Python の部品が変わりました: python -m pip install -r {p}")
    code, out = run_python_tool(OFFERS, "--migrate")
    if code is not None:
        say("キャラの書き方を、新しい版にそろえました:" if code == 0 else "キャラの書き方をそろえる所で止まりました(あなたのキャラはそのままです):")
        for line in out.strip().splitlines():
            say(f"  {line}")
    health_check()
    try:
        show_news(news_between(git("show", f"HEAD:{NEWS_FILE}"), ours, theirs))
    except RuntimeError:
        pass
    code, out = run_python_tool(OFFERS, "--text")
    if code == 0 and out.strip():
        say("あなたのキャラに入れられる、新しい表現:")
        say(out.rstrip())
    man["after"] = after_hashes(man)
    # 新しくした時の段(書き方をそろえる)が見張られたファイルを変えた時の、その時の中身(元に戻す時の確かめに使う)
    man["after_tracked"] = {p: current_hash(p) for p, _ in tracked_changes()}
    write_json(os.path.join(base, "manifest.json"), man)
    say(UNDO_HINT)
    return 0


def put_back(base, man, head):
    """apply の途中で止まった時、前のままに戻す"""
    try:
        if git("rev-parse", "HEAD").strip() != head:
            git("reset", "-q", "--keep", head)
    except (RuntimeError, TimeoutError):
        pass
    put_back_tracked(base, man)
    for r in reversed(man["renamed"]):
        if os.path.isdir(absp(f"characters/{r['to']}")) and not os.path.exists(absp(f"characters/{r['from']}")):
            os.rename(absp(f"characters/{r['to']}"), absp(f"characters/{r['from']}"))
            cj = absp(f"characters/{r['from']}/character.json")
            data = read_json(cj)
            if isinstance(data, dict) and data.get("id") == r["to"]:
                data["id"] = r["from"]
                write_json(cj, data)


# ---------- undo ----------

def cmd_undo(args):
    if not shutil.which("git") or not is_clone():
        raise Stop("このフォルダは git clone で取ってきた物ではないので、元に戻せません。")
    if busy_with_merge():
        raise Stop("いま git の別の作業の途中なので、何も変えずに止めました。")
    found = [(n, m) for n, m in backups() if m.get("status") == "applied"]
    if not found:
        raise Stop("元に戻せる控えがありません(まだ一度も新しくしていないか、もう元に戻してあります)。")
    name, man = found[0]
    base = absp(f"{BACKUP_DIR}/{name}")
    head = git("rev-parse", "HEAD").strip()
    if head != man["to_commit"]:
        raise Stop("新しくした後に、ほかの変更が入っているので、自動では元に戻せません。何も変えていません。")
    # 新しくした後に、その人が変えた物があれば止める(元に戻すと消えてしまうので)
    expect = {it["path"]: it.get("sha256") for it in man["tracked_changes"]
              if it["kind"] != "added" and it["path"] not in man["kept_new_version"]}
    after_tracked = man.get("after_tracked") or {}
    moved = []
    for p, k in tracked_changes():
        cur = current_hash(p)
        if p in expect and cur == expect[p]:
            continue
        if p in after_tracked and cur == after_tracked[p]:
            continue
        moved.append(p)
    # その人の物は、新しくした時に変わった物(キャラの書き方をそろえた物など)だけを戻す。記憶などの新しい中身は残す
    after = man.get("after") or {}
    todo = []
    for item in man["user_files"]:
        p, q = item["path"], renamed_path(item["path"], man["renamed"])
        cur = current_hash(q)
        if after:
            if q not in after or after[q] == item["sha256"]:
                continue
            if cur != after[q]:
                moved.append(q)
                continue
        elif not p.startswith("characters/") or cur == item["sha256"]:
            continue
        todo.append(item)
    if moved:
        raise Stop("新しくした後に、次の物が変わっています。元に戻すと消えてしまうので、何も変えずに止めました:\n" +
                   "\n".join(f"  {p}" for p in sorted(set(moved))) +
                   "\n残したい物を別の場所へ写してから、もう一度「元に戻して」と頼んでください。")
    lock_changed = WEB_LOCK in incoming(man["from_commit"], man["to_commit"])
    git("reset", "-q", "--hard", man["from_commit"], timeout=MERGE_TIMEOUT)
    put_back_tracked(base, man)
    for r in reversed(man["renamed"]):
        if os.path.isdir(absp(f"characters/{r['to']}")) and not os.path.exists(absp(f"characters/{r['from']}")):
            os.rename(absp(f"characters/{r['to']}"), absp(f"characters/{r['from']}"))
    # 新しくした時に変わった、その人の物(キャラの書き方をそろえた物・名前を替えた子の id)を控えから戻す
    for item in todo:
        p = item["path"]
        os.makedirs(os.path.dirname(absp(p)), exist_ok=True)
        shutil.copy2(os.path.join(base, "files", *p.split("/")), absp(p))
    restored = len(todo)
    man["status"] = "undone"
    man["undone"] = now().isoformat(timespec="seconds")
    write_json(os.path.join(base, "manifest.json"), man)
    say(f"前の版 {man['from_version']} に戻しました。控え {BACKUP_DIR}/{name} から、あなたの物を戻しました(書き戻した物 {restored} 個)。")
    if lock_changed:
        run_npm_ci()
    return 0


# ---------- status ----------

def cmd_status(args):
    st = load_state()
    say(f"版: {local_version()}")
    if shutil.which("git") and is_clone():
        branch, up, _ = branch_info()
        say(f"線: {branch or '(決まった線の上にいません)'}" + (f"(取り先: {up.split('/', 1)[-1]})" if up else "(取り先なし)"))
    else:
        say("線: (git clone で取ってきた物ではありません)")
    last = (st.get("last_check") or "")[:16].replace("T", " ")
    say(f"最後に確かめた時: {last or 'まだ'}" + (f"(その時の新しい版: {st['latest']})" if st.get("latest") else ""))
    b = backups()
    if b:
        name, man = b[0]
        word = {"applied": "新しくした時の控え", "undone": "元に戻した控え", "failed": "途中で止めた控え"}.get(man.get("status"), "控え")
        say(f"いちばん新しい控え: {BACKUP_DIR}/{name}({word}・{man.get('from_version')} → {man.get('to_version')})")
    else:
        say("いちばん新しい控え: まだありません")
    return 0


def main(argv=None):
    if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(prog="yuru_update", description="ゆるキャラクリエイターを新しい版にする(あなたのキャラは消しません)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="新しい版があるかを見る")
    c.add_argument("--quiet", action="store_true", help="新しい版がある時だけ 1 行出す")
    c.add_argument("--once-a-day", action="store_true", help="1 日に 1 回だけ確かめる")
    a = sub.add_parser("apply", help="控えを取ってから、新しい版にする")
    a.add_argument("--rename", action="append", metavar="今のid=新しいid", help="見本とぶつかる自分のキャラの名前を替える")
    sub.add_parser("undo", help="いちばん新しい控えの時に戻す")
    sub.add_parser("status", help="今の版・線・最後に見た時・いちばん新しい控え")
    args = ap.parse_args(argv)
    try:
        return {"check": cmd_check, "apply": cmd_apply, "undo": cmd_undo, "status": cmd_status}[args.cmd](args)
    except Stop as e:
        say(e.msg)
        return e.code
    except (RuntimeError, TimeoutError, FileNotFoundError, OSError) as e:
        if args.cmd == "check" and getattr(args, "quiet", False):
            return 0
        say("思わぬ所で止まりました。あなたの物は消していません。" + (UNDO_HINT if args.cmd == "apply" else ""))
        say(f"(止まった所: {type(e).__name__})")
        return 3 if args.cmd in ("apply", "undo") else 0


if __name__ == "__main__":
    sys.exit(main())
