"""ONVIF の首振り(PTZ)の最小のクライアント。標準ライブラリだけ。WS-Security の UsernameToken(PasswordDigest)で認証する。
動かすのは ContinuousMove だけ。**必ず Timeout を付け、速度を上限で切り、Stop を送れる**(カメラが勝手に動き続けないように)。
Tapo C200 は ONVIF Profile S(ポート 2020)。メーカーの説明では、操作できる範囲は機種と相手ソフトによって違うので、実機で確かめるまで「動く」とは言わない。
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

NS = {
    "s": "http://www.w3.org/2003/05/soap-envelope",
    "tds": "http://www.onvif.org/ver10/device/wsdl",
    "trt": "http://www.onvif.org/ver10/media/wsdl",
    "tptz": "http://www.onvif.org/ver20/ptz/wsdl",
    "tt": "http://www.onvif.org/ver10/schema",
}
MAX_SPEED = 0.3  # -1〜1 の速度の上限(これより速くは送らない)
MAX_TIMEOUT_S = 1.0  # 1 回の動きの最長(これを超えて動き続けさせない)


class OnvifError(RuntimeError):
    pass


def ws_security(user: str, password: str, offset: timedelta = timedelta(0), nonce: bytes | None = None, now: datetime | None = None) -> str:
    """UsernameToken(PasswordDigest) の Security ヘッダー。Digest = Base64(SHA1(Nonce + Created + Password))"""
    nonce = nonce if nonce is not None else os.urandom(16)
    created = ((now or datetime.now(timezone.utc)) + offset).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode()).digest()).decode()
    return (
        '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">'
        "<UsernameToken>"
        f"<Username>{_esc(user)}</Username>"
        '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">' + digest + "</Password>"
        '<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' + base64.b64encode(nonce).decode() + "</Nonce>"
        '<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' + created + "</Created>"
        "</UsernameToken></Security>"
    )


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def envelope(body: str, header: str = "") -> bytes:
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" '
        'xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">'
        f"<s:Header>{header}</s:Header><s:Body>{body}</s:Body></s:Envelope>"
    ).encode()


def clamp_speed(v: float) -> float:
    return max(-MAX_SPEED, min(MAX_SPEED, float(v)))


class OnvifPtz:
    def __init__(self, host: str, port: int, user: str, password: str, timeout: float = 5.0):
        self.base = f"http://{host}:{port}"
        self.user, self.password, self.timeout = user, password, timeout
        self.offset = timedelta(0)
        self.ptz_url = f"{self.base}/onvif/ptz_service"
        self.media_url = f"{self.base}/onvif/media_service"
        self.profile = None

    def _call(self, url: str, body: str, auth: bool = True) -> ET.Element:
        header = ws_security(self.user, self.password, self.offset) if auth else ""
        req = urllib.request.Request(url, data=envelope(body, header), headers={"Content-Type": "application/soap+xml; charset=utf-8"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                xml = r.read()
        except urllib.error.HTTPError as e:
            raise OnvifError(f"ONVIF が {e.code} を返しました(カメラのアカウント・時刻のずれを確かめてください)") from None
        except OSError as e:
            raise OnvifError(f"ONVIF につながりません({type(e).__name__})") from None
        root = ET.fromstring(xml)
        fault = root.find(".//s:Fault", NS)
        if fault is not None:
            reason = "".join(fault.itertext()).strip()[:120]
            raise OnvifError(f"ONVIF の拒否: {reason}")
        return root

    def sync_clock(self) -> timedelta:
        """カメラの時計とのずれ(認証の時刻が合わないと拒まれるため)。認証なしで読める"""
        root = self._call(f"{self.base}/onvif/device_service", "<tds:GetSystemDateAndTime/>", auth=False)
        dt = root.find(".//tt:UTCDateTime", NS)
        if dt is None:
            return self.offset
        g = lambda path: int(dt.find(path, NS).text)  # noqa: E731
        cam = datetime(g("tt:Date/tt:Year"), g("tt:Date/tt:Month"), g("tt:Date/tt:Day"), g("tt:Time/tt:Hour"), g("tt:Time/tt:Minute"), g("tt:Time/tt:Second"), tzinfo=timezone.utc)
        self.offset = cam - datetime.now(timezone.utc)
        return self.offset

    def discover(self) -> None:
        """サービスの場所と、使う設定(プロファイル)の名前を読む"""
        root = self._call(f"{self.base}/onvif/device_service", "<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>")
        for tag, attr in (("PTZ", "ptz_url"), ("Media", "media_url")):
            x = root.find(f".//tt:{tag}/tt:XAddr", NS)
            if x is not None and x.text:
                # カメラが自分の内側のアドレスを返すことがあるので、パスだけ使って、つないでいる相手に向ける
                setattr(self, attr, self.base + re.sub(r"^https?://[^/]+", "", x.text.strip()))
        prof = self._call(self.media_url, "<trt:GetProfiles/>").find(".//trt:Profiles", NS)
        if prof is None or not prof.get("token"):
            raise OnvifError("ONVIF の設定(プロファイル)が見つかりません")
        self.profile = prof.get("token")

    def _need_profile(self):
        if not self.profile:
            raise OnvifError("先に discover() を呼んでください")

    def move(self, pan: float, tilt: float, duration_s: float) -> None:
        """首を pan/tilt の速度(-1〜1 を上限で切る)で duration_s 秒だけ動かす。Timeout をカメラにも渡す"""
        self._need_profile()
        d = max(0.05, min(MAX_TIMEOUT_S, float(duration_s)))
        self._call(
            self.ptz_url,
            f"<tptz:ContinuousMove><tptz:ProfileToken>{_esc(self.profile)}</tptz:ProfileToken>"
            f'<tptz:Velocity><tt:PanTilt x="{clamp_speed(pan):.3f}" y="{clamp_speed(tilt):.3f}"/></tptz:Velocity>'
            f"<tptz:Timeout>PT{d:.2f}S</tptz:Timeout></tptz:ContinuousMove>",
        )

    def stop(self) -> None:
        self._need_profile()
        self._call(self.ptz_url, f"<tptz:Stop><tptz:ProfileToken>{_esc(self.profile)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>")

    def home(self) -> None:
        self._need_profile()
        self._call(self.ptz_url, f"<tptz:GotoHomePosition><tptz:ProfileToken>{_esc(self.profile)}</tptz:ProfileToken></tptz:GotoHomePosition>")

    def status(self) -> dict:
        """いまの位置(カメラの正規化した値。角度ではない)。出ない機種もある"""
        self._need_profile()
        root = self._call(self.ptz_url, f"<tptz:GetStatus><tptz:ProfileToken>{_esc(self.profile)}</tptz:ProfileToken></tptz:GetStatus>")
        pt = root.find(".//tt:Position/tt:PanTilt", NS)
        return {"pan": float(pt.get("x")), "tilt": float(pt.get("y"))} if pt is not None else {}
