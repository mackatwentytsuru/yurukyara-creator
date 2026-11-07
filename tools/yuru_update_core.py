"""tools/yuru_update.py の部品: 小さな道具・版と「できるようになったこと」・今のようす・使う人の物の地図・控え。

Python 3 の標準の物だけ。git の呼び出しには、どれも時間の上限がある。鍵のファイルの中身は読まない。
"""
import datetime
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess

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
QUIET_FETCH_TIMEOUT = 5     # 起動の時のおしらせ(起動役の 8 秒より前に、自分で git を片づけて終わる)
MERGE_TIMEOUT = 120
KILL_WAIT = 10              # 時間切れで止めた後、出力の口が閉じるのを待つ上限
SPARE_BYTES = 200 * 1024 * 1024   # 控えを取った後にも残しておくディスクの空き

# 自分で手で組んだキャラの作り方のファイル(characters/ の外。見張られていない物だけが、その人の物)
OWN_FILE_DIRS = ("creator/builders", "creator/specs")
OWN_FILE_TAILS = (".py", ".json", "_built.json", "_face.args", "_look.json")

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


def current_hash(relpath):
    return sha256_of(absp(relpath)) if os.path.isfile(absp(relpath)) else None


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


def kill_tree(proc):
    """自分で起こしたプロセスを、その子や孫ごと止める(番号で止める。名前では止めない)。
    Windows では、外側の git だけを止めても、中の git-remote-http が出力の口をにぎって残るため"""
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=KILL_WAIT)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        proc.kill()
    except OSError:
        pass


def spawn(cmd, timeout, cwd=None, env=None, merge_err=True):
    """命令を時間の上限つきで流す。(番号, 出力, エラー出力) を bytes で返す。
    時間切れ・Ctrl+C の時は、木ごと止めてから TimeoutError・KeyboardInterrupt を上げる"""
    extra = {} if os.name == "nt" else {"start_new_session": True}
    proc = subprocess.Popen(cmd, cwd=cwd or ROOT, env=env or child_env(), stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT if merge_err else subprocess.PIPE, **extra)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as e:
        kill_tree(proc)
        try:
            proc.communicate(timeout=KILL_WAIT)
        except subprocess.TimeoutExpired:
            pass   # 口をにぎったまま残った物があっても、待たずに進む
        raise TimeoutError(str(cmd[:2])) from e
    except BaseException:
        kill_tree(proc)
        raise
    return proc.returncode, out or b"", err or b""


def run(cmd, timeout, cwd=None):
    """外の命令を時間の上限つきで流す。(番号, 出力) を返す。時間切れは TimeoutError。改行は \\n にそろえる"""
    code, out, _ = spawn(cmd, timeout, cwd=cwd)
    return code, out.decode("utf-8", "replace").replace("\r\n", "\n")


def git(*args, timeout=GIT_TIMEOUT, ok=(0,)):
    """git を流す。失敗は RuntimeError(git の文は外に出さない。鍵の入った住所が混じることがあるため)"""
    exe = shutil.which("git")
    if not exe:
        raise FileNotFoundError("git")
    env = child_env()
    if "GIT_SSH_COMMAND" not in env and "GIT_SSH" not in env:   # 合言葉を聞かれて止まらないように
        env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o ConnectTimeout=5"
    try:
        code, out, _ = spawn([exe, "-c", "core.quotepath=false", *args], timeout, env=env, merge_err=False)
    except TimeoutError as e:
        raise TimeoutError("git " + args[0]) from e
    if code not in ok:
        raise RuntimeError(f"git {args[0]} ({code})")
    return out.decode("utf-8", "replace")


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


def show_news(commit, ours, theirs):
    try:
        secs = news_between(git("show", f"{commit}:{NEWS_FILE}"), ours, theirs)
    except RuntimeError:
        return
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
    limit = QUIET_FETCH_TIMEOUT if quiet else FETCH_TIMEOUT
    try:   # 答えない取り先(http)では、git 自身にも、ほとんど届かない時はあきらめてもらう
        git("-c", "http.lowSpeedLimit=1", "-c", f"http.lowSpeedTime={limit}",
            "fetch", "--quiet", "--no-tags", remote, timeout=limit)
    except (RuntimeError, TimeoutError) as e:
        raise Offline() from e


def load_state():
    return read_json(os.path.join(ROOT, STATE_FILE), {}) or {}


def save_state(**kw):
    st = load_state()
    st.update(kw)
    try:
        write_json(os.path.join(ROOT, STATE_FILE), st)
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
    """鍵のファイルの名前だけ(中身は開かない)"""
    found = []
    for d in ("", "web", "creator"):
        base = absp(d) if d else ROOT
        if os.path.isdir(base):
            for name in sorted(os.listdir(base)):
                p = f"{d}/{name}" if d else name
                if is_key_file(p) and os.path.isfile(absp(p)):
                    found.append(p)
    return found + [d + "/" for d in KEY_DIRS if os.path.isdir(absp(d))]


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
        xy, path = items[i][:2], items[i][3:]
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


def collisions_message(ids):
    """新しい版の見本と同じ id の自分のキャラがある時の文(何も変えずに止める)"""
    lines = [f"新しい版に、あなたのキャラと同じ名前の見本のキャラが入ります: {', '.join(ids)}",
             "このままだと、あなたのキャラと見本がぶつかるので、何も変えずに止めました(あなたのキャラはそのままです)。",
             "あなたのキャラの名前を替えてから進められます。いいときは、次のように頼んでください:"]
    lines += [f"  python tools/yuru_update.py apply --rename {i}={i}_mine" for i in ids]
    lines.append("(名前を替えると、性格の画面で選んだ物は、もう一度選ぶことになります)")
    return "\n".join(lines)


