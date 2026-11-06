#!/usr/bin/env python3
"""点検の道具が `python -I`(git の pre-push の呼び方)でも動くかの試験。

-I は、台本のフォルダを読み込みの道に足さない。だから tools/termlist.py を読めずに落ちる事があった(合わせ②)。
小さな偽のリポジトリに tools/ の 3 本を写し、本物と同じ形で呼ぶ。語の一覧は試験の中で作る(リポジトリに語を書かない)。

流し方: python tools/test_isolated_mode.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = ("prepush_check.py", "history_check.py", "termlist.py")
WORD = "ひみつ" + "の丘"  # 試験だけの語


def sh(cwd, *args, env=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)


class IsolatedModeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = os.path.join(self.tmp.name, "repo")
        os.makedirs(os.path.join(self.repo, "tools"))
        for name in TOOLS:
            shutil.copy(os.path.join(HERE, name), os.path.join(self.repo, "tools", name))
        self.terms = os.path.join(self.tmp.name, "terms.local.txt")
        with open(self.terms, "w", encoding="utf-8") as f:
            f.write("# 試験の語\n" + WORD + "\n")
        for args in (("init", "-q", "-b", "main"), ("config", "user.email", "someone@example.com"),
                     ("config", "user.name", "someone"), ("config", "core.autocrlf", "false")):
            self.assertEqual(sh(self.repo, "git", *args).returncode, 0)
        self.write("a.txt", "ふつうの文\n")
        self.commit("足す")
        self.env = {**os.environ, "PREPUSH_TERMS": self.terms}

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        with open(os.path.join(self.repo, rel), "w", encoding="utf-8") as f:
            f.write(text)

    def commit(self, msg):
        self.assertEqual(sh(self.repo, "git", "add", ".").returncode, 0)
        self.assertEqual(sh(self.repo, "git", "commit", "-q", "-m", msg).returncode, 0)

    def run_isolated(self, *args, env=None):
        return sh(self.repo, sys.executable, "-I", *args, env=env or self.env)

    def assert_no_import_error(self, r):
        self.assertNotIn("ModuleNotFoundError", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    # -I では PYTHONIOENCODING・PYTHONUTF8 も効かないので、子の日本語の出力は画面の文字の決まりになる。
    # だから見るのは、終わりの番号と英数字の部分(ファイルの名前など)だけにする
    def test_prepush_check_passes_a_clean_tree_under_python_I(self):
        r = self.run_isolated("tools/prepush_check.py")
        self.assert_no_import_error(r)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("push", r.stdout)
        self.assertNotIn("a.txt", r.stdout)

    def test_prepush_check_stops_on_a_word_under_python_I(self):
        self.write("b.txt", f"ここは{WORD}の話\n")
        sh(self.repo, "git", "add", "b.txt")
        r = self.run_isolated("tools/prepush_check.py")
        self.assert_no_import_error(r)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("b.txt", r.stdout)

    def test_prepush_check_stops_without_a_term_list_under_python_I(self):
        env = {**os.environ, "PREPUSH_TERMS": os.path.join(self.tmp.name, "none.txt")}
        r = self.run_isolated("tools/prepush_check.py", env=env)
        self.assert_no_import_error(r)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("none.txt", r.stdout)

    def test_history_check_runs_under_python_I(self):
        r = self.run_isolated("tools/history_check.py", "--terms", self.terms)
        self.assert_no_import_error(r)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.write("c.txt", f"{WORD}\n")
        self.commit("語を入れる")
        r = self.run_isolated("tools/history_check.py", "--terms", self.terms)
        self.assert_no_import_error(r)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)

    def test_git_pre_push_hook_runs_the_check_under_python_I(self):
        """git の pre-push と同じ 1 行を置き、試験の中だけの置き場(手元の空のリポジトリ)へ送る。外へは送らない"""
        bare = os.path.join(self.tmp.name, "bare.git")
        self.assertEqual(sh(self.tmp.name, "git", "init", "-q", "--bare", bare).returncode, 0)
        hook = os.path.join(self.repo, ".git", "hooks", "pre-push")
        py = sys.executable.replace("\\", "/")
        with open(hook, "w", encoding="utf-8", newline="\n") as f:
            f.write(f'#!/bin/sh\n"{py}" -I tools/prepush_check.py\n')
        os.chmod(hook, 0o755)
        r = sh(self.repo, "git", "push", "-q", bare, "main", env=self.env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_no_import_error(r)
        self.write("d.txt", f"{WORD}\n")
        self.commit("語を入れる")
        r = sh(self.repo, "git", "push", "-q", bare, "main", env=self.env)
        self.assertNotEqual(r.returncode, 0, "語の入った木が送れてしまった")
        self.assert_no_import_error(r)


if __name__ == "__main__":
    unittest.main()
