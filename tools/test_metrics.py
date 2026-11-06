"""tools/metrics.py の試験。`python -m unittest tools.test_metrics`(または `python tools/test_metrics.py`)。

いちばん大事なのは「消毒の試験」: わざと絶対パス・ユーザー名・ホスト名・鍵を入れた記録を作り、
docs/runs/ に出す要約と metrics.md に何も残らないことを確かめる。
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import metrics as M  # noqa: E402

# わざと入れる、消えるべき物(ここに書くのは試験用のダミーで、実在の名前ではない)
USER = "zebra_tester"
HOST = "plum-box-77"
# 絶対パスの文字列は、その場で組み立てる(リポジトリの文書やコードに絶対パスを直書きしないため)
BS = chr(92)
WUSERS = "C:" + BS + "Users" + BS
WIN = WUSERS + USER + BS + "work" + BS + "proj" + BS + "SKILL.md"
HOME = "/ho" + "me/"
POSIX = HOME + USER + "/proj/out.png"
DRIVE = "Q:" + BS + "secret_disk" + BS + "party"
KEY = "sk-" + "ant-api03-DUMMYDUMMYDUMMY1234"  # 試験用のダミー(検査に引っかからないよう分けて書く)
LEAKS = [USER, HOST, "secret_disk", "DUMMYDUMMY", WUSERS, HOME]

TESTS_LOG = "# tests 12\n# suites 0\n# pass 11\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n"
RESULT_TABLE = """# 結果表

## 固定の試験(桃)

| 段 | モデル | effort | 費用(API、実額) | 時間 | 合否 |
|---|---|---|---|---|---|
| 1 | Opus 5.5 | high | $2.00 | 10.0 分 | 合格 |
| 2 | Opus 5.5 | high | $3.00 | 20.0 分 | 合格 |
| 3 | Opus 5.5 | high | $9.00 | 40.0 分 | 不合格 |
| 4 | Opus 5.5 | high | $1.00 | 55 分で時間切れ | - |

## Claude の判定(取り直した)

### 基準の題材(既定)
| 題材 | 同じキャラ | 毛足 |
|---|---|---|
| a(説明に 9・9 ○ が入っても数えない) | 3・3 ○ | 0・0 × |
| b | 3・3 ○ | 3・0 × |
| **合計** | **2/2** | **0/2** |
"""
RECORD = """# 手順の記録

### yoko(テスト)
B 全体: 12:00:00 → 12:30:00(約 30 分)

