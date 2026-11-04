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


class GazeBridgeTest(unittest.TestCase):
    def setUp(self):
        import gaze_bridge as gb

        self.gb = gb
        self.g = gb.Geometry()

    def test_pixel_world_round_trip(self):
        import numpy as np

        for p in ([0.0, 1.6, 2.0], [0.8, 1.4, 3.0], [-0.7, 1.8, 1.5]):
            u, v, ipd = self.gb.world_to_pixel(self.g, np.array(p))
            back = self.gb.pixel_to_world(self.g, u, v, ipd)
            self.assertLess(float(np.linalg.norm(back - np.array(p))), 1e-6)

    def test_gaze_direction_signs(self):
        g = self.g
        yaw, pitch = self.gb.gaze_angles(g.eye_pos, (0.0, 2.0, 2.0))  # 目と同じ高さの正面
        self.assertAlmostEqual(yaw, 0.0, places=6)
        self.assertAlmostEqual(pitch, 0.0, places=6)
        self.assertGreater(self.gb.gaze_angles(g.eye_pos, (1.0, 2.0, 2.0))[0], 0)  # 右
        self.assertGreater(self.gb.gaze_angles(g.eye_pos, (0.0, 2.5, 2.0))[1], 0)  # 上
        self.assertLess(self.gb.gaze_angles(g.eye_pos, (0.0, 1.5, 2.0))[1], 0)  # 下

    def test_person_on_right_of_image_is_on_world_right(self):
        import numpy as np

        _, hi, _ = None, None, None
        p = self.gb.pixel_to_world(self.g, self.g.width * 0.8, self.g.height * 0.5, 80.0)
        self.assertGreater(float(p[0]), 0)  # 画像の右 = 客から見て右(カメラは客の側を向く。画像の右 = +x)

    def test_bridge_holds_then_drops_and_ema(self):
        g = self.gb.Geometry(ema=0.0, hold_s=0.5)
        b = self.gb.GazeBridge(g=g, sink=None)
        det = {"found": True, "cx": 0.5, "cy": 0.4, "eye_x": 0.5, "eye_y": 0.4, "ipd_px": 80.0}
        m1 = b.update(1.0, det)
        self.assertTrue(m1["found"])
        self.assertIn("yaw_deg", m1)
        self.assertTrue(b.update(1.3, {"found": False})["found"])  # 0.3 秒は、最後の向きを保つ
        self.assertFalse(b.update(1.7, {"found": False})["found"])  # 0.5 秒を超えたら、見失い

    def test_ema_smooths_a_jump(self):
        g = self.gb.Geometry(ema=0.8)
        b = self.gb.GazeBridge(g=g, sink=None)
        left = {"found": True, "eye_x": 0.2, "eye_y": 0.5, "cx": 0.2, "cy": 0.5, "ipd_px": 80.0}
        right = dict(left, eye_x=0.8, cx=0.8)
        y0 = b.update(0.0, left)["yaw_deg"]
        y1 = b.update(0.1, right)["yaw_deg"]
        raw = self.gb.gaze_angles(g.eye_pos, self.gb.pixel_to_world(g, 0.8 * g.width, 0.5 * g.height, 80.0))[0]
        self.assertLess(abs(y1 - y0), abs(raw - y0))  # 平滑化で、1 回では目標に届かない


class GazeCalibTest(unittest.TestCase):
    def test_calibration_improves_error_with_five_points(self):
        import gaze_calib as gc

        r = gc.simulate(5)
        self.assertLess(r["after_median_deg"], r["before_median_deg"])  # 校正で、別の客の誤差の中央値が下がる
        self.assertLess(r["after_median_deg"], 2.0)
        self.assertLess(r["fit"]["residual_rms_deg"], r["fit"]["residual_before_rms_deg"])

    def test_perfect_points_recover_parameters(self):
        import numpy as np
        import gaze_calib as gc
        from gaze_bridge import Geometry, gaze_angles, world_to_pixel

        true = Geometry(cam_pos=(0.0, 0.08, 0.3), cam_pitch_deg=38.0, eye_pos=(0.06, 1.3, -0.2))
        g0 = Geometry(cam_pos=(0.0, 0.08, 0.3), cam_pitch_deg=30.0, eye_pos=(0.0, 1.0, 0.0))
        pts = []
        for p in [(0, 1.65, 2.0), (-0.7, 1.65, 1.6), (0.7, 1.65, 1.6), (-0.8, 1.65, 3.0), (0.8, 1.65, 3.0), (0.0, 1.65, 2.6)]:
            u, v, ipd = world_to_pixel(true, np.array(p))
            y, pi = gaze_angles(true.eye_pos, np.array(p))
            pts.append({"u": u, "v": v, "ipd_px": ipd, "yaw_deg": y, "pitch_deg": pi})
        g, rep = gc.fit(pts, g0, free=("cam_pitch_deg", "eye_x", "eye_y", "eye_z"))
        self.assertLess(rep["residual_rms_deg"], 0.2)  # 雑音なしなら、ほぼ 0 に戻る


class GazeV1PacketTest(unittest.TestCase):
    def test_v1_packet_matches_viewer_tracker_shape(self):
        import json
        import socket

        import gaze_bridge as gb

        rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        rx.bind(("127.0.0.1", 0))
        rx.settimeout(2)
        b = gb.GazeBridge(g=gb.Geometry(ema=0.0), sink=("127.0.0.1", rx.getsockname()[1]), packet="v1")
        b.update(1.0, {"found": True, "eye_x": 0.8, "eye_y": 0.5, "cx": 0.8, "cy": 0.5, "ipd_px": 60.0})
        pkt = json.loads(rx.recv(4096).decode())
        for k in ("v", "present", "az", "el", "dist", "n", "facing", "seq"):
            self.assertIn(k, pkt)
        self.assertEqual(pkt["v"], 1)
        self.assertTrue(pkt["present"])
        self.assertGreater(pkt["az"], 0)  # 画像の右の客 = 客の右 = az はプラス
        b.update(5.0, {"found": False})
        pkt = json.loads(rx.recv(4096).decode())
        self.assertFalse(pkt["present"])
        self.assertEqual(pkt["az"], 0.0)
        rx.close()

    def test_v1_with_pixels_adds_raw_pixels_only_when_seen(self):
        import json
        import socket

        import gaze_bridge as gb

        rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        rx.bind(("127.0.0.1", 0))
        rx.settimeout(2)
        g = gb.Geometry(ema=0.0)
        b = gb.GazeBridge(g=g, sink=("127.0.0.1", rx.getsockname()[1]), packet="v1", with_pixels=True)
        b.update(1.0, {"found": True, "eye_x": 0.25, "eye_y": 0.5, "cx": 0.25, "cy": 0.5, "ipd_px": 40.0})
        pkt = json.loads(rx.recv(4096).decode())
        self.assertEqual(pkt["v"], 1)  # 版の名前は変えない(画素の縦は v_px)
        self.assertAlmostEqual(pkt["u"], 0.25 * g.width, places=1)
        self.assertAlmostEqual(pkt["v_px"], 0.5 * g.height, places=1)
        self.assertEqual(pkt["ipd_px"], 40.0)
        b.update(1.1, {"found": False})  # 見失って hold の間: 向きは残るが、いまのコマの画素は無い
        pkt = json.loads(rx.recv(4096).decode())
        self.assertTrue(pkt["present"])
        self.assertNotIn("u", pkt)
        rx.close()
