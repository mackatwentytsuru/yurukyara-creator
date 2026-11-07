"""描き直しの決まった確かめ(redo_check.py)の試験。決まった SVG と絵で、頼まれた所だけが変わったかを見る(Claude を呼ばない)。
本人のひとこと N-0026: 「みかんの子なのに、葉っぱだけ変えればいいのに、みかんの色まで変わっているのがおかしい」。
使い方: python -m unittest discover creator/review/tests -p "test_*.py"
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REVIEW = HERE.parent
ROOT = REVIEW.parents[1]
sys.path.insert(0, str(REVIEW))
sys.path.insert(0, str(ROOT / "creator" / "pipeline"))
import redo_check as rc  # noqa: E402

ORANGE = ("#ffc15a", "#ff8a1c", "#d9560a")
YELLOW = ("#fff3b8", "#f7d36a", "#d99a2e")
LEAF = ("#8fdc4a", "#2e9a2e")


def mikan(body=ORANGE, leaf=LEAF, leaf_scale=1.0, ears=False, arms=True, eye_dx=0):
    """みかんの子の形の決まった SVG(d03_svgkit と同じ作り: グラデーション・切り抜き・うすい光・mask の縁)。"""
    s = leaf_scale
    ear = ("<g id=\"ear_R\"><ellipse cx=\"420\" cy=\"330\" rx=\"110\" ry=\"50\" fill=\"#5fbf3a\"/></g>"
           "<g id=\"ear_L\"><ellipse cx=\"834\" cy=\"330\" rx=\"110\" ry=\"50\" fill=\"#5fbf3a\"/></g>") if ears else ""
    arm = ("<g id=\"arm_R\"><ellipse cx=\"260\" cy=\"670\" rx=\"84\" ry=\"70\" transform=\"rotate(18 260 670)\" fill=\"url(#ga)\"/></g>"
           "<g id=\"arm_L\"><ellipse cx=\"994\" cy=\"670\" rx=\"84\" ry=\"70\" transform=\"rotate(-18 994 670)\" fill=\"url(#ga)\"/></g>") if arms else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254">
<defs>
<clipPath id="cb"><ellipse cx="627" cy="635" rx="328" ry="296"/></clipPath>
<radialGradient id="gb" cx="620" cy="620" r="700" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{body[0]}"/><stop offset="0.45" stop-color="{body[1]}"/><stop offset="1" stop-color="{body[2]}"/></radialGradient>
<radialGradient id="ga" cx="285" cy="650" r="95" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{body[0]}"/><stop offset="1" stop-color="{body[1]}"/></radialGradient>
<linearGradient id="gl" x1="640" y1="240" x2="840" y2="380" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{leaf[0]}"/><stop offset="1" stop-color="{leaf[1]}"/></linearGradient>
<mask id="rim"><rect width="1254" height="1254" fill="#fff"/></mask>
</defs>
<rect width="1254" height="1254" fill="#ffffff"/>
<g id="char" transform="translate(627 1000) scale(1.05) translate(-627 -930)">
<g id="shadow"><ellipse cx="627" cy="930" rx="300" ry="28" fill="#27323f" opacity="0.28"/></g>
<g id="foot_R"><ellipse cx="508" cy="940" rx="100" ry="66" fill="#e08a2a"/></g>
<g id="foot_L"><ellipse cx="746" cy="940" rx="100" ry="66" fill="#e08a2a"/></g>
{arm}
<g id="body"><g clip-path="url(#cb)"><rect width="1254" height="1254" fill="url(#gb)"/><rect width="1254" height="1254" fill="#b8420a" opacity="0.5" mask="url(#rim)"/></g><ellipse cx="480" cy="460" rx="95" ry="45" fill="#ffffff" opacity="0.55"/></g>
<g id="cheek_R"><ellipse cx="462" cy="720" rx="44" ry="28" fill="#ff5a5a" opacity="0.75"/></g>
<g id="cheek_L"><ellipse cx="792" cy="720" rx="44" ry="28" fill="#ff5a5a" opacity="0.75"/></g>
<g id="eye_R"><ellipse cx="{548 + eye_dx}" cy="660" rx="39" ry="53" fill="#3a1c0e"/><circle cx="{537 + eye_dx}" cy="644" r="14" fill="#fff"/></g>
<g id="eye_L"><ellipse cx="{706 - eye_dx}" cy="660" rx="39" ry="53" fill="#3a1c0e"/><circle cx="{695 - eye_dx}" cy="644" r="14" fill="#fff"/></g>
<g id="mouth"><path d="M585,716 Q627,803 669,716 Q627,723 585,716 Z" fill="#3a1c0e"/><clipPath id="mc"><path d="M585,716 Q627,803 669,716 Z"/></clipPath><ellipse cx="627" cy="778" rx="18" ry="23" fill="#ff6f7f" clip-path="url(#mc)"/></g>
{ear}
<g id="hat" transform="translate(630 372) scale({s}) translate(-630 -372)"><rect x="606" y="322" width="40" height="62" rx="18" fill="#6a4a1a"/><path d="M630,352 C628,262 730,195 872,218 C878,326 770,408 640,372 Z" fill="url(#gl)"/></g>
</g>
</svg>
"""


