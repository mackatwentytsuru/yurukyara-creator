#!/usr/bin/env python3
"""ゆるキャラクリエイターを新しい版にする道具。あなたのキャラ・性格・声・記憶・設定は消しません。

使い方(リポジトリの頭のフォルダで):
  python tools/yuru_update.py check [--quiet] [--once-a-day] [--json]  新しい版があるかを見る
  python tools/yuru_update.py apply [--rename 今のid=新しいid]  控えを取ってから、新しい版にする
  python tools/yuru_update.py undo [--save-mine]               いちばん新しい控えの時に戻す
  python tools/yuru_update.py status [--json]                  今の版・線・最後に見た時・いちばん新しい控え
- --json は、アプリの手元のサーバー(web/server/update.mjs)が画面に出すための形(1 行の JSON)。
  check --json --once-a-day は、今日もう取り先を見ていれば、ネットに出ずに手元に取ってある分だけでくらべる。

- Python 3 の標準の物だけで動く(Windows・macOS・Linux)。git とネットの呼び出しには、どれも時間の上限がある。
- 鍵のファイル(web/.env など)は、名前を控えに書くだけ。中身は読まない・写さない・出さない。
- 使う人の物(自分のキャラ・記憶・設定・作る道の途中の物)は、消さない・上書きしない。
- 終わりの番号: 0 = できた(新しい版にした・もう新しい・見た)、1 = 何も変えずに止めた、3 = 途中で止まった。
- 部品(使う人の物の地図・控え・版の読み方)は tools/yuru_update_core.py。試験は tools/test_yuru_update.py。
"""
import argparse
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I でも部品を読めるように
from yuru_update_core import (  # noqa: E402
    BACKUP_DIR, DOCTOR, ID_FORM, MERGE_TIMEOUT, NEWS_FILE, OFFERS, REQ_FILE, UNDO_HINT, WEB_LOCK, news_between,
    Offline, Stop, absp, after_hashes, backups, branch_info, busy_with_merge, collisions_message,
    current_hash, fetch, git, incoming, is_clone, is_newer, load_state, local_version, make_backup,
    my_character_ids, now, own_files, put_back, put_back_tracked, rename_back, rename_character, renamed_file,
    renamed_path, restage, run, save_manifest, save_state, say, show_news, tracked_changes, tracked_set,
    user_files, version_at,
)

NPM_TIMEOUT = 900
TOOL_TIMEOUT = 120
DOCTOR_TIMEOUT = 60
NODE_TIMEOUT = 30
RESTART_HINT = "アプリ(npm start)を動かしていたら、一度止めて、もう一度 npm start で起こしてください。"
# アプリの画面の「アップデートする」から流した時(手元のサーバーが YURU_UPDATE_FROM_APP=1 で起こす)の、終わりの一言
APP_RESTART_HINT = "このあと、アプリが じぶんで いちど とじて、ひらきなおします。"
APP_UNDO_HINT = "もとに もどすときは、おなじ まどの「もとに もどす」を おしてね。"


def from_app():
    return os.environ.get("YURU_UPDATE_FROM_APP") == "1"


def restart_hint():
    return APP_RESTART_HINT if from_app() else RESTART_HINT


def undo_hint():
    return APP_UNDO_HINT if from_app() else UNDO_HINT
SAVE_MINE_HINT = ("いまの中身を控えに写してから元に戻すときは、「写してから元に戻して」と頼むか、"
                  "python tools/yuru_update.py undo --save-mine")
STOPPED_HINT = ("止めました。あなたの物は消していません。もう一度「アップデートして」と言うと、"
                "止まった所を先に直してから進めます。" + UNDO_HINT)
MOVE_OUT = ("新しい版は、取ってきた所からもう一度取ってください。そのときは先に、自分のキャラ(characters/ の中の自分の子と、"
            "creator/builders・creator/specs の中の、その子の名前のファイル)・記憶(web/logs/memory/)・"
            "設定(web/.env と creator/env.local.sh)を別の場所へ写してください。")


# ---------- check ----------

def news_items(commit, ours, theirs):
    """「できるようになったこと」の、今の版より新しい節。[{version, title, lines}](行の頭の「- 」は外す)"""
    try:
        secs = news_between(git("show", f"{commit}:{NEWS_FILE}"), ours, theirs)
    except (RuntimeError, TimeoutError):
        return []
    return [{"version": s["version"], "title": s["title"], "lines": [ln.lstrip("-* ").strip() for ln in s["lines"]]}
            for s in secs]


