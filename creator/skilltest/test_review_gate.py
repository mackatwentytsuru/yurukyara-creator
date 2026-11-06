"""段の道具が人の確認(契約 K3)を読んで止まるかの試験。stage_run.py を本当に流す(GPU・claude は使わない)。
使い方: python -m unittest creator/skilltest/test_review_gate.py
人の判断は、確認画面のサーバーと同じ関数(review_state.make_request)で作り、claim で受け取る。
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "creator" / "review"))
sys.path.insert(0, str(ROOT / "creator" / "pipeline"))
import review_state as rs  # noqa: E402
import review_gate as RG  # noqa: E402

STAGE_RUN = str(HERE / "stage_run.py")
SVG = str(ROOT / "creator" / "samples" / "robo_元の絵.svg")


class GateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="yc_gate_"))
        self.work = self.tmp / "work"
        self.run_dir = self.tmp / "run"
        self.env = dict(os.environ, YC_REVIEW_WORK=str(self.work))
        self.env.pop(RG.ENV_GATED, None)
        os.environ["YC_REVIEW_WORK"] = str(self.work)

    def tearDown(self):
        os.environ.pop("YC_REVIEW_WORK", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- 道具 ----
    def stage(self, char, n, *extra, cmd=None, upto=None):
        marker = self.tmp / f"ran_{char}_{n}"
        cmd = cmd or [sys.executable, "-c", f"open(r'{marker}', 'w').write('x')"]
        args = [sys.executable, STAGE_RUN, "tool", "--run", str(self.run_dir), "--char", char, "--stage", str(n),
                "--name", f"s{n}", *extra]
        if upto is not None:
            args += ["--upto", str(upto)]
        p = subprocess.run(args + ["--", *cmd], cwd=str(ROOT), env=self.env, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        return p.returncode, marker.exists(), p.stdout + p.stderr

    def rows(self):
        f = self.run_dir / "run.jsonl"
        return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()] if f.exists() else []

    def human(self, cid, gate, decision, note=None, tags=()):
        st = rs.load_state(cid)
        g = st["gates"][gate]
        rs.make_request(cid, {"gate": gate, "ticket": g["ticket"], "decision": decision, "seen_hash": g["bundle_hash"],
                              "note": note, "tags": list(tags), "focus": None}, "pc")
        code, out = rs.claim(cid)
        self.assertEqual(code, 0, out)

    def c0_ok(self, cid):
        rs.init(cid, name="試し", words="まるい子")
        rs.publish(cid, "C0", SVG)
        self.human(cid, "C0", "ok")

    def record(self, cid, n):
        p = rs.stage_record_path(cid, n)
        return rs.read_json(p) if p.exists() else None

    # ---- 試験 ----
    def test_no_state_runs_without_looking(self):
        rc, ran, out = self.stage("g0", 1)
        self.assertEqual(rc, 0, out)
        self.assertTrue(ran)
        self.assertEqual(self.rows()[-1]["review"], "none")

    def test_stage1_stops_before_human_ok(self):
        rs.init("g1", name="試し")
        rc, ran, out = self.stage("g1", 1)
        self.assertEqual(rc, RG.EXIT_CLOSED, out)
        self.assertFalse(ran, "止めたのに道具が流れた")
        self.assertEqual(self.rows(), [], "止めた段を run.jsonl に書いた")
        self.assertIn("止めた", out)

    def test_ok_opens_next_and_ungated_stage_becomes_auto(self):
        self.c0_ok("g2")
        rc, ran, out = self.stage("g2", 1)
        self.assertEqual(rc, 0, out)
        self.assertTrue(ran)
        self.assertEqual(self.record("g2", 1)["decision"], "auto")
        self.assertEqual(self.rows()[-1]["review"], "on")
        self.assertEqual(rs.can_start("g2", 2)[0], True)

    def test_range_over_a_gate_is_refused(self):
        self.c0_ok("g3")
        rc, ran, out = self.stage("g3", 1, upto=3)
        self.assertEqual(rc, RG.EXIT_CLOSED, out)
        self.assertFalse(ran)
        self.assertIn("門 C2", out)

    def test_gated_last_stage_waits_for_human(self):
        self.c0_ok("g4")
        rc, ran, out = self.stage("g4", 1, upto=2)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.record("g4", 1)["decision"], "auto")
        self.assertIsNone(self.record("g4", 2), "門の段に auto の記録を書いた")
        self.assertIn("publish", out)
        rc, ran, out = self.stage("g4", 3)
        self.assertEqual(rc, RG.EXIT_CLOSED, out)
        self.assertFalse(ran)

    def test_publish_after_gated_stage(self):
        self.c0_ok("g5")
        rc, ran, out = self.stage("g5", 1, "--publish-right", SVG, upto=2)
        self.assertEqual(rc, 0, out)
        st = rs.load_state("g5")
        self.assertEqual(st["gates"]["C2"]["status"], "waiting")
        self.human("g5", "C2", "ok")
        rc, ran, out = self.stage("g5", 3)
        self.assertEqual(rc, 0, out)
        self.assertTrue(ran)

    def test_redo_blocks_next_stage(self):
        rs.init("g6", name="試し")
        rs.publish("g6", "C0", SVG)
        self.human("g6", "C0", "redo", note="目を大きく")
        rc, ran, out = self.stage("g6", 1)
        self.assertEqual(rc, RG.EXIT_CLOSED, out)
        self.assertFalse(ran)
        self.assertIn("やり直し", out)

    def test_failed_tool_marks_failed_and_writes_no_record(self):
        self.c0_ok("g7")
        rc, ran, out = self.stage("g7", 1, cmd=[sys.executable, "-c", "import sys; sys.exit(3)"])
        self.assertEqual(rc, 3, out)
        self.assertIsNone(self.record("g7", 1))
        self.assertEqual(rs.load_state("g7")["stages"][1]["status"], "failed")

    def test_review_off_runs_and_says_so(self):
        rs.init("g8", name="試し")
        rc, ran, out = self.stage("g8", 1, "--review", "off")
        self.assertEqual(rc, 0, out)
        self.assertTrue(ran)
        self.assertEqual(self.rows()[-1]["review"], "off")

    def test_review_on_needs_state(self):
        rc, ran, out = self.stage("g9", 1, "--review", "on")
        self.assertEqual(rc, RG.EXIT_CLOSED, out)
        self.assertFalse(ran)

    def test_talk_tool_stops_without_stage6_ok(self):
        """段 7 の道具(t07_talk.py)を単独で呼んでも、段 6 の OK が無ければ取り付けの前に止まる。"""
        rs.init("g10", name="試し")
        p = subprocess.run([sys.executable, str(ROOT / "creator" / "pipeline" / "t07_talk.py"), str(self.tmp / "no_pack"), "g10",
                            "--name", "試し", "--out", str(self.tmp / "talk")], cwd=str(ROOT), env=self.env,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        self.assertEqual(p.returncode, RG.EXIT_CLOSED, p.stdout + p.stderr)
        self.assertFalse((ROOT / "characters" / "g10").exists(), "止めたのに取り付けた")


if __name__ == "__main__":
    unittest.main()
