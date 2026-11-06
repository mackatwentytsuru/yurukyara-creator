"""grow_strip.py(作例が段 ⓪〜③ で育つ帯)の試験。GPU も claude も使わない(数秒)。

使い方: python -m unittest creator/skilltest/test_grow_strip.py
"""
import os
import sys
import unittest

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grow_strip as G  # noqa: E402

IDS = ("yokoso", "robo", "d_lantern", "f_led", "mikan")


def load(cid):
    drawing = Image.open(os.path.join(G.REPO, "creator", "samples", f"{cid}_元の絵.png")).convert("RGB")
    d, consts, colors = G.read_builder(os.path.join(G.REPO, "creator", "builders", f"{cid}.py"))
    return drawing, d, consts, colors


def center(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


class GrowStripTest(unittest.TestCase):
    def test_reads_builders_without_running_them(self):
        for cid in IDS:
            _, d, consts, colors = load(cid)
            self.assertGreater(len(d), 5, cid)
            self.assertIn("CX", consts, cid)
            self.assertTrue(colors, cid)
            self.assertTrue(all(G.is_rgb(c) for _, c in colors), cid)

    def test_every_drawn_shape_sits_on_the_drawing(self):
        for cid in IDS:
            drawing, d, consts, _ = load(cid)
            mask = G.fg_mask(drawing)
            shapes = G.shapes_from_d(d, consts["CX"], mask)
            self.assertGreaterEqual(len(shapes), 5, cid)
            for pts, closed in shapes:
                self.assertGreaterEqual(G.on_drawing(mask, pts, closed), G.FIT_MIN, cid)

    def test_offsets_from_the_center_line_are_read_as_offsets(self):
        # パネルくんの脚は「真ん中からの距離」で書いてある(leg_c=(190, 937))。左右の脚の上に描く
        drawing, d, consts, _ = load("f_led")
        shapes = G.shapes_from_d(d, consts["CX"], G.fg_mask(drawing))
        legs = [center(p) for p, _ in shapes if abs(center(p)[1] - 937) < 5]
        xs = sorted(round(x) for x, _ in legs)
        self.assertEqual(xs, [437, 817])

    def test_misread_items_are_dropped(self):
        drawing, d, consts, _ = load("yokoso")
        mask = G.fg_mask(drawing)
        bad = {"ghost_c": (40, 40), "ghost_r": (30, 30)}  # 絵の外(左上の白い所)
        self.assertEqual(G.shapes_from_d(bad, consts["CX"], mask), [])

    def test_mouth_is_a_curve_with_b_as_control_point(self):
        pts = G.bezier_pts((0, 0), (10, 20), (20, 0), n=2)
        self.assertEqual(pts[1], (10.0, 10.0))

    def test_strip_is_full_hd_with_and_without_text(self):
        drawing, d, consts, colors = load("mikan")
        look = G.look_panel(drawing, G.shapes_from_d(d, consts["CX"], G.fg_mask(drawing)))
        for labels in (True, False):
            im = G.compose(["みかんちゃん: 言葉から 3D へ"], [drawing, look, drawing, drawing], colors, labels)
            self.assertEqual(im.size, (G.W, G.H))


if __name__ == "__main__":
    unittest.main()
