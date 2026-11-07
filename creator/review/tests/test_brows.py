"""眉のおすすめ(本人 11/7: 眉のないキャラクターには、眉を足すのをすすめる)の試験。Claude を呼ばない。
- 決まった SVG で、眉(K1 の brow_R・brow_L)があるか無いかを見分ける
- 確かめる画面と作る画面の決まった一言(suggest.js)が 40 字までで、描き直しの決まった確かめが「眉だけ足す・ほかは保つ」と読む
- 眉の一言の時、描き手への頼みの文に「眉は K1 の決まった部品へ・ほかは保つ」が入る(試験の絵で 1 往復)
- サーバーの束の答え(look.brows)
使い方: python -m unittest discover creator/review/tests -p "test_*.py"
"""
import json
import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REVIEW = HERE.parent
sys.path.insert(0, str(REVIEW))
sys.path.insert(0, str(HERE))
import redo_check as rc  # noqa: E402
import review_state as rs  # noqa: E402
import serve_review as sr  # noqa: E402
import fake_draw  # noqa: E402
from test_make import MakeBase  # noqa: E402

HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254"><g id="char">'
BODY = '<g id="body"><circle cx="627" cy="640" r="320" fill="#f2a541"/></g>'
EYES = ('<g id="eye_R"><ellipse cx="530" cy="600" rx="34" ry="48" fill="#2b2b2b"/></g>'
        '<g id="eye_L"><ellipse cx="724" cy="600" rx="34" ry="48" fill="#2b2b2b"/></g>')
BROW = '<path d="M490 520 Q530 500 570 520" stroke="#2b2b2b" stroke-width="9" fill="none"/>'
TAIL = "</g></svg>"


def svg(*parts):
    return HEAD + "".join(parts) + TAIL


def suggest_notes():
    """suggest.js の決まった一言(眉の選び 3 つと、よく頼む直し 5 つ)を読む"""
    text = (REVIEW / "page" / "suggest.js").read_text(encoding="utf-8")
    return re.findall(r'note: "([^"]+)"', text)


class BrowDetectTest(unittest.TestCase):
    def test_no_brows(self):
        self.assertEqual(rc.brow_info(svg(BODY, EYES)), {"has": False, "parts": [], "face": False})
        self.assertFalse(rc.brow_info(fake_draw.svg_text("#f2a541", "#4caf50"))["has"], "試験の絵(眉なし)")

    def test_brows_as_k1_parts(self):
        info = rc.brow_info(svg(BODY, EYES, f'<g id="brow_R">{BROW}</g><g id="brow_L">{BROW}</g>'))
        self.assertEqual(info, {"has": True, "parts": ["brow_R", "brow_L"], "face": False})
        self.assertTrue(rc.brow_info(fake_draw.svg_text("#f2a541", "#4caf50", brows=True))["has"])

    def test_one_brow_is_enough(self):
        self.assertEqual(rc.brow_info(svg(BODY, EYES, f'<g id="brow_L">{BROW}</g>'))["parts"], ["brow_L"])

    def test_empty_or_hidden_brows_do_not_count(self):
        self.assertFalse(rc.brow_info(svg(BODY, EYES, '<g id="brow_R"></g><g id="brow_L"/>'))["has"], "空の組")
        hidden = BROW.replace("<path ", '<path opacity="0" ')
        self.assertFalse(rc.brow_info(svg(BODY, EYES, f'<g id="brow_R">{hidden}</g>'))["has"], "見えない線")

    def test_brows_nested_in_head(self):
        info = rc.brow_info(svg(BODY, f'<g id="head"><circle cx="627" cy="500" r="200" fill="#f2a541"/><g id="brow_R">{BROW}</g></g>'))
        self.assertEqual((info["has"], info["parts"]), (True, ["brow_R"]))

    def test_2d_face_brows(self):
        info = rc.brow_info(svg(BODY, EYES, f'<g id="face.happy.brows">{BROW}</g>'))
        self.assertEqual((info["has"], info["face"]), (True, True))

    def test_samples_without_brows(self):
        # 見本の元の絵(作例)は眉が無い = 撮影の no-eyebrow の子に使える
        for p in sorted((REVIEW.parents[0] / "samples").glob("*_元の絵.svg")):
            self.assertFalse(rc.brow_info(p.read_text(encoding="utf-8"))["has"], p.name)