def check_report(once_a_day):
    """画面(アプリの手元のサーバー)向けの答え。ネットに出るのは取り先を見る fetch の 1 回だけ。
    once_a_day で今日もう見ていれば fetch せず、前に取ってある取り先の物でくらべる。失敗は update: False(画面は何も出さない)"""
    out = {"schema": "yc-update-check/1", "clone": False, "upstream": False, "fetched": False, "offline": False,
           "ours": local_version(), "theirs": None, "ahead": 0, "newer": False, "update": False, "own_commits": False,
           "interrupted": False, "news": []}
    if not shutil.which("git") or not is_clone():
        return out
    out["clone"], out["interrupted"] = True, bool(interrupted())
    branch, up, remote = branch_info()
    if not up:
        return out
    out["upstream"] = True
    if not (once_a_day and load_state().get("last_try", "")[:10] == now().date().isoformat()):
        save_state(last_try=now().isoformat(timespec="seconds"))
        try:
            fetch(remote, quiet=once_a_day)
        except Offline:
            out["offline"] = True
            return out
        out["fetched"] = True
    head, target = git("rev-parse", "HEAD").strip(), git("rev-parse", "@{u}").strip()
    ours, theirs = out["ours"], version_at(target)
    ahead = int(git("rev-list", "--count", f"{head}..{target}").strip() or 0)
    try:
        git("merge-base", "--is-ancestor", head, target)
    except RuntimeError:
        out["own_commits"] = True   # 自分で記録した変更があると、apply は何も変えずに止まる
    if out["fetched"]:
        save_state(last_check=now().isoformat(timespec="seconds"), latest=theirs)
    out.update(theirs=theirs, ahead=ahead, newer=is_newer(theirs, ours),
               update=bool(ahead) and not out["own_commits"], news=news_items(target, ours, theirs) if ahead else [])
    return out


def say_json(obj):
    say(json.dumps(obj, ensure_ascii=False))


def cmd_check(args):
    if args.json:
        say_json(check_report(args.once_a_day))
        return 0
    if args.once_a_day and load_state().get("last_try", "")[:10] == now().date().isoformat():
        if not args.quiet:
            say("今日はもう確かめました。もう一度見るときは --once-a-day を付けずに流してください。")
        return 0
    if not shutil.which("git") or not is_clone():
        if not args.quiet:
            say("このフォルダは git clone で取ってきた物ではないので、新しい版を自動では確かめられません。")
            say(MOVE_OUT)
        return 0
    if not args.quiet and interrupted():
        say("前に、新しくする途中で止まっています。「アップデートして」と言うと、止まった所を先に直してから進めます。")
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
    return tell_check(ours, theirs, ahead, target)


def tell_check(ours, theirs, ahead, target):
    say(f"今の版: {ours}")
    if not ahead:
        say("いちばん新しい版です。")
        return 0
    if is_newer(theirs, ours):
        say(f"新しい版 {theirs} があります。")
    else:
        say(f"小さな直しが {ahead} 個あります(版は {theirs} のまま)。")
    show_news(target, ours, theirs)
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


def check_renames(renames, changes_in, mine, tracked):
    """見本と同じ id の自分のキャラがあれば、名前を替える OK が無い限り止める。{今のid: 一緒に名前を替える作り方のファイル}"""
    added = [p for p, st in changes_in.items() if st.startswith("A")]
    new_ids = {p.split("/")[1] for p in added if p.startswith("characters/") and p.count("/") >= 2}
    taken = set(os.listdir(absp("characters"))) if os.path.isdir(absp("characters")) else set()
    files = {}
    for old, new in renames.items():
        if old not in mine:
            raise Stop(f"「{old}」は、あなたが作ったキャラの中にありません。名前を確かめてください。")
        if new in taken or new in new_ids or any(p.startswith(f"characters/{new}/") for p in tracked):
            raise Stop(f"「{new}」は、もう使われている名前です。別の名前にしてください。")
        files[old] = own_files(old, tracked)
        for p in files[old]:
            q = renamed_file(p, old, new)
            if os.path.exists(absp(q)) or q in tracked or q in changes_in:
                raise Stop(f"「{new}」にすると、作り方のファイル {q} がほかの物とぶつかります。別の名前にしてください。")
    left = sorted(i for i in set(mine) & new_ids if i not in renames)
    if left:
        raise Stop(collisions_message(left))
    return added, files


