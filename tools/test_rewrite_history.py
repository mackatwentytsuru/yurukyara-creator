#!/usr/bin/env python3
"""tools/rewrite_history.py の試験。小さな偽のリポジトリを作って書き換え、元が変わらない事と語が 0 件になる事を見る。

流し方: python tools/test_rewrite_history.py(git filter-repo が要る)
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "rewrite_history.py")
WORD = "ひみつ" + "村"  # 試験だけの語


def sh(cwd, *args):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", check=True).stdout


def make_repo(root):
    repo = os.path.join(root, "src")
    os.makedirs(repo)
    sh(repo, "git", "init", "-q", "-b", "main")
    sh(repo, "git", "config", "user.email", "someone@example.com")
    sh(repo, "git", "config", "user.name", "someone")
    with open(os.path.join(repo, "a.txt"), "w", encoding="utf-8") as f:
        f.write(f"ここは{WORD}の話\n")
    with open(os.path.join(repo, "old.txt"), "w", encoding="utf-8") as f:
        f.write("消したファイル\n")
    sh(repo, "git", "add", ".")
    sh(repo, "git", "commit", "-q", "-m", f"{WORD} を足す")
    sh(repo, "git", "rm", "-q", "old.txt")
    sh(repo, "git", "commit", "-q", "-m", "消す")
    sh(repo, "git", "branch", "archive/old")
    return repo


class RewriteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.repo = make_repo(self.root)
        self.rules = os.path.join(self.root, "rules.local.txt")
        self.terms = os.path.join(self.root, "terms.local.txt")
        self.mailmap = os.path.join(self.root, "mailmap.local.txt")
        with open(self.rules, "w", encoding="utf-8") as f:
            f.write(f"literal:{WORD}==>見本の村\n")
        with open(self.terms, "w", encoding="utf-8") as f:
            f.write(f"# 試験\n{WORD}\n")
        with open(self.mailmap, "w", encoding="utf-8") as f:
            f.write("someone <1+someone@users.noreply.github.com> <someone@example.com>\n")

    def tearDown(self):
        self.tmp.cleanup()

    def tool(self, work, *extra):
        return subprocess.run([sys.executable, TOOL, "--source", self.repo, "--work", work, "--rules", self.rules,
                               "--terms", self.terms, "--mailmap", self.mailmap, "--keep", "main", *extra],
                              capture_output=True, text=True, encoding="utf-8")

    def test_rewrites_copy_only(self):
        head_before = sh(self.repo, "git", "rev-parse", "main")
        work = os.path.join(self.root, "work")
        r = self.tool(work)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rep = json.load(open(os.path.join(work, "report.json"), encoding="utf-8"))
        self.assertEqual(rep["terms_left"], 0)
        self.assertTrue(rep["author_emails_noreply"])
        self.assertEqual(rep["dropped_refs"], 1)  # archive/old は写しから消える
        mirror = os.path.join(work, "mirror.git")
        self.assertNotIn(WORD, sh(mirror, "git", "log", "--all", "-p", "--format=%B"))
        self.assertNotIn("old.txt", sh(mirror, "git", "log", "--all", "--name-only", "--format="))
        self.assertTrue(os.path.isfile(os.path.join(work, "backup_all.bundle")))
        self.assertTrue(os.path.isfile(os.path.join(work, "commit-map.txt")))
        # 元のリポジトリは変わらない
        self.assertEqual(sh(self.repo, "git", "rev-parse", "main"), head_before)
        self.assertIn(WORD, sh(self.repo, "git", "log", "--all", "--format=%B"))
        self.assertIn("archive/old", sh(self.repo, "git", "branch"))
        self.assertNotIn(WORD, r.stdout)  # 語そのものは画面に出さない

    def test_reports_left_terms(self):
        with open(self.rules, "w", encoding="utf-8") as f:
            f.write("literal:関係ない語==>x\n")
        r = self.tool(os.path.join(self.root, "work2"))
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertNotIn(WORD, r.stdout)

    def test_refuses_nonempty_work_and_missing_files(self):
        work = os.path.join(self.root, "busy")
        os.makedirs(work)
        open(os.path.join(work, "x"), "w").close()
        self.assertEqual(self.tool(work).returncode, 2)
        os.remove(self.terms)
        self.assertEqual(self.tool(os.path.join(self.root, "work3")).returncode, 2)


if __name__ == "__main__":
    unittest.main()
