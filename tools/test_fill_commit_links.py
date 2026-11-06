#!/usr/bin/env python3
"""tools/fill_commit_links.py の試験。流し方: python tools/test_fill_commit_links.py"""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "fill_commit_links.py")
OLD_A, NEW_A = "a" * 7 + "1" * 33, "b" * 40
OLD_B, NEW_B = "c" * 7 + "2" * 33, "0" * 40          # 書き換えで消えたコミット
OLD_C, OLD_D = "dddddd1" + "3" * 33, "dddddd1" + "4" * 33  # 短い SHA が 1 つに決まらない


class FillTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.map = os.path.join(self.tmp.name, "commit-map.txt")
        with open(self.map, "w", encoding="utf-8") as f:
            f.write("old                                      new\n")
            for o, n in [(OLD_A, NEW_A), (OLD_B, NEW_B), (OLD_C, "e" * 40), (OLD_D, "f" * 40)]:
                f.write(f"{o} {n}\n")
        self.doc = os.path.join(self.tmp.name, "doc.md")

    def tearDown(self):
        self.tmp.cleanup()

    def run_tool(self, text, *extra):
        with open(self.doc, "w", encoding="utf-8") as f:
            f.write(text)
        r = subprocess.run([sys.executable, TOOL, "--map", self.map, "--repo", "https://example.com/o/r/", *extra, self.doc],
                           capture_output=True, text=True, encoding="utf-8")
        with open(self.doc, encoding="utf-8") as f:
            return r, f.read()

    def test_replaces_marks_with_new_sha_links(self):
        r, out = self.run_tool("曲がり角は [ここ]({{commit:aaaaaaa}})。\n")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn(f"https://example.com/o/r/commit/{NEW_A}", out)
        self.assertNotIn("{{commit:", out)

    def test_refuses_gone_ambiguous_and_unknown_and_writes_nothing(self):
        text = "{{commit:aaaaaaa}} {{commit:ccccccc}} {{commit:dddddd1}} {{commit:9999999}}\n"
        r, out = self.run_tool(text)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertEqual(out, text)                     # 1 つでも置き換えられなければ書かない
        self.assertIn("消えた", r.stdout)
        self.assertIn("1 つに決まらない", r.stdout)
        self.assertIn("表に無い", r.stdout)

    def test_check_mode_does_not_write(self):
        text = "{{commit:aaaaaaa}}\n"
        r, out = self.run_tool(text, "--check")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(out, text)


if __name__ == "__main__":
    unittest.main()