def plan_apply(args):
    """新しくする前の下ごしらえ。何も変えない。新しい物が無ければ None"""
    renames = parse_renames(args.rename)
    branch, up, remote = ready_to_change()
    try:
        fetch(remote)
    except Offline:
        raise Stop("新しい版の所に届きませんでした(ネットにつながっていないかもしれません)。何も変えていません。あとでもう一度ためしてください。")
    head, target = git("rev-parse", "HEAD").strip(), git("rev-parse", "@{u}").strip()
    ours, theirs = local_version(), version_at(target)
    if int(git("rev-list", "--count", f"{head}..{target}").strip() or 0) == 0:
        return None, ours
    try:
        git("merge-base", "--is-ancestor", head, target)
    except RuntimeError:
        raise Stop("このフォルダには、自分で記録した変更(コミット)があるので、自動では新しくできません。何も変えていません。")
    tracked = tracked_set()
    changes_in = incoming(head, target)
    added, own = check_renames(renames, changes_in, my_character_ids(tracked), tracked)
    files, changes = user_files(tracked), tracked_changes()
    mine = set(files)
    moving = {p for ps in own.values() for p in ps}
    blocked = [p for p in added if p in mine and p not in moving
               and not any(p.startswith(f"characters/{i}/") for i in renames)]
    if blocked:
        raise Stop("新しい版に、あなたのファイルと同じ名前の物が入るので、何も変えずに止めました:\n" +
                   "\n".join(f"  {p}" for p in blocked) + "\nそのファイルを別の場所へ動かしてから、もう一度ためしてください。")
    info = {"from_commit": head, "from_version": ours, "branch": branch, "upstream": up,
            "to_commit": target, "to_version": theirs}
    return {"info": info, "renames": renames, "own": own, "changes_in": changes_in, "files": files,
            "changes": changes}, ours


def switch_version(plan, base, man):
    """名前を替え、その人が直したファイルをいったん戻し、新しい版へ進める。止まったら前のままに戻す"""
    head, target = man["from_commit"], man["to_commit"]
    # 名前替えは、する前に控えに書いておく(途中で止まっても、次の時に戻せるように)
    man["renamed"] = [{"from": old, "to": new, "files": plan["own"].get(old, [])} for old, new in plan["renames"].items()]
    save_manifest(base, man)
    try:
        for r in man["renamed"]:
            rename_character(r["from"], r["to"], r["files"])
            say(f"あなたのキャラの名前を替えました: {r['from']} → {r['to']}")
        back = [p for p, k in plan["changes"] if k != "added"]
        staged = [p for p, k in plan["changes"] if k == "added"]
        for i in range(0, len(back), 50):
            git("checkout", "-q", "HEAD", "--", *back[i:i + 50])
        for i in range(0, len(staged), 50):
            git("reset", "-q", "--", *staged[i:i + 50])
        git("merge", "--ff-only", "-q", target, timeout=MERGE_TIMEOUT)
    except (RuntimeError, TimeoutError, OSError, KeyboardInterrupt) as e:
        ok = put_back(base, man, head)
        man["status"] = "failed"
        save_manifest(base, man)
        if ok:
            raise Stop("新しくする途中で止まったので、前のままに戻しました。あなたの物はそのままです。", code=3) from e
        raise Stop(f"新しくする途中で止まりました。あなたの物の控えは {BACKUP_DIR}/ にあります。"
                   "もう一度「アップデートして」と言うと、止まった所を先に直してから進めます。", code=3) from e


def tell_both_sides(name, both, kinds):
    kept = [p for p in both if kinds.get(p) != "deleted"]
    gone = [p for p in both if kinds.get(p) == "deleted"]
    if kept:
        say("あなたが直した次のファイルは、新しい版でも直されていました。新しい版の物を使い、あなたの物は控えに残しました:")
        for p in kept:
            say(f"  {p}  → 控え: {BACKUP_DIR}/{name}/tracked/{p}")
    if gone:
        say("あなたが消していた次のファイルは、新しい版で直されていたので、新しい版の物を置きました(いらなければ、もう一度消してください):")
        for p in gone:
            say(f"  {p}")