class BrowNoteTest(unittest.TestCase):
    def test_fixed_notes_are_short_and_clean(self):
        notes = suggest_notes()
        self.assertEqual(len(notes), 8, notes)     # 眉の選び 3 つ + よく頼む直し 5 つ
        for n in notes:
            self.assertLessEqual(len(n), rs.NOTE_MAX, n)
            self.assertEqual(rs.clean_note(n), n, "掃除しても変わらない一言")

    def test_brow_notes_allow_only_brows(self):
        for n in ("眉を足す(ふつうの太さ)。ほかは変えない", "眉を足す(ほそめ)。ほかは変えない", "眉を足す(ふとめ)。ほかは変えない"):
            self.assertIn(n, suggest_notes())
            a = rc.allowed(n)
            self.assertFalse(a["all"], n)
            self.assertEqual(a["parts"], {"brow_R", "brow_L"}, n)
            self.assertFalse(a["name"], n)
            self.assertTrue(rc.is_brow_note(n))

    def test_brow_redo_keeps_the_rest(self):
        note = "眉を足す(ふつうの太さ)。ほかは変えない"
        prev = fake_draw.svg_text("#f2a541", "#4caf50")
        same = fake_draw.svg_text("#f2a541", "#4caf50", brows=True)
        self.assertTrue(rc.compare(prev, same, note)["ok"], "眉だけ足した絵は通る")
        drift = fake_draw.svg_text("#7cc4e8", "#4caf50", brows=True)
        res = rc.compare(prev, drift, note)
        self.assertFalse(res["ok"], "眉と一緒に体の色も変えたら外れる")
        self.assertIn("body", res["beyond"][0]["parts"])

    def test_color_only_chip_keeps_shapes(self):
        a = rc.allowed("色だけ変える。ほかは そのまま")
        self.assertEqual(a["shape"], set(), "「形はそのまま色だけ変える」は形を変えてよい物にしない")
        self.assertTrue(a["color"])

    def test_brow_brief(self):
        b = rc.brow_brief("眉を足す(ほそめ)。ほかは変えない")
        for w in ("brow_R", "brow_L", "ほそめ", "名前", "hex"):
            self.assertIn(w, b)
        self.assertIn("ふつう", rc.brow_brief("眉を足す(ふつうの太さ)。ほかは変えない"))
        self.assertIn("ふとめ", rc.brow_brief("眉を足す(ふとめ)。ほかは変えない"))
        self.assertEqual(rc.brow_brief("帽子を青にして"), "")


class BrowLookTest(unittest.TestCase):
    def test_look_of_bundle(self):
        import tempfile
        d = Path(tempfile.mkdtemp(prefix="yc_look_"))
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        (d / "right.svg").write_text(fake_draw.svg_text("#f2a541", "#4caf50"), encoding="utf-8")
        man = {"gate": "C0", "compare": {"left": None, "right": "right.svg"}, "files": {"right.svg": "sha256:" + "0" * 64}}
        self.assertEqual(sr.look_of(d, man), {"brows": False})
        (d / "right.svg").write_text(fake_draw.svg_text("#f2a541", "#4caf50", brows=True), encoding="utf-8")
        self.assertEqual(sr.look_of(d, man), {"brows": True})
        self.assertEqual(sr.look_of(d, {**man, "gate": "C2"}), {"brows": None}, "絵の確認(C0)だけ")
        png = {"gate": "C0", "compare": {"left": None, "right": "right.png"}, "files": {"right.png": "sha256:" + "0" * 64}}
        self.assertEqual(sr.look_of(d, png), {"brows": None}, "絵だけ(PNG)は分からない = おすすめを出さない")
        (d / "right.svg").write_text("<svg", encoding="utf-8")
        self.assertEqual(sr.look_of(d, man), {"brows": None}, "読めない SVG")


class BrowRedoFlowTest(MakeBase):
    def test_brow_redo_brief_and_result(self):
        os.environ["YC_FAKE_REDO"] = "brows"
        self.addCleanup(os.environ.pop, "YC_FAKE_REDO", None)
        cid = rs.make_new({"from": "words", "words": "みかんの子。頭に葉っぱ"}, "pc")["id"]
        code, res = self.next("--fake-draw")
        self.assertEqual((code, res.get("did")), (0, "drew"), res)
        bdir = rs.review_dir(cid) / "C0" / "r1"
        self.assertEqual(sr.look_of(bdir, rs.read_json(bdir / "manifest.json")), {"brows": False}, "1 回目は眉なし")
        note = "眉を足す(ふつうの太さ)。ほかは変えない"
        self.decide(cid, "redo", note=note)
        code, res = self.next("--fake-draw")
        self.assertEqual((code, res.get("did"), res.get("round")), (0, "redrew", 2), res)
        self.assertEqual(res["identity"], {"checked": True, "passes": 1, "fixed_by_redraw": False, "beyond": [], "notice": None})
        brief = (Path(self.work) / cid / "draw" / "r2" / "brief.md").read_text(encoding="utf-8")
        self.assertIn("brow_R", brief)
        self.assertIn("brow_L", brief)
        self.assertIn("太さは ふつう", brief)
        self.assertIn(note, brief, "一言は申し送りの囲みの中にそのまま")
        b2 = rs.review_dir(cid) / "C0" / "r2"
        self.assertEqual(sr.look_of(b2, rs.read_json(b2 / "manifest.json")), {"brows": True}, "2 回目は眉あり = おすすめは消える")
        log = json.loads((Path(self.work) / cid / "draw" / "r2" / "redo_check.json").read_text(encoding="utf-8"))
        self.assertEqual(log["checks"][0]["within"][0]["kind"], "added")
        self.assertEqual(rs.load_state(cid)["name"], "ためしちゃん")

    def test_other_note_has_no_brow_brief(self):
        os.environ["YC_FAKE_REDO"] = "keep"
        self.addCleanup(os.environ.pop, "YC_FAKE_REDO", None)
        cid = rs.make_new({"from": "words", "words": "みかんの子"}, "pc")["id"]
        self.next("--fake-draw")
        self.decide(cid, "redo", note="帽子を青にして")
        self.next("--fake-draw")
        brief = (Path(self.work) / cid / "draw" / "r2" / "brief.md").read_text(encoding="utf-8")
        self.assertNotIn("brow_R と brow_L に入れる", brief)


if __name__ == "__main__":
    unittest.main()