| | yoko |
|---|---|
| 判定(最後の回。はい / 3 回) | 同じキャラ 3・3 ○ / 色 2・1 × |
"""


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def fake_log(path):
    """消えるべき物を、あちこちに入れた stream-json。"""
    ev = [
        {"type": "system", "subtype": "init", "model": "claude-test", "claude_code_version": "9.9.9", "permissionMode": "default",
         "cwd": WUSERS + USER + BS + "work", "session_id": "s", "timestamp": "2026-11-06T03:00:00.000Z"},
        {"type": "system", "subtype": "task_started", "description": f"clone to {WIN} on {HOST} as {USER}@{HOST}", "timestamp": "2026-11-06T03:00:01.000Z"},
        {"type": "system", "subtype": "task_started", "description": f"copy {POSIX} and {DRIVE} with {KEY}", "timestamp": "2026-11-06T03:00:02.000Z"},
        {"type": "system", "subtype": "task_started", "description": f"ssh {HOST}.local 192.168.x.x password=hunter2 {USER.upper()} again", "timestamp": "2026-11-06T03:00:03.000Z"},
        {"type": "assistant", "timestamp": "2026-11-06T03:00:04.000Z", "message": {"content": [
            {"type": "tool_use", "name": "Read", "input": {"file_path": WUSERS + USER + BS + "p" + BS + ".claude" + BS + "skills" + BS + "demo-skill" + BS + "SKILL.md"}},
            {"type": "tool_use", "name": "Bash", "input": {"command": "sh creator/pipeline/check_all.sh " + WIN}}]}},
        {"type": "user", "timestamp": "2026-11-06T03:00:05.000Z", "message": {"content": [{"type": "tool_result", "is_error": True, "content": "x"}]}},
        {"type": "system", "subtype": "permission_denied", "tool_name": "Edit", "timestamp": "2026-11-06T03:00:06.000Z"},
        {"type": "result", "subtype": "success", "is_error": False, "num_turns": 3, "duration_ms": 120000, "duration_api_ms": 60000,
         "total_cost_usd": 1.5, "usage": {"input_tokens": 10, "output_tokens": 20, "cache_creation_input_tokens": 30, "cache_read_input_tokens": 40},
         "modelUsage": {"claude-test": {"thinkingTokens": 7}}, "result": f"done at {WIN} by {USER}", "timestamp": "2026-11-06T03:02:00.000Z"},
    ]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for e in ev:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


def make_root(tmp):
    """試験用の小さなリポジトリの形(creator/skilltest と web/test)。"""
    root = os.path.join(tmp, "root")
    sk = os.path.join(root, "creator", "skilltest")
    os.makedirs(sk, exist_ok=True)
    os.makedirs(os.path.join(root, "web", "test"), exist_ok=True)
    write(os.path.join(root, "web", "test", "a.test.mjs"), "")
    write(os.path.join(sk, "結果表.md"), RESULT_TABLE)
    write(os.path.join(sk, "verified.json"), json.dumps({"note": "n", "items": [
        {"name": "x", "status": "確認済み", "bodies": ["丸"], "textures": [], "head_ratios": [], "parts": []},
        {"name": "y", "status": "未確認", "bodies": [], "textures": [], "head_ratios": [], "parts": []}]}, ensure_ascii=False))
    real_cov = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "creator", "skilltest", "coverage.py")
    with open(real_cov, encoding="utf-8") as f:
        write(os.path.join(sk, "coverage.py"), f.read())
    run = os.path.join(tmp, "run1")
    os.makedirs(run, exist_ok=True)
    fake_log(os.path.join(run, "log.jsonl"))
    rec = os.path.join(tmp, "record.md")
    write(rec, RECORD)
    tl = os.path.join(tmp, "node.txt")
    write(tl, TESTS_LOG)
    return root, run, rec, tl


class SanitizeTest(unittest.TestCase):
    def test_sanitize_removes_paths_user_host_key(self):
        """消毒の試験: わざと入れた絶対パス・ユーザー名・ホスト名・鍵が、docs/runs/ の要約と metrics.md に残らない。"""
        with tempfile.TemporaryDirectory() as tmp:
            root, run, rec, tl = make_root(tmp)
            out, runs_out = os.path.join(tmp, "o", "metrics.md"), os.path.join(tmp, "o", "runs")
            rc = M.main(["--root", root, "--run", f"r1={run}", "--record", f"r1={rec}", "--tests-log", tl,
                         "--scrub", HOST, "--out", out, "--runs-out", runs_out])
            self.assertEqual(rc, 0)
            for p in (out, os.path.join(runs_out, "r1.md")):
                with open(p, encoding="utf-8") as f:
                    text = f.read()
                for leak in LEAKS:
                    self.assertNotIn(leak.lower(), text.lower(), f"{os.path.basename(p)} に {leak} が残った")
                self.assertIsNone(M.WIN_PATH.search(text))
                self.assertNotIn("192.168", text)
                self.assertNotIn("hunter2", text)
            with open(os.path.join(runs_out, "r1.md"), encoding="utf-8") as f:
                summary = f.read()
            # 消しただけで、中身(数字・道具の数・読んだスキル)は残っている
            self.assertIn("demo-skill", summary)
            self.assertIn("1.50", summary)
            self.assertIn("<path>", summary)

    def test_username_found_only_in_path_is_removed_elsewhere(self):
        """パスの中で見つけた名前は、環境に無くても、ほかの場所から消える。"""
        text, _ = M.sanitize(f"{WUSERS}{USER}{BS}x and also {USER} said hi, {USER}さん")
        self.assertNotIn(USER, text)

    def test_assert_clean_fails_closed(self):
        with self.assertRaises(M.SanitizeError):
            M.assert_clean("残り物 " + WUSERS + "someone" + BS + "x")
        with self.assertRaises(M.SanitizeError):
            M.assert_clean("name zebra_tester here", {"zebra_tester"})
        M.assert_clean("tools/metrics.py と web/test の話。https://github.com/x/y と 11/06/2026")

    def test_relative_paths_and_urls_survive(self):
        text, _ = M.sanitize("creator/pipeline/check_all.sh を https://github.com/a/b で見る /make-character を呼ぶ")
        self.assertIn("creator/pipeline/check_all.sh", text)
        self.assertIn("https://github.com/a/b", text)
        self.assertIn("/make-character", text)


class ParseTest(unittest.TestCase):
    def test_timing_pass_median_and_timeout_split(self):
        rows = M.parse_timing(RESULT_TABLE)
        self.assertEqual([r["passed"] for r in rows], [True, True, False, False])
        self.assertEqual([r["timeout"] for r in rows], [False, False, False, True])
        self.assertEqual(rows[3]["minutes"], 55.0)

    def test_judge_counts_skip_first_column_and_total_row(self):
        jd = {j["axis"]: j for j in M.parse_judge_tables(RESULT_TABLE)}
        self.assertEqual((jd["同じキャラ"]["ok"], jd["同じキャラ"]["n"]), (2, 2))
        self.assertEqual((jd["毛足"]["ok"], jd["毛足"]["n"], jd["毛足"]["haiku"], jd["毛足"]["sonnet"], jd["毛足"]["split"]), (0, 2, 1, 0, 1))

    def test_tests_log(self):
        self.assertEqual(M.parse_tests_log(TESTS_LOG), {"tests": 12, "pass": 11, "fail": 1, "cancelled": 0, "skipped": 0, "todo": 0})
        self.assertEqual(M.parse_tests_log("ℹ tests 171\nℹ pass 171\nℹ fail 0\n")["tests"], 171)

    def test_char_time_from_record(self):
        t = M.parse_char_times(RECORD)
        self.assertEqual((t[0]["name"], t[0]["minutes"]), ("yoko", 30.0))

    def test_hook_log_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "h.jsonl")
            write(p, '{"hook":"g","decision":"block"}\n{"hook":"g","decision":"allow"}\n{"hook":"s","blocked":true}\nnot json\n')
            self.assertEqual(M.parse_hook_log([p]), (3, 2, {"g": [2, 1], "s": [1, 1]}))


class RenderTest(unittest.TestCase):
    def build(self, tmp, **extra):
        root, run, rec, tl = make_root(tmp)
        args = M.argparse.Namespace(root=root, skilltest=None, run=[f"r1={run}"], record=[f"r1={rec}"], tests_log=tl, run_tests=False,
                                    hook_log=None, scrub=[HOST], scrub_file=None, out=None, runs_out=None, check_numbers=True)
        return M.build(args)

    def test_same_input_same_output_and_numbers_traced(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, md1, runs1, L = self.build(tmp)
            _, md2, runs2, _ = self.build(tmp)
            self.assertEqual(md1, md2)
            self.assertEqual(runs1, runs2)
            self.assertEqual(L.untraced(md1), [])
            self.assertIn("未集計", md1)  # フックの記録が無いときは 0 ではなく「未集計」
            self.assertIn("時間切れ", md1)
            self.assertIn("| 12 | 11 | 1 | 0 | 0 | 1 |", md1)

    def test_untraced_number_is_detected(self):
        L = M.Ledger()
        L.feed("値は 12")
        self.assertEqual(L.untraced("| 12 | 99 |\n"), [("99", "| 12 | 99 |")])


if __name__ == "__main__":
    unittest.main()
