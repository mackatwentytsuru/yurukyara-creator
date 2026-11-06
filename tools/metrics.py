#!/usr/bin/env python3
"""ログと記録から docs/metrics.md を自動で作る(手で数字を書かない)。

使い方(入力の場所は引数か環境変数。リポジトリの中には絶対パスを書かない):

  python tools/metrics.py \
      --run  <ラベル>=<作業役のログのフォルダ> ...   # log.jsonl(stream-json)と result.json が入っている
      --record <ラベル>=<手順の記録 record.md> ...    # 同じラベルの run と組になる(体ごとの時間)
      --tests-log <node --test の出力>               # 無ければ --run-tests で web/ の試験を流して数える
      [--hook-log <フックの記録 .jsonl>]              # 無ければ「未集計」と書く
      [--check-numbers]                              # 表の数字がすべて入力か計算から出ていることを確かめる

環境変数でも渡せる: METRICS_RUNS / METRICS_RECORDS(`ラベル=パス` を OS の区切り文字 os.pathsep でつなぐ)、
METRICS_TESTS_LOG、METRICS_HOOK_LOG、METRICS_SCRUB_TERMS(消したい語を , でつなぐ)、METRICS_SCRUB_FILE。

出力:
  docs/metrics.md          自動生成の表(日付・条件・出どころつき)。同じ入力なら同じ出力(生成した日は入れない)。
  docs/runs/<ラベル>.md    生の記録(stream-json)から、絶対パス・ユーザー名・ホスト名・鍵を消した要約だけ。
生の記録そのもの(log.jsonl)はリポジトリに入れない。

フックの記録の形(あれば数える): 1 行 1 件の JSON。{"hook": "名前", "decision": "block"} のように、
decision が block / deny / stop のとき、または "blocked": true のとき「止めた」と数える。

標準ライブラリだけで動く。
"""
import argparse
import getpass
import importlib.util
import json
import os
import platform
import re
import socket
import statistics
import subprocess
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK = "<!-- 自動生成: tools/metrics.py。手で直さない(直すなら入力の記録を直して作り直す) -->"
NUM_RE = re.compile(r"\d+(?:\.\d+)?")
JUDGE_CELL = re.compile(r"(\d)・(\d) ?([○×])")
JUDGE_CELL_B = re.compile(r"(\d)/3・(\d)/3")
FAIL_MARKS = ("不合格", "NG", "時間切れ", "残る")
STATUS_COLS = ("合否", "検査", "検査の最後", "ブラウザ再生", "⑦")
# 検査の道具を呼んだ回数を数える語(記録の Bash の命令に含まれるか)
TOOL_KEYWORDS = ("check_all", "web_talk_check", "j01_judge", "s03_compare", "m03_contact", "s05_gaps")


# ---------------------------------------------------------------- 数字の台帳
class Ledger:
    """表に出す数字は、入力の文字から写したか、計算して n() で登録したものだけ、を確かめるための台帳。"""

    def __init__(self):
        self.ok = set()

    def feed(self, text):
        self.ok.update(NUM_RE.findall(text))

    def n(self, v, nd=1):
        s = str(v) if isinstance(v, int) else f"{v:.{nd}f}"
        self.ok.update(NUM_RE.findall(s))
        return s

    def untraced(self, md):
        bad = []
        for line in md.splitlines():
            if not line.startswith("|") or set(line) <= set("|-: "):
                continue
            for tok in NUM_RE.findall(line):
                if tok not in self.ok:
                    bad.append((tok, line[:80]))
        return bad


# ---------------------------------------------------------------- 消毒
class SanitizeError(Exception):
    pass


WIN_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s\"'<>|*?]*")
UNC_PATH = re.compile(r"\\\\[^\\\s\"']+(?:\\[^\\\s\"']*)*")
POSIX_PATH = re.compile(
    r"(?<![\w/.:~-])/(?:[\w.@+-]+/)+[\w.@+-]*|(?<![\w/.:~-])/(?:home|Users|root|tmp|var|etc|opt|usr|mnt)\b[^\s\"']*",
    re.I,
)
USER_HARVEST = [
    re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s\"']+)", re.I),
    re.compile(r"/(?:home|Users)/([^/\s\"']+)", re.I),
    re.compile(r"\\\\([^\\\s\"']+)\\"),
]
ATHOST = re.compile(r"\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)*)")
URL_HOST = re.compile(r"(https?://)([^/\s\"')>\]]+)")
URL_OK = {"github.com", "claude.com", "claude.ai", "anthropic.com", "docs.anthropic.com", "elevenlabs.io", "localhost", "127.0.0.1"}
HOSTLIKE = re.compile(r"\b[\w-]+\.(?:local|lan|internal|home|ts\.net|corp)\b", re.I)
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
KEYLIKE = re.compile(r"sk-ant-[A-Za-z0-9_-]{6,}|sk_[a-f0-9]{20,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}")
SECRET_ASSIGN = re.compile(r"(?i)\b(api[_-]?key|token|password|secret)\b(\s*[=:]\s*)\S+")
COMMON_WORDS = {"user", "users", "admin", "root", "home", "public", "default", "guest", "localhost", "host", "pc"}


def env_terms():
    names = [getpass.getuser(), socket.gethostname(), platform.node()]
    for k in ("USERNAME", "USER", "LOGNAME", "COMPUTERNAME", "HOSTNAME", "USERDOMAIN"):
        names.append(os.environ.get(k, ""))
    out = set()
    for t in names:
        for part in re.split(r"[.\s]", t or ""):
            if len(part) >= 3 and part.lower() not in COMMON_WORDS:
                out.add(part)
    return out