# ---------- 控え ----------

def renamed_path(p, renamed):
    for r in renamed:
        pre = f"characters/{r['from']}/"
        if p.startswith(pre):
            return f"characters/{r['to']}/" + p[len(pre):]
        if p in r.get("files", ()):
            return renamed_file(p, r["from"], r["to"])
    return p


def after_hashes(man):
    return {renamed_path(it["path"], man["renamed"]): current_hash(renamed_path(it["path"], man["renamed"]))
            for it in man["user_files"]}


def _copy_checked(src_rel, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(absp(src_rel), dst)
    digest = sha256_of(absp(src_rel))
    if sha256_of(dst) != digest:
        raise Stop(f"控えを写した物が元と合わないので、止めました(何も変えていません): {src_rel}")
    return digest


def new_backup_name():
    stamp = now().strftime("%Y%m%d-%H%M%S")
    name, n = stamp, 2
    while os.path.exists(absp(f"{BACKUP_DIR}/{name}")):
        name, n = f"{stamp}-{n}", n + 1
    return name


def make_backup(info, files, changes):
    """その人の物と、その人が直した見張られたファイルを backups/<日時>/ に写す。(名前, 場所, manifest)"""
    need = sum(os.path.getsize(absp(p)) for p in files) + \
        sum(os.path.getsize(absp(p)) for p, k in changes if k != "deleted")
    if shutil.disk_usage(ROOT).free < need * 2 + SPARE_BYTES:
        raise Stop("ディスクの空きが足りないので、控えを取れません。何も変えずに止めました。空きを作ってから、もう一度ためしてください。")
    name = new_backup_name()
    base = absp(f"{BACKUP_DIR}/{name}")
    man = dict(info, tool="yuru_update", made=now().isoformat(timespec="seconds"), status="started",
               user_files=[], tracked_changes=[], keys_left_in_place=key_files(),
               renamed=[], kept_new_version=[], after={}, after_tracked={})
    try:
        for p in files:
            digest = _copy_checked(p, os.path.join(base, "files", *p.split("/")))
            man["user_files"].append({"path": p, "sha256": digest, "size": os.path.getsize(absp(p))})
        for p, kind in changes:
            item = {"path": p, "kind": kind}
            if kind != "deleted":
                item["sha256"] = _copy_checked(p, os.path.join(base, "tracked", *p.split("/")))
            man["tracked_changes"].append(item)
        write_json(os.path.join(base, "manifest.json"), man)
    except BaseException:
        shutil.rmtree(base, ignore_errors=True)   # 今作りかけた控えだけを片づける
        raise
    return name, base, man


def save_manifest(base, man):
    write_json(os.path.join(base, "manifest.json"), man)


def own_files(cid, tracked):
    """その子の作り方のファイル(creator/builders/<id>.py・creator/specs/<id>_built.json など)のうち、見張られていない物"""
    out = []
    for d in OWN_FILE_DIRS:
        if not os.path.isdir(absp(d)):
            continue
        for tail in OWN_FILE_TAILS:
            p = f"{d}/{cid}{tail}"
            if p not in tracked and os.path.isfile(absp(p)):
                out.append(p)
    return out


def renamed_file(p, old, new):
    d, name = p.rsplit("/", 1)
    return f"{d}/{new}{name[len(old):]}"


def _set_id(path, old, new):
    data = read_json(path)
    if isinstance(data, dict) and data.get("id") == old:
        data["id"] = new
        write_json(path, data)


def rename_character(old, new, files=()):
    """自分のキャラのフォルダの名前と、character.json の id を替える。作り方のファイル(files)の名前と id も替える"""
    os.rename(absp(f"characters/{old}"), absp(f"characters/{new}"))
    _set_id(absp(f"characters/{new}/character.json"), old, new)
    for p in files:
        q = renamed_file(p, old, new)
        if os.path.isfile(absp(p)) and not os.path.exists(absp(q)):
            os.rename(absp(p), absp(q))
            if q.endswith(".json"):
                _set_id(absp(q), old, new)


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


def restage(man):
    """git add だけしてあった新しいファイルを、もう一度 add した形に戻す"""
    added = [it["path"] for it in man["tracked_changes"] if it["kind"] == "added" and os.path.isfile(absp(it["path"]))]
    for i in range(0, len(added), 50):
        try:
            git("add", "--", *added[i:i + 50])
        except (RuntimeError, TimeoutError):
            pass


def rename_back(man):
    for r in reversed(man["renamed"]):
        if os.path.isdir(absp(f"characters/{r['to']}")) and not os.path.exists(absp(f"characters/{r['from']}")):
            os.rename(absp(f"characters/{r['to']}"), absp(f"characters/{r['from']}"))
            _set_id(absp(f"characters/{r['from']}/character.json"), r["to"], r["from"])
        for p in r.get("files", []):
            q = renamed_file(p, r["from"], r["to"])
            if os.path.isfile(absp(q)) and not os.path.exists(absp(p)):
                os.rename(absp(q), absp(p))
                if p.endswith(".json"):
                    _set_id(absp(p), r["to"], r["from"])


def put_back(base, man, head):
    """新しくする途中で止まった時、前のままに戻す。戻せたら True"""
    try:
        if git("rev-parse", "HEAD").strip() != head:
            git("reset", "-q", "--keep", head, timeout=MERGE_TIMEOUT)
    except (RuntimeError, TimeoutError):
        pass
    put_back_tracked(base, man)
    rename_back(man)
    restage(man)
    try:
        return git("rev-parse", "HEAD").strip() == head
    except (RuntimeError, TimeoutError):
        return False
