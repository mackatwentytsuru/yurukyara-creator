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
- 終わりの番号: 0 = できた(新しい版にした・もう新しい・見た)、1 = 何も変えずに止めた、3 = 途中で止まった。
- 部品(使う人の物の地図・控え・版の読み方)は tools/yuru_update_core.py。試験は tools/test_yuru_update.py。
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I でも部品を読めるように
from yuru_update_core import (  # noqa: E402
    BACKUP_DIR, DOCTOR, ID_FORM, MERGE_TIMEOUT, OFFERS, REQ_FILE, UNDO_HINT, WEB_LOCK,
    Offline, Stop, absp, after_hashes, backups, branch_info, busy_with_merge, collisions_message,
    current_hash, fetch, git, incoming, is_clone, is_newer, load_state, local_version, make_backup,
    my_character_ids, now, put_back, put_back_tracked, rename_back, rename_character, renamed_path, run,
    save_manifest, save_state, say, show_news, tracked_changes, tracked_set, user_files, version_at,
)

NPM_TIMEOUT = 900
TOOL_TIMEOUT = 120
DOCTOR_TIMEOUT = 60
NODE_TIMEOUT = 30
RESTART_HINT = "アプリ(npm start)を動かしていたら、一度止めて、もう一度 npm start で起こしてください。"


# ---------- check ----------

def cmd_check(args):
    if args.once_a_day and load_state().get("last_try", "")[:10] == now().date().isoformat():
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
    """見本と同じ id の自分のキャラがあれば、名前を替える OK が無い限り止める"""
    added = [p for p, st in changes_in.items() if st.startswith("A")]
    new_ids = {p.split("/")[1] for p in added if p.startswith("characters/") and p.count("/") >= 2}
    taken = set(os.listdir(absp("characters"))) if os.path.isdir(absp("characters")) else set()
    for old, new in renames.items():
        if old not in mine:
            raise Stop(f"「{old}」は、あなたが作ったキャラの中にありません。名前を確かめてください。")
        if new in taken or new in new_ids or any(p.startswith(f"characters/{new}/") for p in tracked):
            raise Stop(f"「{new}」は、もう使われている名前です。別の名前にしてください。")
    left = sorted(i for i in set(mine) & new_ids if i not in renames)
    if left:
        raise Stop(collisions_message(left))
    return added


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
    added = check_renames(renames, changes_in, my_character_ids(tracked), tracked)
    files, changes = user_files(tracked), tracked_changes()
    mine = set(files)
    blocked = [p for p in added if p in mine and not any(p.startswith(f"characters/{i}/") for i in renames)]
    if blocked:
        raise Stop("新しい版に、あなたのファイルと同じ名前の物が入るので、何も変えずに止めました:\n" +
                   "\n".join(f"  {p}" for p in blocked) + "\nそのファイルを別の場所へ動かしてから、もう一度ためしてください。")
    info = {"from_commit": head, "from_version": ours, "branch": branch, "upstream": up,
            "to_commit": target, "to_version": theirs}
    return {"info": info, "renames": renames, "changes_in": changes_in, "files": files, "changes": changes}, ours


def switch_version(plan, base, man):
    """名前を替え、その人が直したファイルをいったん戻し、新しい版へ進める。止まったら前のままに戻す"""
    head, target = man["from_commit"], man["to_commit"]
    try:
        for old, new in plan["renames"].items():
            rename_character(old, new)
            man["renamed"].append({"from": old, "to": new})
            say(f"あなたのキャラの名前を替えました: {old} → {new}")
        back = [p for p, k in plan["changes"] if k != "added"]
        staged = [p for p, k in plan["changes"] if k == "added"]
        for i in range(0, len(back), 50):
            git("checkout", "-q", "HEAD", "--", *back[i:i + 50])
        for i in range(0, len(staged), 50):
            git("reset", "-q", "--", *staged[i:i + 50])
        git("merge", "--ff-only", "-q", target, timeout=MERGE_TIMEOUT)
    except (RuntimeError, TimeoutError, OSError) as e:
        ok = put_back(base, man, head)
        man["status"] = "failed"
        save_manifest(base, man)
        if ok:
            raise Stop("新しくする途中で止まったので、前のままに戻しました。あなたの物はそのままです。", code=3) from e
        raise Stop(f"新しくする途中で止まりました。あなたの物の控えは {BACKUP_DIR}/ にあります。"
                   "python tools/yuru_update.py status で、今の版を見られます。", code=3) from e


def tell_both_sides(name, both):
    if not both:
        return
    say("あなたが直した次のファイルは、新しい版でも直されていました。新しい版の物を使い、あなたの物は控えに残しました:")
    for p in both:
        say(f"  {p}  → 控え: {BACKUP_DIR}/{name}/tracked/{p}")