def file_terms(path):
    try:
        with open(path, encoding="utf-8") as f:
            return {t.strip() for t in f if t.strip() and not t.lstrip().startswith("#")}
    except OSError:
        return set()


def build_terms(extra=(), scrub_file=None):
    terms = set(env_terms()) | {t for t in extra if t}
    for p in (scrub_file, os.path.join(ROOT, "tools", "prepush_terms.local.txt")):
        if p:
            terms |= file_terms(p)
    return {t for t in terms if len(t) >= 3}


def _term_re(terms):
    parts = []
    for t in sorted(terms, key=len, reverse=True):
        if t.isascii() and len(t) < 4:
            parts.append(r"(?<![A-Za-z0-9_])" + re.escape(t) + r"(?![A-Za-z0-9_])")
        else:
            parts.append(re.escape(t))
    return re.compile("|".join(parts), re.I) if parts else None


def sanitize(text, terms=()):
    """絶対パス・ユーザー名・ホスト名・鍵を消す。パスの中から見つけた名前も、ほかの場所から消す。"""
    terms = set(terms)
    for rx in USER_HARVEST:
        for m in rx.finditer(text):
            if len(m.group(1)) >= 3 and m.group(1).lower() not in COMMON_WORDS:
                terms.add(m.group(1))
    for m in ATHOST.finditer(text):
        for part in (m.group(1), m.group(2).split(".")[0]):
            if len(part) >= 3 and part.lower() not in COMMON_WORDS:
                terms.add(part)
    text = UNC_PATH.sub("<path>", text)
    text = WIN_PATH.sub("<path>", text)
    text = POSIX_PATH.sub("<path>", text)
    text = KEYLIKE.sub("<key>", text)
    text = SECRET_ASSIGN.sub(lambda m: m.group(1) + m.group(2) + "<key>", text)
    text = ATHOST.sub("<name>@<host>", text)
    text = URL_HOST.sub(lambda m: m.group(1) + (m.group(2) if m.group(2).split(":")[0].lower() in URL_OK else "<host>"), text)
    text = HOSTLIKE.sub("<host>", text)
    text = IPV4.sub("<ip>", text)
    rx = _term_re(terms)
    if rx:
        text = rx.sub("<name>", text)
    return text, terms


def assert_clean(text, terms=()):
    """消し残しがあれば止める(出力を書く前の最後の関所)。"""
    problems = []
    for name, rx in (("絶対パス", WIN_PATH), ("UNC パス", UNC_PATH), ("絶対パス(posix)", POSIX_PATH), ("鍵", KEYLIKE), ("IP", IPV4)):
        m = rx.search(text)
        if m:
            problems.append(f"{name}: {m.group(0)[:20]}")
    rx = _term_re(set(terms))
    if rx and rx.search(text):
        problems.append("ユーザー名・ホスト名・消したい語が残っている")
    if problems:
        raise SanitizeError("消し残し: " + " / ".join(problems))


# ---------------------------------------------------------------- 入力の読み取り
def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def file_date(root, path):
    """入力ファイルの日付。git の最後のコミット日(無ければ更新日)。同じ入力なら同じ値。"""
    try:
        rel = os.path.relpath(path, root)
        if not rel.startswith(".."):
            out = subprocess.run(["git", "-C", root, "log", "-1", "--format=%cs", "--", rel],
                                 capture_output=True, text=True, encoding="utf-8", timeout=30).stdout.strip()
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", out):
                return out
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d")


def parse_md_tables(text):
    """Markdown の表を、直前の見出し(## と ###)つきで取り出す。"""
    tables, h2, h3, cur = [], "", "", None
    for line in text.splitlines():
        if line.startswith("### "):
            h3 = line[4:].strip()
        elif line.startswith("## "):
            h2, h3 = line[3:].strip(), ""
        if line.startswith("|"):
            cells = [c.strip().replace("**", "") for c in line.strip().strip("|").split("|")]
            if cur is None:
                cur = {"h2": h2, "h3": h3, "header": cells, "rows": [], "sep": False}
            elif not cur["sep"]:
                cur["sep"] = True
            else:
                cur["rows"].append(cells)
        elif cur is not None:
            tables.append(cur)
            cur = None
    if cur is not None:
        tables.append(cur)
    return tables


def short(title):
    return title.split("(")[0].strip()


def first_number(cell, pattern):
    m = re.search(pattern, cell)
    return float(m.group(1)) if m else None


def parse_timing(md_text):
    """結果表の「時間」と「費用」の列がある表を、1 行ずつ読む。"""
    rows = []
    for t in parse_md_tables(md_text):
        hd = t["header"]
        ci = next((i for i, h in enumerate(hd) if h.startswith("費用")), None)
        ti = next((i for i, h in enumerate(hd) if h.startswith("時間")), None)
        if ci is None or ti is None:
            continue
        mi = next((i for i, h in enumerate(hd) if h.startswith("モデル")), None)
        status = [i for i, h in enumerate(hd) if h in STATUS_COLS]
        steps = next((i for i, h in enumerate(hd) if "工程" in h), None)
        for r in t["rows"]:
            if len(r) <= max(ci, ti):
                continue
            label = r[0] + (" " + r[1] if len(hd) > 1 and hd[1] in ("回", "題材") and len(r) > 1 else "")
            minutes = first_number(r[ti], r"([\d.]+) 分")
            cost = first_number(r[ci], r"\$([\d.]+)")
            timeout = "時間切れ" in r[ti]
            model_src = r[mi] if mi is not None else t["h2"]
            model = next((m for m in ("Opus", "Haiku", "Sonnet") if m in model_src), "モデルは表に無い")
            failed = timeout or any(k in r[i] for i in status for k in FAIL_MARKS)
            if steps is not None:
                m = re.match(r"(\d+)/(\d+)", r[steps])
                failed = failed or bool(m and int(m.group(1)) < int(m.group(2)))
            rows.append(dict(section=short(t["h2"]), model=model, label=label, minutes=minutes, cost=cost,
                             estimated="推定" in r[ci], timeout=timeout, passed=not failed))
    return rows