def kinds(res):
    return {(b["kind"], p) for b in res["beyond"] for p in (b["parts"] or [None])}


class CompareTest(unittest.TestCase):
    def test_leaf_only_change_passes(self):
        res = rc.compare(mikan(), mikan(leaf=("#9be05a", "#2f9a38"), leaf_scale=1.6), "葉っぱを大きく", [], "みかんちゃん", "みかんちゃん")
        self.assertTrue(res["ok"], res["beyond"])
        self.assertIn(("shape", "hat"), {(w["kind"], p) for w in res["within"] for p in w["parts"]}, "葉の直しは頼まれた変化")
        self.assertIsNone(rc.notice_text(res["beyond"]))

    def test_body_color_change_fails(self):
        # 撮影の「めばえ」と同じ: 葉を大きくしたら、体(と手)の色まで黄色になった
        res = rc.compare(mikan(), mikan(body=YELLOW, leaf_scale=1.6), "葉っぱを大きく", [], "みかんちゃん", "めばえ")
        self.assertFalse(res["ok"])
        self.assertIn(("color", "body"), kinds(res))
        self.assertIn(("color", "arm_R"), kinds(res))
        self.assertIn(("name", None), kinds(res))
        self.assertNotIn(("color", "hat"), kinds(res), "葉は頼まれた所")
        note = rc.notice_text(res["beyond"])
        self.assertIn("体の色(だいだい→黄)", note)
        self.assertLessEqual(len(note), 120)
        self.assertNotRegex(note, r"#[0-9a-f]{3}|_R|_L|body|hat", "札は内部の言葉なしのやさしい日本語")
        briefs = " ".join(b["brief"] for b in res["beyond"])
        self.assertIn("body(体)", briefs)
        self.assertRegex(briefs, r"前 #[0-9a-f]{6} → 今 #[0-9a-f]{6}", "描き手には前と今の色を hex で渡す")

    def test_small_shading_change_passes(self):
        res = rc.compare(mikan(), mikan(body=("#ffc35c", "#ff8c1e", "#d8580c")), "帽子を青にして", [])
        self.assertTrue(res["ok"], res["beyond"])

    def test_parts_added_or_removed_fail(self):
        res = rc.compare(mikan(), mikan(ears=True), "帽子を青にして", [])
        self.assertIn(("added", "ear_R"), kinds(res))
        res = rc.compare(mikan(), mikan(arms=False), "帽子を青にして", [])
        self.assertIn(("removed", "arm_L"), kinds(res))
        self.assertIn("手(左右)がなくなった", rc.notice_text(res["beyond"]))
        # 葉っぱを 2 枚に = 頭の上の物・耳を足してよい
        self.assertTrue(rc.compare(mikan(), mikan(ears=True), "葉っぱを 2 枚にして", [])["ok"])

    def test_moved_part_fails(self):
        res = rc.compare(mikan(), mikan(eye_dx=-60), "帽子を青にして", [])
        self.assertIn(("shape", "eye_R"), kinds(res))
        self.assertTrue(rc.compare(mikan(), mikan(eye_dx=-60), "目をはなして", [])["ok"])

    def test_words_and_tags_widen_what_may_change(self):
        body = mikan(body=YELLOW)
        self.assertFalse(rc.compare(mikan(), body, "帽子を青にして", [])["ok"])
        self.assertTrue(rc.compare(mikan(), body, "体を黄色にして", [])["ok"])
        self.assertTrue(rc.compare(mikan(), body, "もっと黄色っぽく", [])["ok"], "部品を言わない色の頼み = 体の色")
        self.assertTrue(rc.compare(mikan(), body, "", ["色が違う"])["ok"])
        self.assertTrue(rc.compare(mikan(), body, "全部作り直して", [])["ok"])
        self.assertTrue(rc.compare(mikan(), mikan(arms=False), "", ["部品が多い"])["ok"])
        self.assertFalse(rc.compare(mikan(), body, "", ["かわいくない"])["ok"], "かわいくない = 形はよい・色は保つ")

    def test_name_change(self):
        self.assertIn(("name", None), kinds(rc.compare(mikan(), mikan(), "帽子を青に", [], "みかんちゃん", "めばえ")))
        self.assertTrue(rc.compare(mikan(), mikan(), "名前をめばえにして", [], "みかんちゃん", "めばえ")["ok"])

    def test_word_traps(self):
        # 別の語に混ざる字で、頼んでいない部品を「頼まれた」としない
        for note, part in (("言葉どおりに", "hat"), ("見た目をかわいく", "eye_R"), ("帽子を足して", "foot_R"), ("上手に描いて", "arm_R"),
                           ("2 回目より丸く", "eye_R"), ("全体的にかわいく", "body")):
            a = rc.allowed(note)
            self.assertNotIn(part, a["parts"], note)

    def test_character_labels_from_settings(self):
        labels = rc.part_map("- 部品: shadow・body・ear_R/L(葉っぱ 2 枚)・hat(くき)\n- 部品: accessory = 赤いリボン")
        self.assertEqual(labels["ear_R"], "葉っぱ 2 枚")
        self.assertEqual(labels["hat"], "くき")
        self.assertIn("リボン", labels["accessory"])
        self.assertIn("hat", rc.allowed("くきを長く", labels=labels)["parts"])
        self.assertIn("accessory", rc.allowed("赤いリボンを青に", labels=labels)["parts"])

    def test_keep_brief_lists_exact_colors_and_count(self):
        text = rc.keep_brief(mikan(), "葉っぱを大きく", [], None, "みかんちゃん")
        self.assertIn("全部で 12 個", text)
        for hx in ORANGE:
            self.assertIn(hx, text)
        self.assertIn("一言で変えてよい物: ", text)
        self.assertIn("頭の上の物", text.split("一言で変えてよい物: ")[1].splitlines()[0])
        keep = [l for l in text.splitlines() if l.startswith("- 変えない物: ")][0]
        self.assertIn("・体・", keep.split("の色(上の hex のまま)")[0] + "・", "体の色は変えない物")
        self.assertIn("部品の数と種類", keep)
        self.assertIn("名前「みかんちゃん」", text)

    def test_parts_match_svgkit(self):
        import d03_svgkit
        self.assertEqual(rc.PARTS, d03_svgkit.PARTS)

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory(prefix="yc_redo_") as tmp:
            t = Path(tmp)
            (t / "prev.svg").write_text(mikan(), encoding="utf-8")
            (t / "leaf.svg").write_text(mikan(leaf_scale=1.5), encoding="utf-8")
            (t / "body.svg").write_text(mikan(body=YELLOW), encoding="utf-8")
            (t / "req.json").write_text(json.dumps({"note": "葉っぱを大きく", "tags": []}, ensure_ascii=False), encoding="utf-8")
            run = lambda new: subprocess.run([sys.executable, str(REVIEW / "redo_check.py"), "compare", str(t / "prev.svg"), str(t / new),
                                              "--request-file", str(t / "req.json"), "--json", str(t / "out.json")],
                                             capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(run("leaf.svg").returncode, 0)
            p = run("body.svg")
            self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
            self.assertIn("body(体)", p.stdout)
            self.assertFalse(json.loads((t / "out.json").read_text(encoding="utf-8"))["ok"])


class RasterTest(unittest.TestCase):
    """前の回が絵(PNG)だけの時: 部品に分けず、主な色が残っているかだけを見る。"""

    def pic(self, path, body, leaf_r=60):
        im = Image.new("RGB", (600, 600), "white")
        d = ImageDraw.Draw(im)
        d.ellipse((140, 520, 460, 560), fill=(225, 225, 225))     # 床の影(数えない)
        d.ellipse((150, 180, 450, 480), fill=body)
        d.ellipse((300 - leaf_r, 150 - leaf_r // 2, 300 + leaf_r, 150 + leaf_r // 2), fill=(70, 160, 60))
        im.save(path)

    def test_raster_body_color(self):
        with tempfile.TemporaryDirectory(prefix="yc_redo_") as tmp:
            t = Path(tmp)
            self.pic(t / "prev.png", (255, 138, 28))
            self.pic(t / "leaf.png", (255, 138, 28), leaf_r=110)
            self.pic(t / "body.png", (247, 211, 106), leaf_r=110)
            self.assertTrue(rc.compare_raster(t / "prev.png", t / "leaf.png", "葉っぱを大きく")["ok"])
            res = rc.compare_raster(t / "prev.png", t / "body.png", "葉っぱを大きく")
            self.assertFalse(res["ok"])
            self.assertIn("だいだい", res["beyond"][0]["text"])
            self.assertTrue(rc.compare_raster(t / "prev.png", t / "body.png", "", ["色が違う"])["ok"])


if __name__ == "__main__":
    unittest.main()
