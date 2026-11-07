#!/usr/bin/env python3
"""tools/name_check.py の試験。流し方: python tools/test_name_check.py"""
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "name_check.py")
BARE = chr(0x30CE) + chr(0x30EA)  # 伸ばす棒の無い形。この試験の中にも、その 2 字を続けて書かない
GOOD = BARE + chr(0x30FC)  # 伸ばす棒つきの呼び名
OLD_EN = "Nor" + "i"  # 英語の名前の古い形


class NameCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = os.path.join(self.tmp.name, "repo")
        self.hooks = os.path.join(self.tmp.name, "nohooks").replace("\\", "/")  # 外のフックを動かさない
        os.makedirs(self.repo)
        os.makedirs(self.hooks)
        self.git("init", "-q")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        base = ["git", "-c", "core.autocrlf=false", "-c", f"core.hooksPath={self.hooks}",
                "-c", "user.name=test", "-c", "user.email=test@example.com"]
        return subprocess.run(base + list(args), cwd=self.repo, capture_output=True, text=True, encoding="utf-8", check=True).stdout

    def put(self, files, add=True, commit=False):
        for path, body in files.items():
            full = os.path.join(self.repo, *path.split("/"))
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "wb") as f:
                f.write(body if isinstance(body, bytes) else body.encode("utf-8"))
        if add:
            self.git("add", "-A", "--", *files)
        if commit:
            self.git("commit", "-q", "-m", "fixture")

    def check(self, *extra, env=None):
        run_env = {k: v for k, v in os.environ.items() if k != "NAME_CHECK_SKIP"}  # 外の設定に左右されない
        run_env.update({"PYTHONIOENCODING": "utf-8", **(env or {})})
        r = subprocess.run([sys.executable, TOOL, "--repo", self.repo, *extra], capture_output=True, text=True,
                           encoding="utf-8", env=run_env)
        return r.returncode, r.stdout

    def test_flags_the_bare_name_with_place(self):
        self.put({"a.md": f"x\r\n「{BARE}」、がんばりマス!\r\n"})
        rc, out = self.check()
        self.assertEqual(rc, 1, out)
        self.assertIn("誤り: a.md:2:2:", out)
        self.assertIn("誤り 1 件", out)

    def test_long_bar_and_other_words_pass(self):
        lines = [f"{GOOD}、がんばりマス!", f"{BARE * 2}で踊る", f"{BARE}ツッコミ", f"悪{BARE}", f"{BARE}気",
                 f"タカ{BARE}さん(長い片仮名の語の一部)", f"{GOOD}デス"]
        self.put({"b.md": "\n".join(lines) + "\n"})
        rc, out = self.check()
        self.assertEqual(rc, 0, out)
        self.assertIn("誤り 0 件・注意 0 件", out)

    def test_name_followed_by_katakana_is_still_flagged(self):
        self.put({"c.md": f"{BARE}デス!\n"})
        rc, out = self.check()
        self.assertEqual(rc, 1, out)
        self.assertIn("c.md:1:1:", out)

    def test_skips_docs_plan_and_the_rewrite_drop_list(self):
        self.put({"docs/plan/p.md": BARE, "kiosk/k.md": BARE, "web/test/shop_x.test.mjs": BARE,
                  "creator/samples/s.md": BARE, "keep.md": GOOD})
        skip = os.path.join(self.tmp.name, "drop.local.txt")
        with open(skip, "w", encoding="utf-8") as f:
            f.write("# 注の行\nkiosk/\nweb/test/shop*\nold:creator/samples/*\n")
        for extra, env in (([], None), (["--skip-file", skip], None), ([], {"NAME_CHECK_SKIP": skip})):
            rc, out = self.check(*extra, env=env)
            flagged = sorted(re.findall(r"誤り: ([^:]+):", out))
            expect = ["creator/samples/s.md"] if extra or env else ["creator/samples/s.md", "kiosk/k.md", "web/test/shop_x.test.mjs"]
            self.assertEqual(flagged, expect, out)  # docs/plan はいつも外す。old: の行は今の版が残るので外さない
            self.assertEqual(rc, 1, out)

    def test_claude_folder_is_a_warning_only(self):
        self.put({".claude/skills/s/SKILL.md": f"一人称は「{BARE}」\n"})
        rc, out = self.check()
        self.assertEqual(rc, 0, out)
        self.assertIn("注意(.claude の下", out)
        self.assertIn("誤り 0 件・注意 1 件", out)

    def test_untracked_and_binary_files_are_not_read(self):
        self.put({"u.md": BARE}, add=False)
        self.put({"bin.dat": b"\x89PNG\x00\x00" + BARE.encode("utf-8")})
        rc, out = self.check()
        self.assertEqual(rc, 0, out)

    def test_old_english_name_is_flagged_but_code_names_are_not(self):
        self.put({"e.md": f'Norrie calls itself "{OLD_EN}".\n', "f.js": "const nori = 1; // Norrie\n"})
        rc, out = self.check()
        self.assertEqual(rc, 1, out)
        self.assertEqual(re.findall(r"誤り: ([^:]+:\d+):", out), ["e.md:1"], out)
        self.assertIn("Norrie と書く", out)

    def test_rev_reads_the_commit_or_tree_not_the_working_tree(self):
        self.put({"r.md": f"{BARE}、まだなにも覚えていなかったデス。\n"}, commit=True)
        self.put({"r.md": f"{GOOD}、まだなにも覚えていなかったデス。\n"}, add=False)
        self.assertEqual(self.check()[0], 0)
        rc, out = self.check("--rev", "HEAD")
        self.assertEqual(rc, 1, out)
        self.assertIn("r.md:1:1:", out)
        tree = self.git("rev-parse", "HEAD^{tree}").strip()
        self.assertEqual(self.check("--rev", tree)[0], 1)  # git merge-tree --write-tree の木も見られる

    def test_allow_adds_a_word(self):
        self.put({"d.md": f"{BARE}タケのお皿\n"})
        self.assertEqual(self.check()[0], 1)
        rc, out = self.check("--allow", f"{BARE}タケ")
        self.assertEqual(rc, 0, out)

    def test_stops_when_it_cannot_run(self):
        self.put({"ok.md": GOOD}, commit=True)
        empty = os.path.join(self.tmp.name, "empty")
        os.makedirs(empty)
        cases = [["--repo", empty], ["--rev", "no-such-commit"], ["--skip-file", os.path.join(self.tmp.name, "none.txt")]]
        for extra in cases:
            r = subprocess.run([sys.executable, TOOL, "--repo", self.repo, *extra], capture_output=True, text=True,
                               encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
            self.assertEqual(r.returncode, 2, (extra, r.stdout, r.stderr))
            self.assertIn("名前の点検を止めました", r.stdout)


class SourceTest(unittest.TestCase):
    def test_tool_and_test_hold_no_old_form(self):
        sys.path.insert(0, HERE)
        import name_check
        for path in (TOOL, os.path.abspath(__file__)):
            with open(path, encoding="utf-8") as f:
                for no, line in enumerate(f, 1):
                    self.assertEqual(name_check.line_hits(line, name_check.DEFAULT_ALLOW), [], f"{path}:{no}")


if __name__ == "__main__":
    unittest.main()
