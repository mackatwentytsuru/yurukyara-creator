"""to_2d.py が、よその SVG(動く物・外への参照つき)を安全に扱う試験。
- 消毒(clean_svg・load): script・foreignObject・meta refresh・on… の属性・外への href と url(...)・外を読む style を落とす。形(部品)は残る。
- 測る(measure): 開く HTML に CSP と nonce が付き、script は nonce つきの 1 本だけ。消毒前の物は渡らない。
- 本物の Chrome: 外へ読みに行く script・画像・meta refresh のある絵を測っても、受け手(ポート 9490〜9499)に何も届かない。
"""
import sys
import tempfile
import threading
import unittest
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

REVIEW = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REVIEW))
import to_2d  # noqa: E402

NS = "http://www.w3.org/2000/svg"
XL = "http://www.w3.org/1999/xlink"


def hostile_svg(port=9490):
    base = f"http://127.0.0.1:{port}"
    return f"""<svg xmlns="{NS}" xmlns:xlink="{XL}" viewBox="0 0 400 400" width="400" height="400" onload="fetch('{base}/onload')">
<meta http-equiv="refresh" content="0;url={base}/meta"/>
<script>fetch('{base}/script')</script>
<script href="{base}/ext.js"/>
<style>@import url({base}/css); .a {{ fill: red }}</style>
<foreignObject x="0" y="0" width="10" height="10"><iframe xmlns="http://www.w3.org/1999/xhtml" src="{base}/frame"></iframe></foreignObject>
<g id="char">
<g id="body" onclick="fetch('{base}/click')"><ellipse cx="200" cy="260" rx="100" ry="90" fill="#8a6a4a" style="fill:url({base}/paint)"/></g>
<g id="head"><ellipse cx="200" cy="140" rx="80" ry="80" fill="url(#grad)"/>
  <image x="0" y="0" width="10" height="10" href="{base}/img"/>
  <image x="0" y="0" width="10" height="10" xlink:href="javascript:fetch('{base}/js')"/>
  <a xlink:href="{base}/link"><circle cx="1" cy="1" r="1"/></a>
  <animate attributeName="href" values="{base}/anim"/>
  <use xlink:href="#body"/>
</g>
</g>
<defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
</svg>"""


def names(root):
    return {to_2d.tag(e) for e in root.iter()}


class SanitizeTest(unittest.TestCase):
    def test_hostile_things_are_dropped_and_shapes_stay(self):
        root = ET.fromstring(to_2d.clean_svg(hostile_svg()))
        self.assertFalse(names(root) & {"script", "foreignObject", "meta", "iframe", "animate", "style"}, names(root))
        text = ET.tostring(root, encoding="unicode")
        for bad in ("127.0.0.1", "javascript:", "fetch(", "onload", "onclick", "@import"):
            self.assertNotIn(bad, text, bad)
        # 部品と、同じ絵の中の参照(#grad・#body)は残る
        self.assertTrue({"g", "ellipse", "circle", "linearGradient", "use", "image", "a"} <= names(root))
        self.assertIn("url(#grad)", text)
        self.assertRegex(text, r'href="#body"')

    def test_small_embedded_picture_and_local_style_stay(self):
        svg = (f'<svg xmlns="{NS}" viewBox="0 0 10 10"><style>.a{{fill:red}}</style>'
               '<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>'
               '<image href="data:text/html;base64,PHNjcmlwdD4=" width="1" height="1"/></svg>')
        text = to_2d.clean_svg(svg)
        self.assertIn("data:image/png;base64", text)
        self.assertNotIn("data:text/html", text)
        self.assertIn(".a{fill:red}", text)

    def test_load_returns_clean_tree_and_leaves_the_file_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "d.svg"
            p.write_text(hostile_svg(), encoding="utf-8")
            before = p.read_bytes()
            root, vb, defs, xf, groups = to_2d.load(str(p))
            self.assertEqual(p.read_bytes(), before, "元のファイルは書き換えない")
        self.assertIn("body", groups)
        text = ET.tostring(root, encoding="unicode")
        self.assertNotIn("<script", text)
        self.assertNotIn("127.0.0.1", text)
        self.assertNotIn("onclick", text)


class MeasurePageTest(unittest.TestCase):
    def test_page_has_csp_nonce_and_only_our_script(self):
        seen = {}

        def fake_run(cmd, **kw):
            page = Path(cmd[-1].replace("file:///", "")) if cmd[-1].startswith("file:///") else Path(cmd[-1])
            seen["html"] = page.read_text(encoding="utf-8")
            seen["cmd"] = cmd
            return mock.Mock(stdout='BOX{"body":[0,0,1,1]}XOB', returncode=0)

        with mock.patch.object(to_2d, "find_chrome", return_value="chrome-fake"), mock.patch.object(to_2d.subprocess, "run", fake_run):
            self.assertEqual(to_2d.measure(hostile_svg(), ["body"]), {"body": [0, 0, 1, 1]})
        html = seen["html"]
        self.assertIn("Content-Security-Policy", html)
        self.assertIn("default-src 'none'", html)
        self.assertRegex(html, r"script-src 'nonce-[0-9a-f]{16,}'")
        self.assertNotIn("unsafe-eval", html)
        self.assertEqual(html.count("<script"), 1, "動く script は、測る 1 本だけ")
        nonce = html.split("'nonce-")[1].split("'")[0]
        self.assertIn(f'<script nonce="{nonce}">', html)
        for bad in ("127.0.0.1", "foreignObject", "<meta http-equiv=\"refresh", "onclick", "@import"):
            self.assertNotIn(bad, html, bad)


class Sink(BaseHTTPRequestHandler):
    hits = []

    def do_GET(self):
        Sink.hits.append(self.path)
        self.send_response(200)
        self.send_header("content-type", "text/plain")
        self.end_headers()
        self.wfile.write(b"x")

    do_POST = do_GET

    def log_message(self, *a):
        pass


def open_sink():
    for port in range(9490, 9500):
        try:
            return HTTPServer(("127.0.0.1", port), Sink), port
        except OSError:
            continue
    return None, None


@unittest.skipUnless(to_2d.find_chrome(), "Chrome が無い")
class RealChromeTest(unittest.TestCase):
    def test_nothing_reaches_the_outside(self):
        srv, port = open_sink()
        if not srv:
            self.skipTest("ポート 9490〜9499 が空いていない")
        Sink.hits.clear()
        th = threading.Thread(target=srv.serve_forever, daemon=True)
        th.start()
        try:
            boxes = to_2d.measure(hostile_svg(port), ["body", "head"])
            self.assertEqual(Sink.hits, [], "外へ読みに行った: " + ", ".join(Sink.hits))
            self.assertIn("body", boxes)
            self.assertGreater(boxes["body"][2], 100, "部品の箱は測れている")
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
