"""yc-0-draw の道具の試験(部品の名前の決まり)。使い方: python -m unittest creator/draw/test_draw.py(リポジトリの一番上で)"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "creator" / "pipeline"))
from d03_svgkit import Kit, circle, ellipse, shape_svg  # noqa: E402

D02 = REPO / "creator" / "pipeline" / "d02_check_svg.py"


def minimal_kit():
    k = Kit()
    k.add(shape_svg(circle(627, 600, 300), 'fill="#7ab"'), "body")
    k.add(shape_svg(ellipse(560, 560, 30, 40), 'fill="#123"'), "eye_R")
    k.add(shape_svg(ellipse(694, 560, 30, 40), 'fill="#123"'), "eye_L")
    k.add('<path d="M600,650 Q627,680 654,650" stroke="#123" stroke-width="9" fill="none"/>', "mouth")
    return k


def lint_svg_only(svg_text):
    """PNG なしで SVG の点検だけ流す(PNG が無いので不可 1 つは必ず出る。部品の行だけ見る)。"""
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "x.svg"
        p.write_text(svg_text, encoding="utf-8")
        out = subprocess.run([sys.executable, str(D02), str(p)], capture_output=True, text=True, encoding="utf-8").stdout
    return [line for line in out.splitlines() if line.startswith("[不可]")]


class PartsRule(unittest.TestCase):
    def test_good_svg_has_fixed_groups(self):
        svg = minimal_kit().svg()
        self.assertIn('<g id="char"', svg)
        for g in ("body", "eye_R", "eye_L", "mouth"):
            self.assertIn(f'<g id="{g}">', svg)
        bad = [b for b in lint_svg_only(svg) if "PNG" not in b]
        self.assertEqual(bad, [])

    def test_unknown_part_name_is_refused(self):
        with self.assertRaises(ValueError):
            Kit().add("<circle/>", "eyeL")

    def test_split_part_is_refused(self):
        k = minimal_kit()
        k.add("<circle/>", "hat")
        k.add("<circle/>", "body")
        with self.assertRaises(ValueError):
            k.svg()

    def test_missing_required_part_is_refused(self):
        k = Kit()
        k.add("<circle/>", "body")
        with self.assertRaises(ValueError):
            k.svg()

    def test_lint_fails_without_char_group(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254"><rect width="1254" height="1254" fill="#fff"/><circle cx="627" cy="627" r="300"/></svg>'
        self.assertTrue(any("char" in b for b in lint_svg_only(svg)))

    def test_lint_fails_on_unknown_and_stray(self):
        svg = minimal_kit().svg().replace('<g id="mouth">', '<g id="mouf">')
        bad = lint_svg_only(svg)
        self.assertTrue(any("決まった名前" in b for b in bad))
        self.assertTrue(any("要る部品" in b for b in bad))


if __name__ == "__main__":
    unittest.main()