def settle(plan, name, base, man):
    """新しい版になった直後: その人が直したファイルを戻し、「新しくした」と控えに書く"""
    changes_in, info = plan["changes_in"], plan["info"]
    kinds = dict(plan["changes"])
    both = [p for p, k in plan["changes"] if k != "added" and p in changes_in]
    put_back_tracked(base, man, skip=set(both))
    restage(man)
    man["kept_new_version"] = both
    man["status"], man["finished"] = "applied", False
    save_manifest(base, man)
    ours, theirs = info["from_version"], info["to_version"]
    keep = "あなたのキャラ・性格・声・記憶・設定は、そのままです。"
    say(f"新しい版 {theirs} になりました(前は {ours})。{keep}" if is_newer(theirs, ours)
        else f"小さな直しを入れました(版は {theirs})。{keep}")
    tell_both_sides(name, both, kinds)


def after_steps(changes_in, base, man):
    """新しくした後の段: 部品・書き方をそろえる・確かめ・新しい事と表現。途中で止まっても、次の apply が続きをする"""
    ours, theirs = man["from_version"], man["to_version"]
    if WEB_LOCK in changes_in:
        run_npm_ci()
    for p, st in changes_in.items():
        if REQ_FILE.search(p) and st != "D":
            say(f"・Python の部品が変わりました: python -m pip install -r {p}")
    tell_tool(OFFERS, ("--migrate",), "キャラの書き方を、新しい版にそろえました:",
              "キャラの書き方をそろえる所で止まりました(あなたのキャラはそのままです):")
    health_check()
    show_news("HEAD", ours, theirs)
    code, out = run_python_tool(OFFERS, "--text")
    if code == 0 and out.strip():
        say("あなたのキャラに入れられる、新しい表現:")
        say(out.rstrip())
    man["after"] = after_hashes(man)
    # 書き方をそろえる段が見張られたファイルを変えた時の、その時の中身(元に戻す時の確かめに使う)
    man["after_tracked"] = {p: current_hash(p) for p, _ in tracked_changes()}
    man["finished"] = True
    save_manifest(base, man)
    say(restart_hint())
    say(undo_hint())


# ---------- 途中で止まった時 ----------

def interrupted():
    """いちばん新しい控えが「途中で止まった」ままなら (名前, manifest)"""
    try:
        b = backups()
    except OSError:
        return None
    if b and (b[0][1].get("status") == "started" or
              (b[0][1].get("status") == "applied" and b[0][1].get("finished") is False)):
        return b[0]
    return None


def recover():
    """前の apply が途中で止まっていたら、先に直す。
    新しくする前に止まっていた → 前のままに戻す。新しくした後の段で止まっていた → 残りの段をする(True を返す)"""
    found = interrupted()
    if not found or not shutil.which("git") or not is_clone() or busy_with_merge():
        return False
    name, man = found
    base = absp(f"{BACKUP_DIR}/{name}")
    head = git("rev-parse", "HEAD").strip()
    if man.get("status") == "applied":
        if head != man["to_commit"]:
            return False
        say(f"前に、新しくした後の段の途中で止まっていたので、続きをします(控え {BACKUP_DIR}/{name})。")
        after_steps(incoming(man["from_commit"], man["to_commit"]), base, man)
        return True
    if head not in (man["from_commit"], man["to_commit"]) or not put_back(base, man, man["from_commit"]):
        raise Stop(f"前に新しくする途中で止まった控え {BACKUP_DIR}/{name} がありますが、その後にほかの変更が入っているので、"
                   "自動では直せません。何も変えていません。\n"
                   f"あなたが直していたファイルは {BACKUP_DIR}/{name}/tracked/ の中に、あなたの物は "
                   f"{BACKUP_DIR}/{name}/files/ の中に、そのまま残っています。", code=3)
    man["status"], man["recovered"] = "failed", now().isoformat(timespec="seconds")
    save_manifest(base, man)
    say(f"前に新しくする途中で止まっていたので、先に前のままに戻しました(控え {BACKUP_DIR}/{name})。"
        "あなたが直したファイルも戻しました。")
    return False


