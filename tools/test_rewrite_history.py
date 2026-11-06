#!/usr/bin/env python3
"""tools/rewrite_history.py と tools/termlist.py の試験。小さな偽のリポジトリを作って書き換え、元が変わらない事と、
語・外す場所・AI の署名入りの絵が 0 件になる事、線の名前を替えられる事を見る。

流し方: python tools/test_rewrite_history.py(git filter-repo が要る)
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rewrite_history  # noqa: E402
import termlist  # noqa: E402

TOOL = os.path.join(HERE, "rewrite_history.py")
WORD = "ひみつ" + "村"  # 試験だけの語
# 形だけの絵: PNG の頭+C2PA の箱の印+AI の語(本物の署名ではない)
AI_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"caBX" + b"jumb" + b"c2pa" + b"Chat" + b"GPT" + b"\x00" * 16
CLEAN_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + b"IHDR" + b"\x01" * 16


def sh(cwd, *args):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", check=True).stdout


def put(repo, rel, data):
    p = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))


def make_repo(root):
    """main: 語の入った文・消したファイル・ふつうの絵。archive/old: main の先に、店のデータ・試した記録・AI の署名入りの絵"""
    repo = os.path.join(root, "src")
    os.makedirs(repo)
    sh(repo, "git", "init", "-q", "-b", "main")
    sh(repo, "git", "config", "user.email", "someone@example.com")
    sh(repo, "git", "config", "user.name", "someone")
    put(repo, "a.txt", f"ここは{WORD}の話\n")
    put(repo, "old.txt", "消したファイル\n")
    put(repo, "pics/clean.png", CLEAN_PNG)
    sh(repo, "git", "add", ".")
    sh(repo, "git", "commit", "-q", "-m", f"{WORD} を足す")
    sh(repo, "git", "rm", "-q", "old.txt")
    sh(repo, "git", "commit", "-q", "-m", "消す")
    sh(repo, "git", "checkout", "-q", "-b", "archive/old")
    put(repo, "shop/menu.json", '{"店": "献立"}\n')
    put(repo, "notes/try.md", "人型を試した記録\n")
    put(repo, "pics/ai.png", AI_PNG)
    sh(repo, "git", "add", ".")
    sh(repo, "git", "commit", "-q", "-m", "保管: 前の柱")
    sh(repo, "git", "checkout", "-q", "main")
    return repo


class RewriteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.repo = make_repo(self.root)
        self.rules = os.path.join(self.root, "rules.local.txt")
        self.terms = os.path.join(self.root, "terms.local.txt")
        self.mailmap = os.path.join(self.root, "mailmap.local.txt")
        self.drops = os.path.join(self.root, "drop.local.txt")
        with open(self.rules, "w", encoding="utf-8") as f:
            f.write(f"literal:{WORD}==>見本の村\n")
        with open(self.terms, "w", encoding="utf-8") as f:
            f.write(f"# 試験\n{WORD}\n")
        with open(self.mailmap, "w", encoding="utf-8") as f:
            f.write("someone <1+someone@users.noreply.github.com> <someone@example.com>\n")
        with open(self.drops, "w", encoding="utf-8") as f:
            f.write("# 店のデータ\nshop/\n")

    def tearDown(self):
        self.tmp.cleanup()

    def tool(self, work, *extra, mailmap=True):
        args = [sys.executable, TOOL, "--source", self.repo, "--work", work, "--rules", self.rules, "--terms", self.terms]
        if mailmap:
            args += ["--mailmap", self.mailmap]
        return subprocess.run([*args, *extra], capture_output=True, text=True, encoding="utf-8")

    def report(self, work):
        with open(os.path.join(work, "report.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_rewrites_copy_only(self):
        head_before = sh(self.repo, "git", "rev-parse", "main")
        work = os.path.join(self.root, "work")
        r = self.tool(work, "--keep", "main")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rep = self.report(work)
        self.assertEqual(rep["terms_left"], 0)
        self.assertTrue(rep["mailmap_used"])
        self.assertEqual(rep["dropped_refs"], 1)  # archive/old は写しから消える
        mirror = os.path.join(work, "mirror.git")
        self.assertEqual(set(sh(mirror, "git", "log", "--all", "--format=%ae").split()), {"1+someone@users.noreply.github.com"})
        self.assertNotIn(WORD, sh(mirror, "git", "log", "--all", "-p", "--format=%B"))
        self.assertNotIn("old.txt", sh(mirror, "git", "log", "--all", "--name-only", "--format="))
        self.assertTrue(os.path.isfile(os.path.join(work, "backup_all.bundle")))
        self.assertTrue(os.path.isfile(os.path.join(work, "commit-map.txt")))
        # 元のリポジトリは変わらない
        self.assertEqual(sh(self.repo, "git", "rev-parse", "main"), head_before)
        self.assertIn(WORD, sh(self.repo, "git", "log", "--all", "--format=%B"))
        self.assertIn("archive/old", sh(self.repo, "git", "branch"))
        self.assertNotIn(WORD, r.stdout)  # 語そのものは画面に出さない

    def test_keep_rename_drop_paths_and_ai_images(self):
        work = os.path.join(self.root, "w2")
        r = self.tool(work, "--keep", "main", "--keep", "archive/old:before-pivot", "--drop-paths", self.drops,
                      "--strip-ai-images", mailmap=False)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rep = self.report(work)
        mirror = os.path.join(work, "mirror.git")
        heads = sh(mirror, "git", "for-each-ref", "--format=%(refname)", "refs/heads").split()
        self.assertEqual(sorted(heads), ["refs/heads/before-pivot", "refs/heads/main"])
        names = sh(mirror, "git", "log", "--all", "--name-only", "--format=")
        self.assertNotIn("shop/menu.json", names)            # 外す場所は全部の履歴から消える
        self.assertIn("notes/try.md", sh(mirror, "git", "ls-tree", "-r", "--name-only", "before-pivot"))
        self.assertEqual(rep["ai_images_found"], 1)
        self.assertEqual(rep["ai_images_left"], 0)
        self.assertEqual(rep["branches"]["before-pivot"]["dropped_ai_images"], ["pics/ai.png"])
        self.assertEqual(rep["branches"]["before-pivot"]["dropped_by_policy"], 1)
        self.assertEqual(rep["unexpected_tree_changes"], {})
        self.assertIn("pics/clean.png", sh(mirror, "git", "ls-tree", "-r", "--name-only", "main"))
        self.assertFalse(rep["mailmap_used"])
        self.assertEqual(set(sh(mirror, "git", "log", "--all", "--format=%ae").split()), {"someone@example.com"})  # メールは今のまま
        # 「消す」のコミットは、消したファイルごと履歴から外れて空になるので落ちる(2 → 1、3 → 2)
        self.assertEqual((rep["branches"]["main"]["commits_before"], rep["branches"]["main"]["commits_after"]), (2, 1))
        self.assertEqual((rep["branches"]["before-pivot"]["commits_before"], rep["branches"]["before-pivot"]["commits_after"]), (3, 2))
        # 元のリポジトリの線の名前と中身は変わらない
        self.assertIn("archive/old", sh(self.repo, "git", "branch"))
        self.assertIn("shop/menu.json", sh(self.repo, "git", "ls-tree", "-r", "--name-only", "archive/old"))

    def test_path_names_and_regex_terms_are_checked(self):
        put(self.repo, "docs/himitsu_note.md", "ふつうの文\n")
        sh(self.repo, "git", "add", ".")
        sh(self.repo, "git", "commit", "-q", "-m", "名前に語のあるファイル")
        with open(self.terms, "w", encoding="utf-8") as f:
            f.write(f"{WORD}\nrei:\\bhimitsu\n")
        work = os.path.join(self.root, "w3")
        r = self.tool(work, "--keep", "main")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)  # 中身の置き換えでは名前は替わらないので残る
        detail = self.report(work)["terms_left_detail"]
        self.assertGreater(detail["rei:\\bhimitsu"]["path"], 0)
        self.assertNotIn("himitsu", r.stdout)

    def test_reports_left_terms(self):
        with open(self.rules, "w", encoding="utf-8") as f:
            f.write("literal:関係ない語==>x\n")
        r = self.tool(os.path.join(self.root, "work2"), "--keep", "main")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertNotIn(WORD, r.stdout)

    def test_refuses_nonempty_work_missing_files_and_bad_terms(self):
        work = os.path.join(self.root, "busy")
        os.makedirs(work)
        open(os.path.join(work, "x"), "w").close()
        self.assertEqual(self.tool(work).returncode, 2)
        with open(self.terms, "w", encoding="utf-8") as f:
            f.write("re:([\n")
        self.assertEqual(self.tool(os.path.join(self.root, "work4")).returncode, 2)
        os.remove(self.terms)
        self.assertEqual(self.tool(os.path.join(self.root, "work3")).returncode, 2)

    def test_refuses_rename_onto_existing_branch(self):
        sh(self.repo, "git", "branch", "before-pivot")
        r = self.tool(os.path.join(self.root, "w5"), "--keep", "main", "--keep", "archive/old:before-pivot", mailmap=False)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)


class DetectorTest(unittest.TestCase):
    def test_ai_signed(self):
        self.assertTrue(rewrite_history.ai_signed(AI_PNG))
        self.assertFalse(rewrite_history.ai_signed(CLEAN_PNG))
        self.assertTrue(rewrite_history.ai_signed(CLEAN_PNG + b"tEXtprompt\x00{}"))           # 生成の指示の文
        self.assertTrue(rewrite_history.ai_signed(b"\xff\xd8\xff\xe1" + b"trainedAlgorithmicMedia"))  # IPTC の印
        self.assertFalse(rewrite_history.ai_signed(b"c2pa Chat" + b"GPT plain text"))         # 絵でなければ見ない
        self.assertFalse(rewrite_history.ai_signed(CLEAN_PNG + b"c2pa"))                       # 署名だけで AI の語が無い

    def test_drop_patterns(self):
        pats = ["shop/", "web/test/shop*", "docs/店の*.md"]
        self.assertEqual(rewrite_history.dropped_by("shop/a/b.json", pats), "shop/")
        self.assertEqual(rewrite_history.dropped_by("web/test/shop.test.mjs", pats), "web/test/shop*")
        self.assertEqual(rewrite_history.dropped_by("docs/店の接客.md", pats), "docs/店の*.md")
        self.assertIsNone(rewrite_history.dropped_by("shopping/a.md", pats))


class TermListTest(unittest.TestCase):
    def test_forms(self):
        hit = lambda line, text: bool(termlist.compile_term(line).search(text))
        self.assertTrue(hit("Abc", "xxabcxx"))                 # 既定: 区別しない
        self.assertFalse(hit("cs:ABC", "abc"))                 # cs: 区別する
        self.assertTrue(hit(r"re:\bGLM\b", "とGLMで"))         # \b は英数字だけ(日本語の隣でも切れ目)
        self.assertFalse(hit(r"re:\bGLM\b", "GLMS"))
        self.assertTrue(hit(r"rei:\btripo(?!d)", "Tripo で"))
        self.assertFalse(hit(r"rei:\btripo(?!d)", "solve_tripod と Tripod"))

    def test_bad_regex_names_the_line_only(self):
        path = os.path.join(tempfile.mkdtemp(), "t.local.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write("# 注\nひみつ\nre:([\n")
        with self.assertRaises(ValueError) as cm:
            termlist.load(path)
        self.assertIn("2 行目", str(cm.exception))
        self.assertNotIn("ひみつ", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