def parse_judge_tables(md_text):
    """「Claude の判定」の節の表から、問い(列)ごとに、通った数・各判定役の はい の数を数える。"""
    out = []
    for t in parse_md_tables(md_text):
        if not t["h2"].startswith("Claude の判定"):
            continue
        for ci, name in enumerate(t["header"]):
            if ci == 0:  # 先頭の列は題材の名前(説明の中の数字を拾わない)
                continue
            n = ok = hy = sy = split = 0
            for r in t["rows"]:
                if r and "合計" in r[0]:
                    continue
                m = JUDGE_CELL.search(r[ci]) if ci < len(r) else None
                if not m:
                    continue
                h, s = int(m.group(1)), int(m.group(2))
                n += 1
                ok += (h >= 2 and s >= 2)
                hy += (h >= 2)
                sy += (s >= 2)
                split += ((h >= 2) != (s >= 2))
            if n:
                out.append(dict(table=short(t["h3"]) or short(t["h2"]), axis=short(name), n=n, ok=ok, haiku=hy, sonnet=sy, split=split))
    return out


def parse_rebuild_judges(label, text):
    """作り直した体の最後の判定(record.md の 2 つの書き方に対応)。"""
    res = {}
    for t in parse_md_tables(text):
        hd = t["header"]
        if len(hd) >= 3 and hd[0] == "" :
            for r in t["rows"]:
                if r[0].startswith("判定(最後の回"):
                    for ci in range(1, len(hd)):
                        axes = []
                        for m in re.finditer(r"([^\s/|]+) (\d)・(\d) ([○×])", r[ci]):
                            axes.append((m.group(1), int(m.group(2)), int(m.group(3))))
                        res[hd[ci]] = dict(round="最後", axes=axes)
        elif "同じキャラ" in hd and "回" in hd and "キャラ" in hd:
            ki, ri, hi = hd.index("キャラ"), hd.index("回"), hd.index("同じキャラ")
            extra = [i for i, h in enumerate(hd) if h in ("色", "毛足", "難しい部分")]
            by = {}
            for r in t["rows"]:
                by.setdefault(r[ki], []).append(r)
            for who, rs in by.items():
                last = max(rs, key=lambda r: int(r[ri]))
                axes = []
                for ci in [hi] + extra:
                    m = JUDGE_CELL_B.search(last[ci])
                    if not m:
                        continue
                    name = hd[ci]
                    if name == "難しい部分":
                        nm = next((re.sub(r"\s*\d/3.*$", "", x[ci]).strip() for x in rs if re.sub(r"\s*\d/3.*$", "", x[ci]).strip()), "")
                        name = f"難しい部分({nm})" if nm else name
                    axes.append((name, int(m.group(1)), int(m.group(2))))
                res[who] = dict(round=f"{last[ri]} 回目", axes=axes)
    return res


def parse_char_times(text):
    """体ごとの時間。「全体: 始め → 終わり」か「合計 約 N 分」を、直前の「### 体の名前」の下から読む。"""
    out, cur = [], None
    for ln, line in enumerate(text.splitlines(), 1):
        m = re.match(r"###\s+([A-Za-z_][A-Za-z0-9_]*)", line)
        if m:
            cur = m.group(1)
            continue
        if cur is None:
            continue
        m = re.search(r"全体:\s*(\d\d:\d\d(?::\d\d)?)\s*→\s*(?:約\s*)?(\d\d:\d\d(?::\d\d)?)", line)
        if m:
            a, b = [sum(int(x) * 60 ** (1 - i) for i, x in enumerate(s.split(":")[:2])) + (int(s.split(":")[2]) / 60 if s.count(":") == 2 else 0)
                    for s in m.groups()]
            out.append(dict(name=cur, minutes=b - a, kind="全体(始め→終わりの時刻から計算。元の絵を描く時間は含まない)", line=ln))
            continue
        m = re.search(r"合計\s*約\s*(\d+)\s*分", line)
        if m:
            out.append(dict(name=cur, minutes=float(m.group(1)), kind="記録の「合計」の値(記録の書き方による)", line=ln))
    return out


