"""B4(11/8 第 12 波 b)の作る道の試験: 役目 → 言葉 → 絵 → この子にする → すぐ動く 2D → 3D にもする? → ゆるキャラ変換の絵
(形と しつかんを選ぶ)→ OK → make-character への受け渡し。サーバーが /yuru-next を自分で流す(スマホだけで作る)道も。
Claude を呼ばない(絵とチェックは試験のふり)。リポジトリの characters には何も置かない(YC_REVIEW_WORK の中の _characters)。
"""
import http.client
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

REVIEW = Path(__file__).resolve().parents[1]
ROOT = REVIEW.parents[1]
sys.path.insert(0, str(REVIEW))
import review_state as rs  # noqa: E402
import to_2d  # noqa: E402

WEB = "http://localhost:5173"


class Base(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="yc_b4_")
        os.environ["YC_REVIEW_WORK"] = self.work
        os.environ.pop("YC_CHARACTERS_DIR", None)

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def next(self, *extra):
        p = subprocess.run([sys.executable, str(REVIEW / "yuru_make.py"), "next", "--fake-draw", *extra], cwd=ROOT, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", env=dict(os.environ), timeout=300)
        out = p.stdout
        last = out[out.rfind("\n{") + 1:] if "\n{" in out else out[out.find("{"):]
        try:
            return p.returncode, json.loads(last)
        except json.JSONDecodeError:
            return p.returncode, {"raw": out, "err": p.stderr}

    def decide_ok(self, cid):
        g = rs.load_state(cid)["gates"]["C0"]
        return rs.make_request(cid, {"gate": "C0", "decision": "ok", "ticket": g["ticket"], "seen_hash": rs.current_hash(cid, "C0")}, "pc")

    def chars(self):
        return Path(self.work) / "_characters"


class CreateFlowTest(Base):
    def test_role_2d_convert_handoff(self):
        rec = rs.make_new({"from": "words", "words": "赤い ちょうちんの子", "role": "shop", "place": "ひだまりパン"}, "iphone")
        cid = rec["id"]
        mk = rs.read_json(rs.review_dir(cid) / "make.json")
        self.assertEqual((mk["role"], mk["place"]), ("shop", "ひだまりパン"), "役目と場所の名前を make.json に残す")
        rs.validate(mk, rs.schema("make"))
        code, res = self.next()
        self.assertEqual((code, res.get("did")), (0, "drew"), res)
        brief = (Path(self.work) / cid / "draw" / "r1" / "brief.md").read_text(encoding="utf-8")
        self.assertIn("この子の役目(どこで だれと): お店で、来た人に お店の ことを 案内する", brief, "役目を絵の段へ渡す")
        with self.assertRaises(rs.ReviewError) as e:
            rs.make_convert(cid, {"shape": "atama", "material": "fabric"})
        self.assertEqual(e.exception.reason, "not_ready", "この子にする より前に 3D の形は選べない")

        # この子にする → すぐ動く 2D(数秒)
        self.decide_ok(cid)
        t0 = time.monotonic()
        code, res = self.next()
        self.assertEqual((code, res.get("did")), (0, "claimed_ok"), res)
        self.assertTrue(res["twod"]["ok"], res)
        self.assertLess(time.monotonic() - t0, 60)
        st = rs.load_state(cid)
        self.assertEqual(st["make"]["twod"], "ready")
        rs.validate(st, rs.schema("state"))
        cdir = self.chars() / cid
        cj = json.loads((cdir / "character.json").read_text(encoding="utf-8"))
        self.assertEqual(cj["looks"]["default"], "2d")
        self.assertEqual(cj["looks"]["2d"]["parts"], "2d/parts.json")
        self.assertEqual(cj["role"], "shop")
        spec = json.loads((cdir / "2d" / "parts.json").read_text(encoding="utf-8"))
        self.assertIn("head", spec["parts"])
        self.assertTrue(all(len(spec["face"][k]["box"]) == 4 for k in ("eyes", "mouth")))
        svg = (cdir / "2d" / "body.svg").read_text(encoding="utf-8")
        for gid in ("face.neutral.eyes", "face.neutral.mouth_closed", "face.neutral.mouth_half", "face.neutral.mouth_open", "face.happy.eyes"):
            self.assertIn(f'id="{gid}"', svg)
        self.assertNotIn("<image", svg, "絵を取り込まない(図形だけ)")
        persona = (cdir / "persona.md").read_text(encoding="utf-8")
        self.assertIn("- 役目: お店の案内", persona)
        self.assertNotIn("スタッフに聞いて", persona)
        self.assertFalse((ROOT / "characters" / cid).exists(), "試験の子をリポジトリの characters に置かない")

        # 3D にもする? → 形と しつかん → 変換の絵
        cv = rs.make_convert(cid, {"shape": "maru", "material": "fur"})
        self.assertEqual(cv["round"], 1)
        with self.assertRaises(rs.ReviewError):
            rs.make_convert_ok(cid, {"round": 1})       # まだ描けていない
        code, res = self.next()
        self.assertEqual((code, res.get("did"), res.get("shape"), res.get("material")), (0, "converted_drawn", "maru", "fur"), res)
        cbrief = (Path(self.work) / cid / "convert" / "r1" / "brief.md").read_text(encoding="utf-8")
        self.assertIn("3D 用のゆるキャラ変換", cbrief)
        self.assertIn("まるい胴", cbrief)
        self.assertIn("毛(もこもこ", cbrief)
        self.assertIn("小物を足さない", cbrief)
        self.assertTrue((rs.review_dir(cid) / "convert" / "r1" / "drawing.png").exists(), "画面に出す変換の絵")
        self.assertEqual(rs.load_state(cid)["make"]["convert"]["status"], "drawn")
        with self.assertRaises(rs.ReviewError):
            rs.make_convert_ok(cid, {"round": 2})       # 古い・違う回
        rs.make_convert_ok(cid, {"round": 1})
        code, res = self.next()
        self.assertEqual((code, res.get("did")), (0, "handoff"), res)
        ho = json.loads((Path(self.work) / cid / "convert" / "handoff.json").read_text(encoding="utf-8"))
        self.assertEqual((ho["shape"], ho["material"], ho["role"]), ("maru", "fur", "shop"))
        self.assertTrue(ho["picture"]["svg"].endswith("convert/r1/drawing.svg"))
        cj = json.loads((cdir / "character.json").read_text(encoding="utf-8"))
        self.assertEqual(cj["looks"]["3d"]["material"], "fur", "しつかんを B5M の looks.3d.material に書く")
        self.assertEqual(cj["looks"]["default"], "2d", "3D ができるまでは 2D のまま")
        code, res = self.next()
        self.assertEqual(code, 4, res)

    def test_to_2d_on_a_claude_style_drawing(self):
        """d03_svgkit の形(<g id="char"> に transform、頭と腕と足がある絵)でも、部品がそろう"""
        out = Path(self.work) / "gen"
        out.mkdir()
        r = subprocess.run([sys.executable, str(ROOT / "creator" / "draw" / "gen_mikan.py"), str(out / "drawing.svg"), str(out / "parts.md")],
                           cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        res = to_2d.build(out / "drawing.svg", "mikan_test", "みかん", self.chars(), "home")
        self.assertIn("head", res["parts"])
        spec = json.loads((self.chars() / "mikan_test" / "2d" / "parts.json").read_text(encoding="utf-8"))
        vb = spec["viewBox"]
        for name, p in spec["parts"].items():
            x, y, w, h = p["box"]
            self.assertTrue(vb[0] - 1 <= x and x + w <= vb[0] + vb[2] + 1, f"{name} の箱が絵の範囲の外")

    def test_role_values(self):
        rec = rs.make_new({"from": "words", "words": "まるい子", "role": "evil"}, "pc")
        self.assertEqual(rs.read_json(rs.review_dir(rec["id"]) / "make.json")["role"], "home", "知らない役目は おうち")
        self.assertEqual(to_2d.default_persona("まる").count("おうちで、家族と話す"), 1)


class AutoNextServerTest(Base):
    """スマホだけで作る: 頼みが届いたら、サーバーが /yuru-next を自分で流す(direct。中の絵は試験のふり)"""

    def start(self, *extra):
        self.token = secrets.token_urlsafe(16)
        env = dict(os.environ, YC_REVIEW_TEST="1", YC_REVIEW_TOKEN=self.token)
        self.proc = subprocess.Popen([sys.executable, str(REVIEW / "serve_review.py"), "--make", "--port", "0", "--web", WEB, *extra],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
        out = ""
        while "Ctrl+C" not in out:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("サーバーが起きない: " + out)
            out += line
        self.port = int(out.split("PORT ")[1].split()[0])
        self.out = out

    def tearDown(self):
        if getattr(self, "proc", None):
            self.proc.kill()  # 自分で起こした PID だけ
            self.proc.wait(10)
            self.proc.stdout.close()
        super().tearDown()

    def call(self, method, path, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        h = {"Host": f"127.0.0.1:{self.port}", "Origin": f"http://127.0.0.1:{self.port}", "X-YC-Key": self.token}
        if body is not None:
            h.update({"Content-Type": "application/json", "X-YC": "1"})
        c.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, (json.loads(data) if data[:1] in (b"{", b"[") else data)

    def wait_for(self, pred, sec=120):
        end = time.monotonic() + sec
        while time.monotonic() < end:
            s, st = self.call("GET", "/api/review/state")
            if s == 200 and pred(st):
                return st
            time.sleep(0.5)
        self.fail("待っても進まなかった: " + json.dumps(st, ensure_ascii=False)[:600])

    def test_phone_only_create(self):
        self.start("--auto-next", "direct", "--auto-args=--fake-draw")
        self.assertIn("自分で /yuru-next を流します", self.out)
        s, r = self.call("POST", "/api/review/make", {"from": "words", "words": "みどりの はっぱの子", "role": "home"})
        self.assertEqual(s, 201, r)
        st = self.wait_for(lambda st: (st.get("state") or {}).get("make", {}).get("status") == "drawn")
        self.assertTrue(st["server"]["auto"]["on"])
        cid = st["state"]["id"]
        g = st["state"]["gates"]["C0"]
        s, _ = self.call("POST", "/api/review/decision", {"gate": "C0", "decision": "ok", "ticket": g["ticket"], "seen_hash": rs.current_hash(cid, "C0")})
        self.assertEqual(s, 201)
        self.wait_for(lambda st: st["state"]["make"].get("twod") == "ready")
        s, r = self.call("POST", "/api/review/make/convert", {"shape": "atama", "material": "vinyl"})
        self.assertEqual((s, r.get("round")), (201, 1), r)
        self.wait_for(lambda st: (st["state"]["make"].get("convert") or {}).get("status") == "drawn")
        s, png = self.call("GET", "/api/review/convert/r1/drawing.png")
        self.assertEqual(s, 200)
        self.assertTrue(png.startswith(b"\x89PNG"))
        time.sleep(1.1)   # 書き込みの間は 1 秒(サーバーの決まり)
        s, _ = self.call("POST", "/api/review/make/convert_ok", {"round": 1})
        self.assertEqual(s, 200)
        self.wait_for(lambda st: (Path(self.work) / cid / "convert" / "handoff.json").exists())
        st = self.wait_for(lambda st: not st["server"]["auto"]["busy"])
        self.assertLessEqual(st["server"]["auto"]["runs"], 8, "1 本ずつ、決まった数だけ流す")

    def test_off_and_gate(self):
        self.start("--auto-next", "off")
        s, r = self.call("POST", "/api/review/make", {"from": "words", "words": "あおい くもの子"})
        self.assertEqual(s, 201)
        time.sleep(2)
        s, st = self.call("GET", "/api/review/state")
        self.assertEqual(st["state"]["make"]["status"], "queued", "off の時は流さない(PC で /yuru-next)")
        self.assertIsNone(st["server"]["auto"])
        # 合言葉の無い頼みは、流す係を起こさない(門で止まる)
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("POST", "/api/review/make", body=json.dumps({"from": "words", "words": "x"}),
                  headers={"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/json", "X-YC": "1"})
        self.assertEqual(c.getresponse().status, 401)
        c.close()


if __name__ == "__main__":
    unittest.main()