def cmd_apply(args):
    if recover():
        return 0
    plan, ours = plan_apply(args)
    if plan is None:
        say(f"もう、いちばん新しい版です({ours})。何も変えていません。")
        return 0
    name, base, man = make_backup(plan["info"], plan["files"], plan["changes"])
    say(f"控えを取りました: {BACKUP_DIR}/{name}(あなたの物 {len(plan['files'])} 個・あなたが直したファイル {len(plan['changes'])} 個)")
    switch_version(plan, base, man)
    settle(plan, name, base, man)
    after_steps(plan["changes_in"], base, man)
    return 0


# ---------- 新しくした後の段 ----------

def run_npm_ci():
    if os.environ.get("YURU_UPDATE_SKIP_NPM") == "1":   # アプリの見張り役(web/scripts/yuru-run.mjs)が、止めている間に入れ直す
        say("・アプリの部品が変わりました。アプリを ひらきなおす時に、入れなおします。")
        return
    npm = shutil.which("npm")
    if not npm:
        say("・アプリの部品が変わりました。Node.js 22 を入れてから、web のフォルダで npm ci をしてください。")
        return
    say("・アプリの部品が変わったので、入れ直しています(数分かかることがあります)…")
    try:
        code, _ = run([npm, "ci"], NPM_TIMEOUT, cwd=absp("web"))
    except (TimeoutError, OSError):
        code = None
    say("  アプリの部品を入れ直しました。" if code == 0 else
        "  アプリの部品を入れ直せませんでした。アプリを止めてから、web のフォルダで npm ci をしてください。")


def run_python_tool(path, *args, timeout=TOOL_TIMEOUT):
    if not os.path.isfile(absp(path)):
        return None, ""
    try:
        return run([sys.executable, absp(path), *args], timeout)
    except (TimeoutError, OSError):
        return None, ""


def tell_tool(path, args, ok_title, ng_title):
    code, out = run_python_tool(path, *args)
    if code is None:
        return
    say(ok_title if code == 0 else ng_title)
    for line in out.strip().splitlines():
        say(f"  {line}")


def node_check():
    node = shutil.which("node")
    if not node:
        return "アプリ: Node.js が見つかりません。Node.js 22 を入れてください。"
    try:
        code, _ = run([node, "--check", absp("web/server/index.mjs")], NODE_TIMEOUT)
    except (TimeoutError, OSError):
        code = None
    if code != 0:
        return "アプリ: うまく読み込めませんでした。" + UNDO_HINT
    if not os.path.isdir(absp("web/node_modules")):
        return "アプリ: 読み込めます。まだ部品が入っていないので、web のフォルダで npm ci をしてください。"
    return "アプリ: 読み込めます。"


def health_check():
    """鍵の要らない、すぐ終わる確かめ。作る道具(doctor.py)と、アプリのサーバーの文が読めるか"""
    lines = []
    if os.path.isfile(absp(DOCTOR)):
        code, _ = run_python_tool(DOCTOR, timeout=DOCTOR_TIMEOUT)
        lines.append({0: "キャラを作る道具: そろっています。",
                      None: "キャラを作る道具: 調べるのに時間がかかったので、飛ばしました。"}.get(
            code, "キャラを作る道具: 足りない物があります(アプリで話すだけなら要りません)。くわしくは python creator/setup/doctor.py"))
    if os.path.isfile(absp("web/server/index.mjs")):
        lines.append(node_check())
    if lines:
        say("ようすの確かめ(鍵は使いません):")
        for line in lines:
            say(f"  {line}")


# ---------- undo ----------

def undo_target():
    if not shutil.which("git") or not is_clone():
        raise Stop("このフォルダは git clone で取ってきた物ではないので、元に戻せません。")
    if busy_with_merge():
        raise Stop("いま git の別の作業の途中なので、何も変えずに止めました。")
    found = [(n, m) for n, m in backups() if m.get("status") == "applied"]
    if not found:
        raise Stop("元に戻せる控えがありません(まだ一度も新しくしていないか、もう元に戻してあります)。")
    name, man = found[0]
    if git("rev-parse", "HEAD").strip() != man["to_commit"]:
        raise Stop("新しくした後に、ほかの変更が入っているので、自動では元に戻せません。何も変えていません。")
    return name, man


