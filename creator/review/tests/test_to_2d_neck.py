"""to_2d.py の「頭と体のつなぎ目」の試験(11/8: 描かれた絵で頭が体の上にういていた)。
- plan_neck は計算だけ(Chrome を使わない)。
- 最後の 1 本だけ、すき間のある絵を本当に 2D にして、頭の下のふちが体の上のふちより下に来て、
  accessory(かんむり)が頭の部品に入ることを、できた SVG と parts.json で確かめる(ヘッドレスの Chrome。GPU は使わない)。
"""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

REVIEW = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REVIEW))
import to_2d  # noqa: E402

NS = "http://www.w3.org/2000/svg"
# 頭(中心 430・縦半径 220 → 下のふち 650)と体(中心 860・縦半径 170 → 上のふち 690): 40 のすき間がある絵(本人の試験で出た形)
GAP_SVG = f"""<svg xmlns="{NS}" viewBox="0 0 1254 1254" width="1254" height="1254">
<rect x="0" y="0" width="1254" height="1254" fill="#ffffff"/>
<g id="char">
<g id="shadow"><ellipse cx="627" cy="1110" rx="260" ry="36" fill="#e6e6e6"/></g>
<g id="body"><ellipse cx="627" cy="860" rx="210" ry="170" fill="#8a6a4a" stroke="#3a2a1a" stroke-width="10"/></g>
<g id="head"><ellipse cx="627" cy="430" rx="190" ry="220" fill="#c9a77a" stroke="#3a2a1a" stroke-width="10"/></g>
<g id="eye_L"><circle cx="560" cy="420" r="30" fill="#111111"/></g>
<g id="eye_R"><circle cx="694" cy="420" r="30" fill="#111111"/></g>
<g id="mouth"><path d="M 580 510 Q 627 555 674 510" fill="none" stroke="#3a2a1a" stroke-width="8"/></g>
<g id="accessory"><path d="M 470 270 L 470 130 L 784 130 L 784 270 Z" fill="#ffd21f" stroke="#3a2a1a" stroke-width="10"/></g>
</g>
</svg>"""


class PlanNeckTest(unittest.TestCase):
    def test_gap_moves_head_down_until_overlap(self):
        head = [437, 210, 380, 440]
        body = [417, 690, 420, 340]
        r = to_2d.plan_neck(head, body)
        need = to_2d.NECK_OVERLAP * 340
        self.assertAlmostEqual(r["overlap"], need, delta=0.2)
        self.assertAlmostEqual(r["dy"], (690 - 650) + need, delta=0.2, msg="すき間 40 + 重なりの下限")
        self.assertGreater(r["dy"], 0)

    def test_enough_overlap_is_left_alone(self):
        r = to_2d.plan_neck([281, 100, 600, 640], [417, 640, 420, 440])  # 重なり 100。体の高さの 18% は 79
        self.assertEqual(r["dy"], 0.0)
        self.assertEqual(r["overlap"], 100.0)

    def test_small_overlap_is_topped_up(self):
        r = to_2d.plan_neck([300, 100, 600, 600], [400, 690, 420, 340])  # 重なり 10 → 下限(61.2)まで
        self.assertAlmostEqual(r["dy"], 61.2 - 10, delta=0.2)

    def test_small_picture_uses_the_minimum(self):
        r = to_2d.plan_neck([0, 0, 40, 40], [0, 60, 40, 40])
        self.assertAlmostEqual(r["overlap"], to_2d.NECK_OVERLAP_MIN, delta=0.1)

    def test_side_by_side_or_upside_down_is_not_touched(self):
        self.assertEqual(to_2d.plan_neck([0, 0, 100, 100], [900, 200, 100, 100])["dy"], 0.0, "横に並ぶ絵は、つなぎ直さない")
        self.assertEqual(to_2d.plan_neck([400, 700, 300, 300], [400, 100, 300, 300])["dy"], 0.0, "頭が体より下の絵は、つなぎ直さない")
        self.assertEqual(to_2d.plan_neck(None, [0, 0, 10, 10])["dy"], 0.0)
        self.assertEqual(to_2d.plan_neck([0, 0, 0, 0], [0, 0, 10, 10])["dy"], 0.0)

    def test_accessory_goes_to_head_only_when_it_sits_on_the_head(self):
        head = [437, 210, 380, 440]
        self.assertTrue(to_2d.plan_neck(head, [417, 690, 420, 340], [470, 110, 314, 180])["accessory_on_head"], "かんむりは頭の物")
        self.assertTrue(to_2d.plan_neck(head, None, [500, 380, 250, 60])["accessory_on_head"], "めがねは頭の物")
        self.assertFalse(to_2d.plan_neck(head, [417, 690, 420, 340], [520, 700, 200, 80])["accessory_on_head"], "マフラー・ネクタイは体の物")
        self.assertFalse(to_2d.plan_neck(head, [417, 690, 420, 340], [0, 0, 0, 0])["accessory_on_head"], "空の accessory は動かさない")
        self.assertFalse(to_2d.plan_neck(head, [417, 690, 420, 340])["accessory_on_head"])


class GapDrawingTest(unittest.TestCase):
    def test_gap_drawing_becomes_connected_2d(self):
        with tempfile.TemporaryDirectory(prefix="yc_neck_") as tmp:
            svg = Path(tmp) / "gap.svg"
            svg.write_text(GAP_SVG, encoding="utf-8")
            r = to_2d.build(str(svg), "neck_test", "つなぎ", tmp)
            self.assertGreater(r["neck"]["headDown"], 40, "すき間(40)より多く下げた")
            self.assertTrue(r["neck"]["accessoryOnHead"])
            spec = json.loads((Path(tmp) / "neck_test" / "2d" / "parts.json").read_text(encoding="utf-8"))
            head, body = spec["parts"]["head"]["box"], spec["parts"]["body"]["box"]
            # 体の箱は、かんむりを持たなくなったので、体の絵の上のふち(690 - 線)から始まる
            self.assertGreater(body[1], 600, "かんむりは体の部品から外れた")
            # 頭の下のふち(箱。余白 12)が、体の上のふちより下にある = つながった
            self.assertGreater(head[1] + head[3] - 12, body[1] + 12 + 20, "頭が体にかぶさっている")
            self.assertGreater(spec["headLiftMax"], 0)
            body_svg = (Path(tmp) / "neck_test" / "2d" / "body.svg").read_text(encoding="utf-8")
            # 顔(目)も同じだけ下がった: 元の目の中心 y=420 + 下げた量
            m = re.search(r'id="face\.neutral\.eyes"><g transform="translate\(0 ([0-9.]+)\)"', body_svg)
            self.assertIsNotNone(m, "顔の部品も頭と一緒に下げる")
            self.assertAlmostEqual(float(m.group(1)), r["neck"]["headDown"], delta=0.1)


if __name__ == "__main__":
    unittest.main()
