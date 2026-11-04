"""試験用の偽の ONVIF サーバー(カメラの代わり)。受けた命令を記録し、認証(PasswordDigest)を本当に検算する。
  python -m ... で単体起動はしない。test_eye_camera.py から使う。"""
from __future__ import annotations

import base64
import hashlib
import re
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

OK = "http://www.w3.org/2003/05/soap-envelope"


def _wrap(inner: str) -> bytes:
    return f'<?xml version="1.0"?><s:Envelope xmlns:s="{OK}" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><s:Body>{inner}</s:Body></s:Envelope>'.encode()


class FakeCamera:
    def __init__(self, user="u", password="p", clock_skew_s=0):
        self.user, self.password, self.clock_skew_s = user, password, clock_skew_s
        self.calls: list[tuple[str, str]] = []  # (命令名, 本文)
        self.auth_failures = 0
        cam = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # 静かに
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
                op = re.search(r"<s:Body>\s*<(?:\w+:)?(\w+)", body).group(1)
                cam.calls.append((op, body))
                if op != "GetSystemDateAndTime" and not cam._auth_ok(body):
                    cam.auth_failures += 1
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(_wrap("<s:Fault><s:Reason><s:Text>Sender not Authorized</s:Text></s:Reason></s:Fault>"))
                    return
                out = cam._reply(op, self.server.server_address[1])
                self.send_response(200)
                self.send_header("Content-Type", "application/soap+xml")
                self.end_headers()
                self.wfile.write(out)

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        self._t = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._t.start()

    def _auth_ok(self, body: str) -> bool:
        m = re.search(r"<Username>(.*?)</Username>.*?<Password[^>]*>(.*?)</Password>.*?<Nonce[^>]*>(.*?)</Nonce>.*?<Created[^>]*>(.*?)</Created>", body, re.S)
        if not m or m.group(1) != self.user:
            return False
        want = base64.b64encode(hashlib.sha1(base64.b64decode(m.group(3)) + m.group(4).encode() + self.password.encode()).digest()).decode()
        if want != m.group(2):
            return False
        created = datetime.strptime(m.group(4), "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=timezone.utc)
        cam_now = datetime.now(timezone.utc).timestamp() + self.clock_skew_s
        return abs(cam_now - created.timestamp()) < 300  # 5 分以上ずれた時刻は拒む(実機と同じ)

    def _reply(self, op: str, port: int) -> bytes:
        if op == "GetSystemDateAndTime":
            n = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() + self.clock_skew_s, timezone.utc)
            return _wrap(f"<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>{n.hour}</tt:Hour><tt:Minute>{n.minute}</tt:Minute><tt:Second>{n.second}</tt:Second></tt:Time><tt:Date><tt:Year>{n.year}</tt:Year><tt:Month>{n.month}</tt:Month><tt:Day>{n.day}</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>")
        if op == "GetCapabilities":
            # 実機が内側のアドレスを返す場合を真似る(パスだけ使われること)
            return _wrap("<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>http://10.9.9.9:2020/onvif/media_service</tt:XAddr></tt:Media><tt:PTZ><tt:XAddr>http://10.9.9.9:2020/onvif/ptz_service</tt:XAddr></tt:PTZ></tds:Capabilities></tds:GetCapabilitiesResponse>")
        if op == "GetProfiles":
            return _wrap('<trt:GetProfilesResponse><trt:Profiles token="profile_1"/></trt:GetProfilesResponse>')
        if op == "GetStatus":
            return _wrap('<tptz:GetStatusResponse><tptz:PTZStatus><tt:Position><tt:PanTilt x="0.25" y="-0.1"/></tt:Position></tptz:PTZStatus></tptz:GetStatusResponse>')
        return _wrap(f"<tptz:{op}Response/>")

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