def after_switch(plan, name, base, man):
    """新しい版になった後: 直したファイルを戻す・部品・書き方をそろえる・確かめ・新しい事と表現"""
    changes_in, info = plan["changes_in"], plan["info"]
    both = [p for p, k in plan["changes"] if k != "added" and p in changes_in]
    put_back_tracked(base, man, skip=set(both))
    man["kept_new_version"] = both
    man["status"] = "applied"
    save_manifest(base, man)
    ours, theirs = info["from_version"], info["to_version"]
    keep = "あなたのキャラ・性格・声・記憶・設定は、そのままです。"
    say(f"新しい版 {theirs} になりました(前は {ours})。{keep}" if is_newer(theirs, ours)
        else f"小さな直しを入れました(版は {theirs})。{keep}")
    tell_both_sides(name, both)
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
    save_manifest(base, man)
    say(RESTART_HINT)
    say(UNDO_HINT)


def cmd_apply(args):
    plan, ours = plan_apply(args)
    if plan is None:
        say(f"もう、いちばん新しい版です({ours})。何も変えていません。")
        return 0
    name, base, man = make_backup(plan["info"], plan["files"], plan["changes"])
    say(f"控えを取りました: {BACKUP_DIR}/{name}(あなたの物 {len(plan['files'])} 個・あなたが直したファイル {len(plan['changes'])} 個)")
    switch_version(plan, base, man)
    after_switch(plan, name, base, man)
    return 0


# ---------- 新しくした後の段 ----------

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
    """(新しくした後に、その人が変えた物, 控えから戻す物)。変えた物があれば、元に戻すと消えてしまう"""
    expect = {it["path"]: it.get("sha256") for it in man["tracked_changes"]
              if it["kind"] != "added" and it["path"] not in man["kept_new_version"]}
    after_tracked = man.get("after_tracked") or {}
    moved = [p for p, _ in tracked_changes()
             if not (p in expect and current_hash(p) == expect[p])
             and not (p in after_tracked and current_hash(p) == after_tracked[p])]
    # その人の物は、新しくした時に変わった物(書き方をそろえた物・名前を替えた子の id)だけを戻す。記憶などの新しい中身は残す
    after, todo = man.get("after") or {}, []
    for item in man["user_files"]:
        p, q = item["path"], renamed_path(item["path"], man["renamed"])
        if after:
            if q not in after or after[q] == item["sha256"]:
                continue
            if current_hash(q) != after[q]:
                moved.append(q)
                continue
        elif not p.startswith("characters/") or current_hash(q) == item["sha256"]:
            continue
        todo.append(item)
    return sorted(set(moved)), todo


def cmd_undo(args):
    name, man = undo_target()
    base = absp(f"{BACKUP_DIR}/{name}")
    moved, todo = undo_plan(man)
    if moved:
        raise Stop("新しくした後に、次の物が変わっています。元に戻すと消えてしまうので、何も変えずに止めました:\n" +
                   "\n".join(f"  {p}" for p in moved) +
                   "\n残したい物を別の場所へ写してから、もう一度「元に戻して」と頼んでください。")
    lock_changed = WEB_LOCK in incoming(man["from_commit"], man["to_commit"])
    git("reset", "-q", "--hard", man["from_commit"], timeout=MERGE_TIMEOUT)
    put_back_tracked(base, man)
    rename_back(man)
    for item in todo:
        p = item["path"]
        os.makedirs(os.path.dirname(absp(p)), exist_ok=True)
        shutil.copy2(os.path.join(base, "files", *p.split("/")), absp(p))
    man["status"], man["undone"] = "undone", now().isoformat(timespec="seconds")
    save_manifest(base, man)
    say(f"前の版 {man['from_version']} に戻しました。控え {BACKUP_DIR}/{name} から、あなたの物を戻しました(書き戻した物 {len(todo)} 個)。")
    if lock_changed:
        run_npm_ci()
    say(RESTART_HINT)
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
    if not b:
        say("いちばん新しい控え: まだありません")
        return 0
    name, man = b[0]
    word = {"applied": "新しくした時の控え", "undone": "元に戻した控え", "failed": "途中で止めた控え"}.get(man.get("status"), "控え")
    say(f"いちばん新しい控え: {BACKUP_DIR}/{name}({word}・{man.get('from_version')} → {man.get('to_version')})")
    return 0


def parse_args(argv):
    ap = argparse.ArgumentParser(prog="yuru_update", description="ゆるキャラクリエイターを新しい版にする(あなたのキャラは消しません)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="新しい版があるかを見る")
    c.add_argument("--quiet", action="store_true", help="新しい版がある時だけ 1 行出す")
    c.add_argument("--once-a-day", action="store_true", help="1 日に 1 回だけ確かめる")
    a = sub.add_parser("apply", help="控えを取ってから、新しい版にする")
    a.add_argument("--rename", action="append", metavar="今のid=新しいid", help="見本とぶつかる自分のキャラの名前を替える")
    sub.add_parser("undo", help="いちばん新しい控えの時に戻す")
    sub.add_parser("status", help="今の版・線・最後に見た時・いちばん新しい控え")
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
    except (RuntimeError, TimeoutError, FileNotFoundError, OSError) as e:
        if args.cmd == "check" and args.quiet:
            return 0
        say("思わぬ所で止まりました。あなたの物は消していません。" + (UNDO_HINT if args.cmd == "apply" else ""))
        say(f"(止まった所: {type(e).__name__})")
        return 3 if args.cmd in ("apply", "undo") else 0


if __name__ == "__main__":
    sys.exit(main())