def load_result_event(run_dir):
    """log.jsonl の最後の result 行。無ければ result.json。"""
    res = None
    log = os.path.join(run_dir, "log.jsonl")
    if os.path.exists(log):
        with open(log, encoding="utf-8") as f:
            for line in f:
                if '"type":"result"' in line.replace('"type": "result"', '"type":"result"'):
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    if d.get("type") == "result":
                        res = d
    if res is None:
        p = os.path.join(run_dir, "result.json")
        if os.path.exists(p):
            res = json.loads(read_text(p))
    return res


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def summarize_run(label, run_dir, terms):
    """生の記録から数字だけを取り出す(自由な文は、task の説明だけ。出力の前に消毒する)。"""
    log = os.path.join(run_dir, "log.jsonl")
    info = dict(label=label, tools={}, errors=0, denied={}, rate_limit=0, skills=[], tool_kw={k: 0 for k in TOOL_KEYWORDS},
                tasks=[], buckets={}, t0=None, t1=None, model="", version="", mode="")
    if not os.path.exists(log):
        raise SystemExit(f"log.jsonl が見つからない: {label}")
    with open(log, encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            ty = d.get("type")
            ts = parse_ts(d["timestamp"]) if d.get("timestamp") else None
            if ts:
                info["t0"] = info["t0"] or ts
                info["t1"] = ts
            if ty == "system":
                sub = d.get("subtype")
                if sub == "init":
                    info["model"], info["version"], info["mode"] = d.get("model", ""), d.get("claude_code_version", ""), d.get("permissionMode", "")
                elif sub == "permission_denied":
                    info["denied"][d.get("tool_name", "?")] = info["denied"].get(d.get("tool_name", "?"), 0) + 1
                elif sub == "task_started" and d.get("description"):
                    info["tasks"].append(d["description"])
            elif ty == "rate_limit_event":
                info["rate_limit"] += 1
            elif ty == "assistant":
                for b in d.get("message", {}).get("content", []):
                    if b.get("type") != "tool_use":
                        continue
                    nm = b.get("name", "?")
                    info["tools"][nm] = info["tools"].get(nm, 0) + 1
                    inp = b.get("input") or {}
                    if nm == "Read":
                        m = re.search(r"skills[\\/]+([^\\/]+)[\\/]+SKILL\.md", str(inp.get("file_path", "")))
                        if m and m.group(1) not in info["skills"]:
                            info["skills"].append(m.group(1))
                    if nm == "Bash":
                        cmd = str(inp.get("command", ""))
                        for k in TOOL_KEYWORDS:
                            if k in cmd:
                                info["tool_kw"][k] += 1
                    if ts and info["t0"]:
                        bk = int((ts - info["t0"]).total_seconds() // 600)
                        info["buckets"][bk] = info["buckets"].get(bk, 0) + 1
            elif ty == "user":
                content = d.get("message", {}).get("content", [])
                if isinstance(content, list):
                    info["errors"] += sum(1 for b in content if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"))
    info["result"] = load_result_event(run_dir)
    return info


def parse_tests_log(text):
    out = {}
    for m in re.finditer(r"^[#ℹ]\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$", text, re.M):
        out[m.group(1)] = int(m.group(2))
    return out


def run_node_tests(web_dir):
    p = subprocess.run(["node", "--test"], cwd=web_dir, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    return p.stdout + p.stderr


def parse_hook_log(paths):
    n = blocked = 0
    per = {}
    for p in paths:
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            for line in f:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(d, dict):
                    continue
                n += 1
                name = str(d.get("hook", "?"))
                per.setdefault(name, [0, 0])[0] += 1
                if str(d.get("decision", "")).lower() in ("block", "deny", "stop") or d.get("blocked") is True:
                    blocked += 1
                    per[name][1] += 1
    return n, blocked, per


# ---------------------------------------------------------------- 契約 K6(数字の記録の形。持ち主 S6、S5 と)
# 版 1(2026-11-06 下書き)。欄を足すのは持ち主の判断でよい。消す・名前を変えるときは版を上げる。
K6_CONTRACT = [
    "## 0. 数字の記録の形(契約 K6 版 1)",
    "",
    "数字は次の 2 つの記録からだけ取る。手で書いた数字は表に入れない。",
    "",
    "**作る段の記録 `run.jsonl`**(S1 が書く。置き場所 `creator/work/<id>/run.jsonl`。リポジトリには入れず、"
    "`tools/metrics.py` が消毒した要約だけを `docs/runs/` に出す)。1 行 1 件の JSON で、欄は次のとおり:",
    "",
    "- `ts`(ISO 8601、`+09:00` つき)・`id`(キャラ)・`stage`(`check`・`draw`・`look`・`shape`・`material`・`motion`・`talk`)",
    "- `event`(`start`・`end`・`fail`・`review`)・`ok`(真偽。`end` と `review` のとき)・`source`(`text` か `image`)",
    "- `duration_ms`・`cost_usd`(測っていなければ `null`。推しはかった値は入れない)・`model`・`tokens_in`・`tokens_out`",
    "- `commit`(`git rev-parse --short HEAD`)・`note`(40 字まで。パス・機械の名前・鍵を書かない)",
    "",
    "**描画の重さ `?perf=1`**(S5 が書く)。ページを `?perf=1` で開くと、決まった秒数を測ったあと `window.__perf` に入れ、"
    "コンソールへ `PERF ` に続けて 1 行の JSON を出す。欄: `commit`・`device`(`desktop`・`mobile`・`xr`)・`renderer`"
    "(WebGL の描画役の名前。`SwiftShader` なら測った値として使わない)・`id`・`tier`・`seconds`・`fps_median`・"
    "`frame_ms_p50`・`frame_ms_p95`・`draw_calls`・`triangles`・`load_ms`・`glb_bytes`。保存先は `docs/runs/perf/<日付>_<device>.json`。",
    "",
    "`tools/metrics.py` がこの 2 つを読んで表にするのは、記録が出始めてから(今の版はまだ読まない)。",
    "",
]


# ---------------------------------------------------------------- 表の組み立て
def esc(s):
    return str(s).replace("|", "/")


def render(cfg, L):
    root = cfg["root"]
    sk = cfg["skilltest"]
    out = [MARK, "", "# 数字(ログから自動で作った表)", "",
           "この文書の数字は、すべてログ・記録・試験の出力から `tools/metrics.py` が出した値です。手で書いた数字はありません",
           "(表の数字がすべて入力か計算から出たことは `--check-numbers` で確かめます)。時間切れや落ちた項目も隠していません。",
           "生成した日は入れていません(同じ入力なら同じ出力です)。表ごとの日付は、入力ファイルの最後のコミット日か、記録の時刻です。", ""]
    out += K6_CONTRACT

    # --- 1 作り直した 体(SVG の元の絵)
    runs = cfg["runs"]
    infos = {lab: summarize_run(lab, d, cfg["terms"]) for lab, d in runs.items()}
    cfg["_infos"] = infos
    times = {}
    for lab, p in cfg["records"].items():
        txt = read_text(p)
        L.feed(txt)
        times[lab] = parse_char_times(txt)
    out += ["## 1. 作り直した体(元の絵を SVG で描いた回)の時間と費用", ""]
    out += ["| 体 | 作業役 | 作業時間(分) | 時間の範囲 | 作業役のセッション全体(分) | セッション費用(USD) | 体あたりの平均費用(USD) |", "|---|---|---|---|---|---|---|"]
    stamps = []
    for lab in runs:
        info, res = infos[lab], infos[lab]["result"] or {}
        ts_ = times.get(lab, [])
        nchar = len(ts_)
        dur = (res.get("duration_ms") or 0) / 60000
        cost = res.get("total_cost_usd")
        if info["t0"]:
            stamps.append(info["t0"].strftime("%Y-%m-%d %H:%M"))
        for c in ts_:
            avg = f"${L.n(cost / nchar, 2)}(セッション ÷ {L.n(nchar)})" if cost is not None and nchar else "測っていない"
            out.append(f"| {esc(c['name'])} | {esc(lab)}({esc(info['model'])}) | {L.n(c['minutes'])} | {esc(c['kind'])} | {L.n(dur)} | "
                       f"{('$' + L.n(cost, 2)) if cost is not None else '測っていない'}(2 体の合計) | {avg} |")
    out += [""]
    out += ["- 費用・セッション全体の時間は、作業役 1 回分(2 体を続けて作った)の `result` の `total_cost_usd`・`duration_ms`。**体ごとの費用は分けて測っていない**(平均は割り算)。"
            "判定役(`claude -p`)の費用は含まない(`j01_judge.py` は費用を記録しない)。声(ElevenLabs)は作っていない。",
            "- 作業時間は各 `record.md` に書かれた値(「全体」の時刻から計算、または記録の「合計」)。範囲の違う値を並べているので、体どうしの小さな差は比べない。",
            f"- 条件: 作業役は Claude(上の表のモデル)、元の絵は Claude が SVG で描き直した回。測った時刻(UTC): {esc(' / '.join(sorted(set(stamps))) or '不明')} 開始。",
            "- 出どころ: " + "、".join(f"`{esc(l)}/log.jsonl`・`{esc(l)}/result.json`・`{esc(l)}/record.md`" for l in runs) + "(リポジトリの外)。要約は `docs/runs/` に出した。", ""]

    # --- 2 その 4 体の判定
    out += ["## 2. その体の判定(最後の回。通らなかった項目もそのまま)", ""]
    out += ["| 体 | 回 | 問い | Haiku 5.5 の はい(3 回中) | Sonnet 5.5 の はい(3 回中) | 結果 |", "|---|---|---|---|---|---|"]
    agg = {}
    for lab, p in cfg["records"].items():
        for who, v in parse_rebuild_judges(lab, read_text(p)).items():
            for name, h, s in v["axes"]:
                ok = h >= 2 and s >= 2
                a = agg.setdefault(name.split("(")[0], [0, 0])
                a[0] += 1
                a[1] += ok
                out.append(f"| {esc(who)} | {esc(v['round'])} | {esc(name)} | {L.n(h)} | {L.n(s)} | {'○' if ok else '×'} |")
    out += [""]
    out += ["| 問い | 通った(両方はい) / 体数 |", "|---|---|"]
    for name, (n, ok) in agg.items():
        out.append(f"| {esc(name)} | {L.n(ok)} / {L.n(n)} |")
    out += ["", "- 条件: 新しい文脈の Claude(Haiku 5.5 と Sonnet 5.5)に、同じ絵を各 3 回見せ、2 回以上「はい」でその判定役の「はい」、2 人とも「はい」で ○。",
            "- **判定役は同じ系統の Claude 2 つで、独立した 2 人ではない**。人が確かめる段で、この穴を埋める。",
            "- 出どころ: 各 `record.md` の判定の表(`j01_judge.py` の出力を作業役が写した値)。", ""]

    # --- 3 これまでの試験
    p_res = os.path.join(sk, "結果表.md")
    res_txt = read_text(p_res)
    L.feed(res_txt)
    rows = parse_timing(res_txt)
    out += ["## 3. これまでの試験の時間と費用(PNG の絵と前の判定の値。SVG の作例の値とは条件が違う)", ""]
    out += ["| 試験・モデル | 回数 | 通った回 | 通った回の時間 中央値(最小〜最大, 分) | 通った回の費用 中央値(最小〜最大, USD) | 通らなかった回 | うち時間切れ |", "|---|---|---|---|---|---|---|"]
    groups = {}
    for r in rows:
        groups.setdefault((r["section"], r["model"]), []).append(r)
    for (sec, model), rs in groups.items():
        ps = [r for r in rs if r["passed"]]
        tm = [r["minutes"] for r in ps if r["minutes"] is not None]
        co = [r["cost"] for r in ps if r["cost"] is not None]
        rng = lambda v, nd: f"{L.n(statistics.median(v), nd)}({L.n(min(v), nd)}〜{L.n(max(v), nd)})" if v else "-"
        out.append(f"| {esc(sec)} / {esc(model)} | {L.n(len(rs))} | {L.n(len(ps))} | {rng(tm, 1)} | {rng(co, 2)} | "
                   f"{L.n(len(rs) - len(ps))} | {L.n(sum(r['timeout'] for r in rs))} |")
    out += [""]
    allp = [r for r in rows if r["passed"] and r["minutes"] is not None]
    if allp:
        out += [f"- 通った回の全体: {L.n(len(allp))} 回、時間の中央値 {L.n(statistics.median([r['minutes'] for r in allp]))} 分"
                f"({L.n(min(r['minutes'] for r in allp))}〜{L.n(max(r['minutes'] for r in allp))})。"]
    stops = [r for r in rows if r["timeout"]]
    out += ["", "**時間切れ(止まった回)** — 通った回の中央値には入れていない:", ""]
    out += ["| 回 | 止まるまでの時間(分) | 費用(USD) |", "|---|---|---|"]
    for r in stops:
        out.append(f"| {esc(r['label'])} | {L.n(r['minutes'])} | {('$' + L.n(r['cost'], 2) + (' 推定' if r['estimated'] else '')) if r['cost'] is not None else '-'} |")
    if not stops:
        out.append("| (なし) | - | - |")
    son = [r for r in rows if r["model"] == "Sonnet" and r["minutes"] is not None and r["cost"] is not None]
    if son:
        out += ["", f"- **古い値の注記**: 以前の報告にある「1 体 6〜55 分・$0.8〜2.0」のような値は、この表のような PNG の絵と前の判定の試験の値(Sonnet 行 {L.n(len(son))} 回の最小〜最大は "
                f"{L.n(min(r['minutes'] for r in son))}〜{L.n(max(r['minutes'] for r in son))} 分、"
                f"${L.n(min(r['cost'] for r in son), 2)}〜${L.n(max(r['cost'] for r in son), 2)})で、最大の時間は**時間切れで止まった回**。"
                "上の SVG の作例の値とは条件が違うので、同じ物差しでは比べない。"]
    d3 = file_date(root, p_res)
    out += [f"- 日付: {d3}(`結果表.md` の最後のコミット日)。条件: 各表の見出しのとおり(Sonnet・Opus・Haiku の API 枠、`creator/skilltest/run_trial.sh` などの固定の試験)。通った回 = 合否・検査の欄に「不合格」「NG」「残る」が無く、時間切れでなく、工程が全部通った回。",
            "- 出どころ: `creator/skilltest/結果表.md` の「時間」「費用」の列。", ""]

    # --- 4 試験の件数
    out += ["## 4. 試験の件数(`cd web && node --test` を流して数えた)", ""]
    tl = cfg.get("tests_text")
    nfiles = len([f for f in os.listdir(os.path.join(root, "web", "test")) if f.endswith(".test.mjs")]) if os.path.isdir(os.path.join(root, "web", "test")) else 0
    if tl:
        L.feed(tl)
        t = parse_tests_log(tl)
        out += ["| 試験の件数 | 通った | 落ちた | 取り消し | 飛ばした | 試験ファイル数 |", "|---|---|---|---|---|---|"]
        out.append(f"| {L.n(t.get('tests', 0))} | {L.n(t.get('pass', 0))} | {L.n(t.get('fail', 0))} | {L.n(t.get('cancelled', 0))} | {L.n(t.get('skipped', 0))} | {L.n(nfiles)} |")
        out += ["", f"- 日付: {cfg['tests_date']}(試験の出力を保存した日)。条件: `web/` で `node --test`(標準の試験ランナー)。出どころ: その標準出力の `# tests` などの行。",
                "- 通る件数は「試験が通る」ことだけを言う。製品の質を保証する数字ではない。", ""]
    else:
        out += ["未集計(`--tests-log` か `--run-tests` を渡すと数える)。", ""]

    # --- 5 カバー率
    cov_path = os.path.join(sk, "coverage.py")
    spec = importlib.util.spec_from_file_location("coverage_tool", cov_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ver, c = mod.compute()
    L.feed(json.dumps(c, ensure_ascii=False))
    out += ["## 5. カバー率(試した題材のうち、スキルだけで作って試験に合格した数)", "", "| 指標 | 体数 |", "|---|---|"]
    out.append(f"| 確認済み(固定の試験に合格。同じキャラは Claude の判定役が両方はい) | {L.n(c['ok'])} / {L.n(c['n'])} |")
    out.append(f"| 質感(毛足)も確認済み | {L.n(c['with_texture'])} / {L.n(c['n'])} |")
    out.append(f"| 難しい部分(耳・帽子・翼など)も確認済み | {L.n(c['with_parts'])} / {L.n(c['n'])} |")
    p_ver = os.path.join(sk, "verified.json")
    out += ["", f"- 日付: {file_date(root, p_ver)}(`verified.json` の最後のコミット日)。条件: オリジナルのキャラ、スキルだけを読んだ作業役、固定の試験。「作れるはず」は数えない。",
            "- 出どころ: `creator/skilltest/verified.json` を `creator/skilltest/coverage.py` で数えた値。", ""]

    # --- 6 判定の合格率
    jd = parse_judge_tables(res_txt)
    out += ["## 6. 判定の合格率(Claude の判定役。毛足など、落ちた項目もそのまま)", "",
            "| 題材の群 | 問い | 通った(両方はい) / 束 | Haiku 5.5 の はい | Sonnet 5.5 の はい | 2 人の答えが割れた束 |", "|---|---|---|---|---|---|"]
    for j in jd:
        out.append(f"| {esc(j['table'])} | {esc(j['axis'])} | {L.n(j['ok'])} / {L.n(j['n'])} | {L.n(j['haiku'])} / {L.n(j['n'])} | {L.n(j['sonnet'])} / {L.n(j['n'])} | {L.n(j['split'])} |")
    fur = [j for j in jd if j["axis"] == "毛足"]
    if fur:
        out += ["", f"- 「毛足」の問いは、全部で {L.n(sum(j['n'] for j in fur))} 束のうち、両方はいが {L.n(sum(j['ok'] for j in fur))} 束。"
                f"Sonnet 5.5 の はい は {L.n(sum(j['sonnet'] for j in fur))} 束、Haiku 5.5 の はい は {L.n(sum(j['haiku'] for j in fur))} 束。"]
    out += ["- 条件: 新しい文脈の Claude(Haiku 5.5 と Sonnet 5.5)、各 3 回、ブラウザの絵、2 回以上で「はい」。無効な答えは別に数えていない(結果表の記載による)。",
            "- **注記: 判定役の Haiku と Sonnet は同じ系統の Claude で、独立した確認ではない。** 割れた束が多い問いは、どちらが正しいかをこの試験では決められない。人が見て決める。",
            f"- 日付: {d3}(`結果表.md` の最後のコミット日)。出どころ: `creator/skilltest/結果表.md` の「Claude の判定」の節の表(`・` の前が Haiku、後が Sonnet の回数)。", ""]

    # --- 7 フック
    hooks_dir = os.path.join(root, ".claude", "hooks")
    nh = len([f for f in os.listdir(hooks_dir) if f.endswith(".mjs")]) if os.path.isdir(hooks_dir) else 0
    out += ["## 7. フックが止めた回数", ""]
    hl = [p for p in cfg["hook_logs"] if os.path.exists(p)]
    if hl:
        n, blocked, per = parse_hook_log(hl)
        out += ["| フック | 記録の件数 | 止めた回数 |", "|---|---|---|"]
        for k in sorted(per):
            out.append(f"| {esc(k)} | {L.n(per[k][0])} | {L.n(per[k][1])} |")
        out.append(f"| (全部) | {L.n(n)} | {L.n(blocked)} |")
        out += ["", "- 出どころ: フックの記録ファイル(1 行 1 件の JSON)。", ""]
    else:
        out += [f"**未集計。** フックの記録ファイルがまだ無い(リポジトリにあるフックのファイルは {L.n(nh)} 本)。記録が出るようになったら `--hook-log` で数える。止めた回数は 0 回ではなく「測っていない」。", ""]

    # --- 8 生の記録
    out += ["## 8. 生の記録と要約", "",
            "生の記録(`stream-json` の `log.jsonl`)は、リポジトリの外に置いている。そこから、絶対パス・ユーザー名・ホスト名・鍵を消した**要約だけ**を `docs/runs/` に出した:", ""]
    for lab in runs:
        out.append(f"- `docs/runs/{esc(lab)}.md`")
    out += ["", "消毒は `tools/test_metrics.py` の試験(わざと絶対パス・ユーザー名・ホスト名を入れた記録が、出力に残らないこと)で確かめる。", ""]
    return "\n".join(out).rstrip() + "\n"


def render_run(info, L, terms):
    res = info["result"] or {}
    u = res.get("usage") or {}
    mu = next(iter((res.get("modelUsage") or {}).values()), {})
    wall = (info["t1"] - info["t0"]).total_seconds() / 60 if info["t0"] and info["t1"] else None
    lines = [MARK, "", f"# 作業役の記録の要約: {info['label']}", "",
             "生の記録(`stream-json`)から、数字と道具の呼び出しの数だけを取り出し、絶対パス・ユーザー名・ホスト名・鍵を消した要約です。生の記録はリポジトリに入れていません。", "",
             "## 全体", "", "| 項目 | 値 |", "|---|---|"]
    rows = [("モデル", info["model"] or "不明"), ("Claude Code の版", info["version"] or "不明"), ("権限モード", info["mode"] or "不明"),
            ("開始(UTC)", info["t0"].strftime("%Y-%m-%d %H:%M:%S") if info["t0"] else "不明"),
            ("終了(UTC)", info["t1"].strftime("%Y-%m-%d %H:%M:%S") if info["t1"] else "不明"),
            ("記録の時刻の幅(分)", L.n(wall) if wall is not None else "不明"),
            ("終わり方", f"{res.get('subtype', '不明')}(is_error={res.get('is_error')})"),
            ("ターン数", L.n(res["num_turns"]) if "num_turns" in res else "不明"),
            ("作業時間 duration_ms を分に直した値", L.n(res["duration_ms"] / 60000) if "duration_ms" in res else "不明"),
            ("API の時間(分)", L.n(res["duration_api_ms"] / 60000) if "duration_api_ms" in res else "不明"),
            ("費用(USD)", L.n(res["total_cost_usd"], 2) if "total_cost_usd" in res else "不明"),
            ("入力トークン", L.n(u.get("input_tokens", 0))), ("出力トークン", L.n(u.get("output_tokens", 0))),
            ("キャッシュ作成トークン", L.n(u.get("cache_creation_input_tokens", 0))), ("キャッシュ読みトークン", L.n(u.get("cache_read_input_tokens", 0))),
            ("考えるトークン(thinking)", L.n(mu.get("thinkingTokens", 0))),
            ("道具が返したエラーの数", L.n(info["errors"])), ("使用量の状況の通知(rate_limit_event)の数", L.n(info["rate_limit"]))]
    lines += [f"| {k} | {esc(v)} |" for k, v in rows]
    lines += ["", "## 道具の呼び出し", "", "| 道具 | 回数 |", "|---|---|"]
    lines += [f"| {esc(k)} | {L.n(v)} |" for k, v in sorted(info["tools"].items(), key=lambda kv: (-kv[1], kv[0]))]
    lines += ["", "検査・判定の道具を、`Bash` で呼んだ回数:", "", "| 道具 | 回数 |", "|---|---|"]
    lines += [f"| {esc(k)} | {L.n(v)} |" for k, v in info["tool_kw"].items()]
    lines += ["", "## 権限の確認で止められた回数(フックではない)", "", "| 道具 | 回数 |", "|---|---|"]
    lines += [f"| {esc(k)} | {L.n(v)} |" for k, v in sorted(info["denied"].items())] or ["| (なし) | - |"]
    lines += ["", "## 読んだスキル(読んだ順)", ""]
    lines += [f"- {esc(s)}" for s in info["skills"]] or ["- (なし)"]
    if info["buckets"]:
        lines += ["", "## 10 分ごとの道具の呼び出し数", "", "| 開始から | 回数 |", "|---|---|"]
        lines += [f"| {L.n(k * 10)}〜{L.n(k * 10 + 10)} 分 | {L.n(v)} |" for k, v in sorted(info["buckets"].items())]
    if info["tasks"]:
        lines += ["", f"## 実行した作業の説明(最初の {L.n(min(len(info['tasks']), 20))} 件。作業役が付けた短い説明)", ""]
        lines += [f"- {esc(t)}" for t in info["tasks"][:20]]
    text, _ = sanitize("\n".join(lines) + "\n", terms)
    assert_clean(text, terms)
    return text


# ---------------------------------------------------------------- 入口
def pairs(items, env):
    items = list(items or [])
    if env:
        items += [x for x in env.split(os.pathsep) if x]
    out = {}
    for it in items:
        if "=" not in it:
            raise SystemExit(f"ラベル=パス の形で渡す: {it[:30]}")
        k, v = it.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def build(args):
    root = os.path.abspath(args.root or ROOT)
    terms = build_terms([t for t in (args.scrub or []) + (os.environ.get("METRICS_SCRUB_TERMS", "").split(",")) if t.strip()],
                        args.scrub_file or os.environ.get("METRICS_SCRUB_FILE"))
    cfg = dict(root=root, skilltest=args.skilltest or os.path.join(root, "creator", "skilltest"), terms=terms,
               runs=pairs(args.run, os.environ.get("METRICS_RUNS")), records=pairs(args.record, os.environ.get("METRICS_RECORDS")))
    if not cfg["runs"]:
        raise SystemExit("--run ラベル=フォルダ が要る(または METRICS_RUNS)")
    tl = args.tests_log or os.environ.get("METRICS_TESTS_LOG")
    if tl:
        cfg["tests_text"], cfg["tests_date"] = read_text(tl), file_date(root, tl)
    elif args.run_tests:
        cfg["tests_text"], cfg["tests_date"] = run_node_tests(os.path.join(root, "web")), datetime.now().strftime("%Y-%m-%d")
    hl = list(args.hook_log or [])
    if os.environ.get("METRICS_HOOK_LOG"):
        hl += os.environ["METRICS_HOOK_LOG"].split(os.pathsep)
    hd = os.path.join(root, ".claude", "hooks")
    if os.path.isdir(hd):
        for dp, _, fs in os.walk(hd):
            hl += [os.path.join(dp, f) for f in fs if f.endswith((".jsonl", ".log"))]
    cfg["hook_logs"] = hl
    L = Ledger()
    md = render(cfg, L)
    runs_md = {lab: render_run(info, L, terms) for lab, info in cfg["_infos"].items()}
    assert_clean(md, terms)
    return cfg, md, runs_md, L


def main(argv=None):
    ap = argparse.ArgumentParser(description="ログから docs/metrics.md と docs/runs/ を作る")
    ap.add_argument("--root", help="リポジトリの根(既定: この道具の 1 つ上)")
    ap.add_argument("--skilltest", help="creator/skilltest の場所(既定: 根の下)")
    ap.add_argument("--run", action="append", help="ラベル=作業役のログのフォルダ(log.jsonl と result.json)")
    ap.add_argument("--record", action="append", help="ラベル=手順の記録 record.md")
    ap.add_argument("--tests-log", help="node --test の出力を保存したファイル")
    ap.add_argument("--run-tests", action="store_true", help="web/ で node --test を流して数える")
    ap.add_argument("--hook-log", action="append", help="フックの記録(1 行 1 件の JSON)")
    ap.add_argument("--scrub", action="append", help="出力から消したい語(ユーザー名・ホスト名など)。環境からも自動で集める")
    ap.add_argument("--scrub-file", help="消したい語の一覧(1 行 1 語)")
    ap.add_argument("--out", help="metrics.md の出力先(既定: 根/docs/metrics.md)")
    ap.add_argument("--runs-out", help="要約の出力先フォルダ(既定: 根/docs/runs)")
    ap.add_argument("--check-numbers", action="store_true", help="表の数字がすべて入力か計算から出ていることを確かめる")
    args = ap.parse_args(argv)
    cfg, md, runs_md, L = build(args)
    if args.check_numbers:
        bad = L.untraced(md)
        if bad:
            print("出どころの無い数字があります:")
            for tok, line in bad:
                print(f"  {tok}  ← {line}")
            return 1
        print("出どころの無い数字: 0 件")
    out = args.out or os.path.join(cfg["root"], "docs", "metrics.md")
    runs_out = args.runs_out or os.path.join(cfg["root"], "docs", "runs")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    os.makedirs(runs_out, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    for lab, t in runs_md.items():
        with open(os.path.join(runs_out, f"{lab}.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write(t)
    print(f"書きました: metrics.md と要約 {len(runs_md)} 件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