def undo_plan(man):
    """(新しくした後に変わり、元に戻すと消えてしまう物, 控えから戻す物, 新しくした後に直したが、そのまま残せる物)"""
    expect = {it["path"]: it.get("sha256") for it in man["tracked_changes"]
              if it["kind"] != "added" and it["path"] not in man["kept_new_version"]}
    after_tracked = man.get("after_tracked") or {}
    by_update = set(incoming(man["from_commit"], man["to_commit"]))
    moved, keep = [], []
    for p, _ in tracked_changes():
        if (p in expect and current_hash(p) == expect[p]) or (p in after_tracked and current_hash(p) == after_tracked[p]):
            continue
        # 新しい版が変えていないファイルなら、前の版でも同じ中身なので、いまの中身のまま残せる
        (moved if p in by_update else keep).append(p)
    # その人の物は、新しくした時に変わった物(書き方をそろえた物・名前を替えた子の id)だけを戻す。記憶などの新しい中身は残す
    after, todo, both = man.get("after") or {}, [], []
    for item in man["user_files"]:
        p, q = item["path"], renamed_path(item["path"], man["renamed"])
        if after:
            if q not in after or after[q] == item["sha256"]:
                continue
            if current_hash(q) != after[q]:
                moved.append(q)
                both.append(item)   # 写してから戻す(--save-mine)の時だけ、控えから書き戻す
                continue
        elif not p.startswith("characters/") or current_hash(q) == item["sha256"]:
            continue
        todo.append(item)
    return sorted(set(moved)), todo, sorted(set(keep)), both


def read_now(p):
    try:
        with open(absp(p), "rb") as f:
            return f.read()
    except OSError:
        return None


