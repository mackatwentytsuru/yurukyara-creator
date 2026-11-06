"""作る段を、新しい文脈の Claude(claude -p)に頼み、時間と使った量を run.jsonl に 1 行ずつ残す。

使い方:
  python creator/skilltest/stage_run.py claude --run <回のフォルダ> --char <id> --stage <0〜7> --name <段の名前>
         --model <モデル> --prompt <頼みの文.md> --cwd <作業フォルダ> [--add-dir <フォルダ>…] [--effort medium]
         [--timeout 3000] [--split <段の分け方.json>]
  python creator/skilltest/stage_run.py tool --run <回のフォルダ> --char <id> --stage <N> --name <名前> -- <命令…>
  python creator/skilltest/stage_run.py sum --run <回のフォルダ>
  python creator/skilltest/stage_run.py redo --run … --char … --stage … --name … --model … [--split …] [--judge-dir …]
      (記録の行だけを、残った log.jsonl と result.json から作り直す。claude は流し直さない)

- 定額のプランのログインで流す: 親の CLAUDE_CODE_* と ANTHROPIC_API_KEY・ELEVENLABS_API_KEY を外す(API の請求にしない。声の費用も出さない)。
- cost_usd は claude -p が返す total_cost_usd(定額のプランで流したので、請求ではなく定価に直した目安)。
  中で呼んだ判定役(j01_judge の answers/_usage.jsonl)の分も足す。
- 途中の様子は <回>/<N>_<名前>/log.jsonl(1 行 = {t: 受けた時刻, ev: claude の出来事})。早回しの素材と、段の分けに使う。
- --split: 1 回の claude -p で数段まとめて頼んだとき、Bash の命令の形で段に分ける({"段の番号": "正規表現", …})。
  分けた段の時間は「その段の命令が最初に出てから、次の段の命令が出るまで」、量は、その間の応答の usage の合計。
- claude を名前で止めない。時間切れは subprocess の timeout(自分で起こした子だけが止まる)。
- 人の確認(契約 K3): キャラに確認の状態(creator/work/<id>/review/state.json)があれば、始める前に
  review_state.py can-start で前の段の OK(ok か auto)を確かめ、無ければ流さずに終わりの番号 2 で止める(run.jsonl に書かない)。
  --upto M で段 N〜M をまとめて頼むときは、途中に門(人が見る段 0・2・3・4・7)があれば止める。済んだら段を done にする
  (門の無い段は auto の記録ができる)。門のある段が済んだら --publish-right(と --publish-png・--publish-views・--publish-sheet)でスマホに出す。
  --review on は状態が無ければ止める、off は見ない(記録の review に off と残す)。既定 auto は状態があるときだけ見る。
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DROP = ("ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY")
sys.path.insert(0, os.path.join(REPO, "creator", "pipeline"))
import review_gate as RG  # noqa: E402


def iso(t):
    return datetime.fromtimestamp(t, JST).isoformat(timespec="seconds")


def commit():
    try:
        return subprocess.run(["git", "-C", REPO, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    except OSError:
        return None


def plan_env(gated=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_CODE_") and k not in DROP}
    if gated:       # 確認はここで見た。中で呼ぶ段の道具(t07_talk など)は二重に見ない
        env[RG.ENV_GATED] = gated
    return env


def add_line(run_dir, row):
    os.makedirs(run_dir, exist_ok=True)
    with open(os.path.join(run_dir, "run.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("run.jsonl:", json.dumps(row, ensure_ascii=False)[:400])


def judge_costs(folder, since):
    """folder の下の answers/_usage.jsonl のうち、since より後に書かれたファイルの分を足す。"""
    cost, n = 0.0, 0
    for f in glob.glob(os.path.join(folder, "**", "_usage.jsonl"), recursive=True):
        if os.path.getmtime(f) < since:
            continue
        for line in open(f, encoding="utf-8"):
            try:
                c = json.loads(line).get("cost_usd")
            except json.JSONDecodeError:
                continue
            if isinstance(c, (int, float)):
                cost += c
                n += 1
    return round(cost, 4), n


def usage_tokens(u):
    if not u:
        return None
    return {"in": u.get("input_tokens", 0), "out": u.get("output_tokens", 0),
            "cache_read": u.get("cache_read_input_tokens", 0), "cache_write": u.get("cache_creation_input_tokens", 0)}


def split_stages(log_path, pattern_map, first_stage=None):
    """log.jsonl を、Bash の命令の形で段に分ける。行ったり来たりする作業(builder を直して骨を入れ直す、など)に合わせ、
    出来事ごとに「最後に出た命令の段」に時間と量を足す(つながった区間ではなく合計)。最初の命令の前は first_stage
    (無ければ最初に出た段)に数える。戻り値 {段: {first, last, sec, tokens}}。"""
    pats = [(int(k), re.compile(v)) for k, v in pattern_map.items()]
    events = [json.loads(line) for line in open(log_path, encoding="utf-8")]
    zero = lambda: {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}
    cur, spans, seen, prev_t = first_stage, {}, set(), None
    pending = []          # 最初の段が決まるまでの出来事
    def put(st, t, dt, u):
        sp = spans.setdefault(st, {"first": t, "last": t, "sec": 0.0, "tokens": zero()})
        sp["last"] = t
        sp["sec"] += dt
        if u:
            for k, v in usage_tokens(u).items():
                sp["tokens"][k] += v
    for e in events:
        ev = e.get("ev") or {}
        msg = ev.get("message") or {}
        content = msg.get("content")
        for c in content if isinstance(content, list) else []:
            if c.get("type") == "tool_use" and c.get("name") == "Bash":
                cmd = (c.get("input") or {}).get("command", "")
                for st, rx in pats:
                    if rx.search(cmd):
                        cur = st
                        break
        u = msg.get("usage") if ev.get("type") == "assistant" and msg.get("id") not in seen else None
        if u:
            seen.add(msg.get("id"))
        dt = 0.0 if prev_t is None else e["t"] - prev_t
        prev_t = e["t"]
        if cur is None:
            pending.append((e["t"], dt, u))
            continue
        for item in pending:
            put(cur, *item)
        pending = []
        put(cur, e["t"], dt, u)
    return spans


def gate_begin(a):
    """K3 の確かめ。戻り値 (review の印 on/off/none, 止める理由 or None)。"""
    try:
        seen = RG.begin(a.char, a.stage, a.upto, a.review, note=f"段 {a.stage}({a.name})を作っています")
    except RG.GateClosed as e:
        return None, str(e)
    return ("on" if seen else ("off" if a.review == "off" else "none")), None


def gate_finish(a, mark, ok):
    """K3 の後始末。済んだ段を done に、門の段ならスマホに出す。"""
    if mark != "on":
        return
    try:
        gate = RG.finish(a.char, a.stage, a.upto, ok)
    except RG.GateClosed as e:
        print("確認の状態を進められませんでした:", e, file=sys.stderr)
        return
    if not ok or not gate:
        return
    if a.publish_right:
        rc, out = RG.publish(a.char, gate, a.publish_right, a.publish_png, None, a.publish_views, a.publish_sheet)
        print(out)
        if rc:
            print(f"{gate} をスマホに出せませんでした", file=sys.stderr)
    else:
        print(f"段 {a.upto} は門 {gate}(人が見る段)です。python creator/review/review_state.py publish {a.char} {gate} --right <絵> でスマホに出してください")


def gated_tag(a, mark):
    return f"{a.char}:{a.stage}-{a.upto}" if mark == "on" else None


def stopped(a, why):
    print(f"止めた: 段 {a.stage}({a.name})は始めません。{why}", file=sys.stderr)
    return RG.EXIT_CLOSED


def cmd_claude(a):
    mark, why = gate_begin(a)
    if why:
        return stopped(a, why)
    work = os.path.join(a.run, f"{a.stage}_{a.name}")
    os.makedirs(work, exist_ok=True)
    prompt = open(a.prompt, encoding="utf-8").read()
    shutil.copyfile(a.prompt, os.path.join(work, "prompt.md"))
    cmd = [shutil.which("claude") or "claude", "-p", "--model", a.model, "--effort", a.effort,
           "--output-format", "stream-json", "--verbose",
           "--allowedTools", "Read Write Edit Bash Glob Grep", "--strict-mcp-config"]
    if a.light:     # 使う人の設定(フック・許可・MCP)を読まない。量が減る。スキルはリポジトリの .claude/skills から読む
        cmd += ["--setting-sources", "project"]
    for d in a.add_dir or []:
        cmd += ["--add-dir", d]
    log = os.path.join(work, "log.jsonl")
    t0 = time.time()
    result = {}
    with open(log, "w", encoding="utf-8") as lf:
        p = subprocess.Popen(cmd, cwd=a.cwd, env=plan_env(gated_tag(a, mark)), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=open(os.path.join(work, "stderr.txt"), "w", encoding="utf-8"),
                             text=True, encoding="utf-8", errors="replace")
        p.stdin.write(prompt)
        p.stdin.close()
        try:
            for line in p.stdout:
                now = time.time()
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                lf.write(json.dumps({"t": round(now, 2), "ev": ev}, ensure_ascii=False) + "\n")
                lf.flush()
                if ev.get("type") == "result":
                    result = ev
                if now - t0 > a.timeout:
                    p.kill()      # 自分で起こした子だけを止める
                    break
            p.wait(timeout=60)
        except subprocess.TimeoutExpired:
            p.kill()
    t1 = time.time()
    with open(os.path.join(work, "result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    rc = finish_row(a, work, t0, t1, result, mark)
    gate_finish(a, mark, rc == 0)
    return rc


def cmd_redo(a):
    """記録の行だけを、残った log.jsonl と result.json から作り直す(途中で落ちた時。claude は流し直さない)。"""
    work = os.path.join(a.run, f"{a.stage}_{a.name}")
    ts = [json.loads(x)["t"] for x in open(os.path.join(work, "log.jsonl"), encoding="utf-8")]
    result = json.load(open(os.path.join(work, "result.json"), encoding="utf-8"))
    return finish_row(a, work, ts[0] - 1, ts[-1], result)


def finish_row(a, work, t0, t1, result, review=None):
    log = os.path.join(work, "log.jsonl")
    jc, jn = judge_costs(a.cwd if not a.judge_dir else a.judge_dir, t0)
    main_cost = result.get("total_cost_usd")
    row = {"run": os.path.basename(os.path.abspath(a.run)), "char": a.char, "stage": a.stage, "name": a.name,
           "start": iso(t0), "end": iso(t1), "sec": round(t1 - t0), "actor": f"claude:{a.model}:{a.effort}",
           "cost_usd": round((main_cost or 0) + jc, 4) if main_cost is not None else None,
           "cost_detail": {"maker": main_cost, "judges": jc, "judge_calls": jn},
           "tokens": usage_tokens(result.get("usage")), "turns": result.get("num_turns"),
           "ok": result.get("subtype") == "success" and not result.get("is_error", False),
           "commit": commit(), "note": "定額のプランで流した。cost_usd は定価に直した目安"}
    if review:
        row["review"] = review
    if getattr(a, "upto", None) not in (None, a.stage):
        row["upto"] = a.upto
    if a.split:
        sm = json.load(open(a.split, encoding="utf-8"))
        first = sm.pop("first", None)
        spans = split_stages(log, sm, first)
        tot = sum(sum(sp["tokens"].values()) for sp in spans.values()) or 1
        row["stages"] = {str(st): {"first": iso(sp["first"]), "last": iso(sp["last"]), "sec": round(sp["sec"]),
                                   "tokens": sp["tokens"],
                                   "cost_usd_share": round((main_cost or 0) * sum(sp["tokens"].values()) / tot, 4)}
                         for st, sp in sorted(spans.items())}
    add_line(a.run, row)
    return 0 if row["ok"] else 1


def cmd_tool(a):
    mark, why = gate_begin(a)
    if why:
        return stopped(a, why)
    t0 = time.time()
    p = subprocess.run(a.cmd, cwd=a.cwd, env=plan_env(gated_tag(a, mark)))
    t1 = time.time()
    row = {"run": os.path.basename(os.path.abspath(a.run)), "char": a.char, "stage": a.stage, "name": a.name,
           "start": iso(t0), "end": iso(t1), "sec": round(t1 - t0, 1), "actor": "tool:" + os.path.basename(a.cmd[0] if len(a.cmd) == 1 else a.cmd[1]),
           "cost_usd": 0, "tokens": None, "ok": p.returncode == 0, "commit": commit(), "note": " ".join(a.cmd)[-200:], "review": mark}
    if a.upto != a.stage:
        row["upto"] = a.upto
    add_line(a.run, row)
    gate_finish(a, mark, p.returncode == 0)
    return p.returncode


def cmd_sum(a):
    rows = [json.loads(x) for x in open(os.path.join(a.run, "run.jsonl"), encoding="utf-8")]
    sec = sum(r.get("sec") or 0 for r in rows)
    cost = sum(r.get("cost_usd") or 0 for r in rows)
    for r in rows:
        print(f"段 {r['stage']} {r['name']}: {r['sec']} 秒・{r.get('cost_usd')} ドル・{'ok' if r['ok'] else 'NG'}・{r['actor']}")
    print(f"合計: {sec / 60:.1f} 分・{cost:.2f} ドル(定価に直した目安。定額のプランで流した)")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd_name", required=True)
    c = sub.add_parser("claude")
    r = sub.add_parser("redo")
    t = sub.add_parser("tool")
    s = sub.add_parser("sum")
    for x in (c, r, t, s):
        x.add_argument("--run", required=True)
    for x in (c, r, t):
        x.add_argument("--char", required=True)
        x.add_argument("--stage", type=int, required=True)
        x.add_argument("--name", required=True)
        x.add_argument("--cwd", default=REPO)
    for x in (c, r):
        x.add_argument("--model", required=True)
        x.add_argument("--effort", default="medium")
        x.add_argument("--split")
        x.add_argument("--judge-dir")
    c.add_argument("--prompt", required=True)
    c.add_argument("--add-dir", action="append")
    c.add_argument("--timeout", type=int, default=3000)
    c.add_argument("--light", action="store_true", help="--setting-sources project で流す(使う人の設定を読まない)")
    for x in (c, t):
        x.add_argument("--upto", type=int, help="1 回で段 --stage〜--upto をまとめて作る(途中に門があれば止める)")
        x.add_argument("--review", choices=["auto", "on", "off"], default="auto",
                       help="人の確認(K3)を見るか。auto = 確認の状態があるときだけ見る")
        x.add_argument("--publish-right", help="門の段が済んだらスマホに出す絵(C0 は描いた SVG、C2 は正面の絵)")
        x.add_argument("--publish-png")
        x.add_argument("--publish-views")
        x.add_argument("--publish-sheet")
    t.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    if a.cmd_name == "tool" and a.cmd and a.cmd[0] == "--":
        a.cmd = a.cmd[1:]
    if a.cmd_name in ("claude", "tool") and a.upto is None:
        a.upto = a.stage
    sys.exit({"claude": cmd_claude, "redo": cmd_redo, "tool": cmd_tool, "sum": cmd_sum}[a.cmd_name](a) or 0)


if __name__ == "__main__":
    main()
