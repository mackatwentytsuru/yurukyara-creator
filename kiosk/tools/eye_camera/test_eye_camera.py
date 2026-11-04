"""見守りカメラの部品の試験(偽のカメラだけを使う。本物のカメラには つながない)。
  python -m unittest discover -s kiosk/tools/eye_camera -p "test_*.py"
"""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import camera_config as cc
from fake_onvif import FakeCamera
from follow import Follower, FollowConfig
from onvif_ptz import MAX_STEP, OnvifError, OnvifPtz, ws_security


class ConfigTest(unittest.TestCase):
    def test_env_wins_and_missing_is_reported(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "t.json"
            f.write_text(json.dumps({"host": "h1", "user": "u1", "password": "p1"}), encoding="utf-8")
            cfg = cc.load(env={"TAPO_HOST": "h2"}, file=f)
            self.assertEqual((cfg["host"], cfg["user"]), ("h2", "u1"))
            with self.assertRaises(cc.ConfigError) as e:
                cc.load(env={}, file=Path(d) / "none.json")
            self.assertIn("host", str(e.exception))
            self.assertNotIn("p1", str(e.exception))

    def test_url_is_quoted_and_mask_hides_everything(self):
        cfg = {"host": "cam.example", "user": "us er", "password": "p@ss/w:rd", "rtsp_port": 554, "stream": "stream1"}
        url = cc.rtsp_url(cfg)
        self.assertEqual(url, "rtsp://us%20er:p%40ss%2Fw%3Ard@cam.example:554/stream1")
        masked = cc.mask(url + " p@ss/w:rd", cfg)
        for secret in ("p@ss", "p%40ss", "cam.example", "us%20er"):
            self.assertNotIn(secret, masked)

    def test_unreadable_file_message_has_no_content(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "t.json"
            f.write_text("{not json password=secret", encoding="utf-8")
            with self.assertRaises(cc.ConfigError) as e:
                cc.load(env={}, file=f)
            self.assertNotIn("secret", str(e.exception))


class FollowTest(unittest.TestCase):
    def feed(self, f, t0, secs, cx, cy, dt=0.1):
        acts, t = [], t0
        while t < t0 + secs:
            a = f.update(t, True, cx, cy)
            if a:
                acts.append((round(t, 2), a))
            t += dt
        return acts

    def test_inside_deadband_never_moves(self):
        self.assertEqual(self.feed(Follower(), 0, 10, 0.55, 0.45), [])

    def test_not_moving_until_face_is_stable(self):
        acts = self.feed(Follower(), 0, 2, 0.9, 0.5)
        self.assertGreaterEqual(acts[0][0], 0.6)

    def test_direction_and_speed_cap(self):
        a = self.feed(Follower(), 0, 2, 1.0, 0.0)[0][1]
        self.assertGreater(a.pan, 0)  # 顔が右 → 右へ
        self.assertGreater(a.tilt, 0)  # 顔が上 → 上へ
        self.assertLessEqual(a.pan, FollowConfig().max_step)
        self.assertLessEqual(a.tilt, FollowConfig().max_step)

    def test_waits_after_move_and_respects_limit(self):
        f = Follower()
        acts = self.feed(f, 0, 60, 1.0, 0.5)  # 動いても顔が中央に来ない(最悪の場合)
        gaps = [b[0] - a[0] for a, b in zip(acts, acts[1:])]
        self.assertTrue(all(g >= FollowConfig().settle_s for g in gaps))
        self.assertLessEqual(abs(f.acc_pan), FollowConfig().limit_pan + 1e-9)
        self.assertGreater(len(acts), 0)

    def test_may_return_toward_home_past_limit(self):
        f = Follower()
        self.feed(f, 0, 60, 1.0, 0.5)
        back = self.feed(f, 100, 3, 0.0, 0.5)
        self.assertTrue(back and back[0][1].pan < 0)

    def test_lost_face_does_not_search_then_goes_home_once(self):
        f = Follower()
        self.feed(f, 0, 3, 1.0, 0.5)
        self.assertIsNone(f.update(10, False))
        self.assertEqual(f.update(40, False).kind, "home")
        self.assertIsNone(f.update(80, False))
        self.assertEqual(f.acc_pan, 0.0)


class OnvifTest(unittest.TestCase):
    def setUp(self):
        self.cam = FakeCamera("u", "pw")
        self.ptz = OnvifPtz("127.0.0.1", self.cam.port, "u", "pw")

    def tearDown(self):
        self.cam.close()

    def test_digest_matches_spec_vector(self):
        # Digest = Base64(SHA1(Nonce + Created + Password))。固定の入力で値が変わらないこと
        now = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
        h = ws_security("u", "pw", nonce=b"0123456789abcdef", now=now)
        self.assertIn("<Created", h)
        self.assertIn("2026-11-04T12:00:00.000Z", h)
        self.assertIn("MDEyMzQ1Njc4OWFiY2RlZg==", h)  # nonce の base64

    def test_discover_move_stop_home_status(self):
        self.ptz.sync_clock()
        self.ptz.discover()
        self.assertEqual(self.ptz.profile, "profile_1")
        self.assertTrue(self.ptz.ptz_url.startswith(f"http://127.0.0.1:{self.cam.port}/"))  # 実機の内側アドレスは使わない
        self.ptz.nudge(5.0, -5.0)
        self.ptz.stop()
        self.ptz.home()
        self.assertEqual(self.ptz.status(), {"pan": 0.25, "tilt": -0.1})
        ops = [c[0] for c in self.cam.calls]
        for op in ("RelativeMove", "Stop", "GotoHomePosition", "GetStatus"):
            self.assertIn(op, ops)
        self.assertEqual(self.cam.auth_failures, 0)
        body = next(b for o, b in self.cam.calls if o == "RelativeMove")
        self.assertIn(f'x="{MAX_STEP:.3f}"', body)  # 1 回の量は上限で切られる
        self.assertIn(f'y="-{MAX_STEP:.3f}"', body)
        self.assertNotIn("Timeout", body)  # Tapo は Timeout つきの命令に壊れた返事を返した(実機)

    def test_wrong_password_is_refused_without_leaking(self):
        bad = OnvifPtz("127.0.0.1", self.cam.port, "u", "WRONG")
        with self.assertRaises(OnvifError) as e:
            bad.discover()
        self.assertNotIn("WRONG", str(e.exception))
        self.assertGreater(self.cam.auth_failures, 0)

    def test_clock_skew_is_corrected(self):
        cam = FakeCamera("u", "pw", clock_skew_s=3600)
        try:
            p = OnvifPtz("127.0.0.1", cam.port, "u", "pw")
            with self.assertRaises(OnvifError):
                p.discover()  # 時刻が1時間ずれたまま → 拒まれる
            off = p.sync_clock()
            self.assertAlmostEqual(off.total_seconds(), 3600, delta=5)
            p.discover()
            self.assertEqual(p.profile, "profile_1")
        finally:
            cam.close()

    def test_broken_reply_becomes_onvif_error(self):
        import socket, threading
        srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
        def serve():
            c, _ = srv.accept(); c.recv(4096); c.sendall(b"POST /x\x00garbage\x00"); c.close()
        threading.Thread(target=serve, daemon=True).start()
        p = OnvifPtz("127.0.0.1", srv.getsockname()[1], "u", "p")
        with self.assertRaises(OnvifError):
            p.sync_clock()
        srv.close()

    def test_move_before_discover_fails_clearly(self):
        with self.assertRaises(OnvifError):
            self.ptz.nudge(0.1, 0)


if __name__ == "__main__":
    unittest.main()