def save_now(base, paths):
    """元に戻す前に、いまの中身を backups/<名前>/at_undo/ に写す。写した先の一覧"""
    out = []
    for p in paths:
        if os.path.isfile(absp(p)):
            dst = os.path.join(base, "at_undo", *p.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(absp(p), dst)
            out.append((p, rel_backup(base, f"at_undo/{p}")))
    return out


def rel_backup(base, tail):
    return f"{BACKUP_DIR}/{os.path.basename(base)}/{tail}"


def cmd_undo(args):
    found = interrupted()
    if found and found[1].get("status") == "started":
        recover()   # 新しくする途中で止まっていた時は、前のままに戻すのが「元に戻す」
        return 0
    name, man = undo_target()
    base = absp(f"{BACKUP_DIR}/{name}")
    moved, todo, keep, both = undo_plan(man)
    if moved and not args.save_mine:
        raise Stop("新しくした後に、次の物が変わっています。新しい版でも変わったファイルなので、元に戻すと、いまの中身が消えてしまいます。"
                   "何も変えずに止めました:\n" + "\n".join(f"  {p}" for p in moved) + "\n" + SAVE_MINE_HINT)
    saved = save_now(base, moved)
    todo = todo + both
    kept = {p: read_now(p) for p in keep}
    lock_changed = WEB_LOCK in incoming(man["from_commit"], man["to_commit"])
    git("reset", "-q", "--hard", man["from_commit"], timeout=MERGE_TIMEOUT)
    put_back_tracked(base, man)
    rename_back(man)
    for item in todo:
        p = item["path"]
        os.makedirs(os.path.dirname(absp(p)), exist_ok=True)
        shutil.copy2(os.path.join(base, "files", *p.split("/")), absp(p))
    for p, data in kept.items():   # 新しくした後に直した物で、新しい版が変えていない物は、いまの中身のまま
        if data is None:
            if os.path.isfile(absp(p)):
                os.remove(absp(p))
        else:
            os.makedirs(os.path.dirname(absp(p)), exist_ok=True)
            with open(absp(p), "wb") as f:
                f.write(data)
    restage(man)
    man["status"], man["undone"] = "undone", now().isoformat(timespec="seconds")
    man["saved_at_undo"] = [s for _, s in saved]
    save_manifest(base, man)
    say(f"前の版 {man['from_version']} に戻しました。控え {BACKUP_DIR}/{name} から、あなたの物を戻しました(書き戻した物 {len(todo)} 個)。")
    if keep:
        say("新しくした後にあなたが直した次のファイルは、いまの中身のまま残しました:")
        for p in keep:
            say(f"  {p}")
    if saved:
        say("元に戻す前の、いまの中身は、控えに写しました:")
        for p, s in saved:
            say(f"  {p}  → {s}")
    if lock_changed:
        run_npm_ci()
    say(restart_hint())
    return 0


# ---------- status ----------

def status_report():
    """画面向けの今のようす。元に戻せるか(can_undo)は undo_target と同じ決まり"""
    st = load_state()
    out = {"schema": "yc-update-status/1", "version": local_version(), "clone": False, "branch": None,
           "upstream": False, "last_check": st.get("last_check"), "latest": st.get("latest"), "backup": None,
           "can_undo": False, "undo_to": None, "interrupted": False}
    clone = bool(shutil.which("git")) and is_clone()
    if clone:
        branch, up, _ = branch_info()
        out.update(clone=True, branch=branch, upstream=bool(up), interrupted=bool(interrupted()))
    b = backups()
    if b:
        name, man = b[0]
        out["backup"] = {"name": name, "status": man.get("status"), "finished": man.get("finished"),
                         "from_version": man.get("from_version"), "to_version": man.get("to_version")}
    applied = [m for _, m in b if m.get("status") == "applied"]
    if clone and applied and not busy_with_merge():
        out["can_undo"] = git("rev-parse", "HEAD").strip() == applied[0].get("to_commit")
        out["undo_to"] = applied[0].get("from_version") if out["can_undo"] else None
    return out


def cmd_status(args):
    if args.json:
        say_json(status_report())
        return 0
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
    if not b:
        say("いちばん新しい控え: まだありません")
        return 0
    name, man = b[0]
    word = {"applied": "新しくした時の控え", "undone": "元に戻した控え", "failed": "途中で止めて、前のままに戻した控え",
            "started": "新しくする途中で止まった控え。「アップデートして」で直せます"}.get(man.get("status"), "控え")
    if man.get("status") == "applied" and man.get("finished") is False:
        word = "新しくした後の段の途中で止まった控え。「アップデートして」で続きをします"
    say(f"いちばん新しい控え: {BACKUP_DIR}/{name}({word}・{man.get('from_version')} → {man.get('to_version')})")
    return 0


def parse_args(argv):
    ap = argparse.ArgumentParser(prog="yuru_update", description="ゆるキャラクリエイターを新しい版にする(あなたのキャラは消しません)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="新しい版があるかを見る")
    c.add_argument("--quiet", action="store_true", help="新しい版がある時だけ 1 行出す")
    c.add_argument("--once-a-day", action="store_true", help="1 日に 1 回だけ確かめる")
    c.add_argument("--json", action="store_true", help="画面向けに、1 行の JSON で出す")
    a = sub.add_parser("apply", help="控えを取ってから、新しい版にする")
    a.add_argument("--rename", action="append", metavar="今のid=新しいid", help="見本とぶつかる自分のキャラの名前を替える")
    u = sub.add_parser("undo", help="いちばん新しい控えの時に戻す")
    u.add_argument("--save-mine", action="store_true", help="新しくした後に変わった物を、控えに写してから戻す")
    s = sub.add_parser("status", help="今の版・線・最後に見た時・いちばん新しい控え")
    s.add_argument("--json", action="store_true", help="画面向けに、1 行の JSON で出す")
    return ap.parse_args(argv)


def main(argv=None):
    if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = parse_args(argv)
    try:
        return {"check": cmd_check, "apply": cmd_apply, "undo": cmd_undo, "status": cmd_status}[args.cmd](args)
    except Stop as e:
        say(e.msg)
        return e.code
    except KeyboardInterrupt:
        if args.cmd in ("apply", "undo"):
            say(STOPPED_HINT)
            return 3
        return 0
    except (RuntimeError, TimeoutError, FileNotFoundError, OSError) as e:
        if getattr(args, "json", False):   # 画面向け: 失敗は「何も無い」として 1 行の JSON(画面は何も出さない)
            say_json({"schema": f"yc-update-{args.cmd}/1", "error": type(e).__name__, "update": False, "can_undo": False})
            return 0
        if args.cmd == "check" and args.quiet:
            return 0
        say("思わぬ所で止まりました。あなたの物は消していません。" + (UNDO_HINT if args.cmd == "apply" else ""))
        say(f"(止まった所: {type(e).__name__})")
        return 3 if args.cmd in ("apply", "undo") else 0


if __name__ == "__main__":
    sys.exit(main())
