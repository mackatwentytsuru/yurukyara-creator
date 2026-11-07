"""スマホの確認画面(C0 絵・C2 形)を配り、人の OK・やり直しを request.json に書く、小さなサーバー。

使い方: python creator/review/serve_review.py <id> [--port 8796] [--lan | --bind <アドレス>] [--hours 8]
        python creator/review/serve_review.py --make [--web http://localhost:5173] [--allow-origin <元>…] [--port 8796]
- 既定は 127.0.0.1 だけで待つ。--lan は外へ出る道のアドレス、--bind は決めたアドレス(0.0.0.0 にはしない)。
  --lan・--bind の時も、この PC の QR の画面のため、同じ番号で 127.0.0.1 にも待つ(127.0.0.1 からは読むにも合言葉が要る)。
- 合言葉は起動のたびに作り、画面にも記録にも出さない。この PC のブラウザで http://127.0.0.1:<番号>/qr を開くと、
  スマホで読む QR と入口の URL が出る(その画面にだけ)。
- 書いてよいのは request.json と make.json だけ(K3。creator/review/schema/README.md)。state.json は読むだけ
  (--make の「作って」の時だけ、review_state.make_new が新しい子の state.json を作る)。
- --make: 初めての会話(会話の画面の 1〜3 歩)から、言葉か絵 1 枚で新しい子を受け付ける。受けた子が、この画面の子になる。
  入力と絵は、この PC のサーバーが配る「作る画面」(/m/)の中だけで扱う(会話の画面のコードは絵にも通信にも触らない)。
  会話の画面は /m/ を枠(iframe)に入れ、状態の知らせ(postMessage)だけを受け取る。/m/ を枠に入れてよいのは --allow-origin の元
  (--web の元と、この PC の 5173・8787 は既定で入る)だけ。枠の中は Cookie が使えないので、合言葉は見出し X-YC-Key で送る
  (合言葉は枠の URL の # の後ろで渡す。# はサーバーに送られない)。よその元からの呼び出し(CORS)は受けない。
- --auto-next claude(既定)/ direct / off: 作る画面から頼みが届いたら(合言葉の門を通った書き込みの後だけ)、このサーバーが
  使う人の Claude Code で /yuru-next を自分で流す(1 回に 1 本・時間の上限つき。auto_next.py)。スマホだけで作れる(B4 12b)。
  off にすると前と同じ(PC で /yuru-next と打つ)。
"""
import argparse
import hmac
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_state as rs  # noqa: E402
import redo_check as rc  # noqa: E402
import auto_next as an  # noqa: E402

PAGE_DIR = Path(__file__).resolve().parent / "page"
ASSET_RE = re.compile(r"^[a-z0-9_]+\.(js|css)$")
MAKE_PAGE = "make.html"
FILE_RE = re.compile(r"^/api/review/file/(C0|C2|C3|C5)/r(\d{1,3})/([a-z0-9_]{1,48}\.(?:png|jpg|svg|json))$")
CONVERT_RE = re.compile(r"^/api/review/convert/r([1-5])/(drawing\.png|drawing\.svg)$")   # 3D 用のゆるキャラ変換の絵(B4 12b)
TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json",
         ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8"}
CSP_PAGE = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; "
            "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
CSP_SVG = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"
BODY_MAX = 8 * 1024
MAKE_MAX = 6 * 1024 * 1024       # 「作って」の本文(絵の base64 を含む)。絵そのものは 4MB まで(review_state)
DEFAULT_WEB_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8787", "http://127.0.0.1:8787")
WRITE_GAP_S = 1.0
WRITE_PER_HOUR = 60
FAIL_WINDOW_S = 600
FAIL_PER_IP = 5
FAIL_TOTAL = 30
SESSIONS_MAX = 10


class Gate:
    """合言葉・セッション・回数の上限を持つ。記憶の中だけ(起動し直すと消える)。"""

    def __init__(self, token, hours):
        self.token = token
        self.expires = time.time() + hours * 3600
        self.sessions = {}
        self.fails = {}
        self.fail_total = 0
        self.writes = {}
        self.lock = threading.Lock()

    def expired(self):
        return time.time() > self.expires

    def try_token(self, ip, given):
        with self.lock:
            now = time.time()
            recent = [t for t in self.fails.get(ip, []) if now - t < FAIL_WINDOW_S]
            self.fails[ip] = recent
            if self.fail_total >= FAIL_TOTAL or len(recent) >= FAIL_PER_IP:
                return "blocked"
            if given and hmac.compare_digest(given.encode(), self.token.encode()):
                sid = secrets.token_urlsafe(32)
                if len(self.sessions) >= SESSIONS_MAX:
                    self.sessions.pop(next(iter(self.sessions)))
                self.sessions[sid] = self.expires
                return sid
            recent.append(now)
            self.fail_total += 1
            return None

    def has(self, sid):
        return bool(sid) and sid in self.sessions and not self.expired()

    def check_key(self, ip, given):
        """見出し X-YC-Key の合言葉(よその元からの呼び出し)。True / False / "blocked"。間違いは合言葉の入口と同じに数える。"""
        with self.lock:
            now = time.time()
            recent = [t for t in self.fails.get(ip, []) if now - t < FAIL_WINDOW_S]
            self.fails[ip] = recent
            if self.fail_total >= FAIL_TOTAL or len(recent) >= FAIL_PER_IP:
                return "blocked"
            if given and not self.expired() and hmac.compare_digest(given.encode(), self.token.encode()):
                return True
            recent.append(now)
            self.fail_total += 1
            return False

    def allow_write(self, sid):
        with self.lock:
            now = time.time()
            ts = [t for t in self.writes.get(sid, []) if now - t < 3600]
            if (ts and now - ts[-1] < WRITE_GAP_S) or len(ts) >= WRITE_PER_HOUR:
                return False
            ts.append(now)
            self.writes[sid] = ts
            return True


class ExclusiveServer(ThreadingHTTPServer):
    """番号を 1 本だけで持つ。Windows では既定の再利用の設定だと、ほかの物が使っている番号にも重ねて待ててしまう(実測)。"""

    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def look_of(bdir, man):
    """見せる絵の様子(画面のおすすめに使う。束の manifest とハッシュは変えない)。
    brows: 絵の絵(C0)が SVG の時、K1 の眉の部品(brow_R・brow_L)に図形があれば True、無ければ False。SVG でない・読めない時は None
    (画面はおすすめを出さない)。"""
    look = {"brows": None}
    right = (man.get("compare") or {}).get("right") or ""
    if man.get("gate") != "C0" or not right.endswith(".svg") or right not in (man.get("files") or {}):
        return look
    target = (bdir / right).resolve()
    if target.parent != bdir.resolve():     # 束のフォルダの外は読まない(_bundle_file と同じ決まり)
        return look
    try:
        if target.stat().st_size > 4 * 1024 * 1024:
            return look
        look["brows"] = rc.brow_info(target.read_text(encoding="utf-8", errors="replace"))["has"]
    except (OSError, ValueError, SyntaxError) as e:  # ET.ParseError は SyntaxError の仲間
        print(f"眉を読めませんでした: {type(e).__name__}", file=sys.stderr)
    return look


def lan_address():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # 送らない。道を調べるだけ(文書用のアドレス)
        return s.getsockname()[0]
    finally:
        s.close()


def client_kind(ua):
    ua = (ua or "").lower()
    if "iphone" in ua or "ipad" in ua:
        return "iphone"
    if "android" in ua:
        return "android"
    if "windows" in ua or "macintosh" in ua or "linux" in ua:
        return "pc"
    return "other"


class Current:
    """いまの子の id。--make のときは「作って」を受けるたびに新しい子に替わる(1 台で 1 人が作る前提)。"""

    def __init__(self, cid, make):
        self.id = cid
        self.make = make


def make_handler(cur, gate, write_lock, hosts, bind_public, port, allow=(), web=None, runner=None):
    same = {f"http://{h}" for h in hosts}
    allow = set(allow) - same

    class H(BaseHTTPRequestHandler):
        server_version = "yc-review"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # 道の部分と番号だけ(合言葉・Cookie を書かない)
            path = self.path.split("?", 1)[0]
            code = args[1] if len(args) > 1 else ""
            sys.stderr.write(f"{self.command} {path} {code}\n")

        # ---------- 返す ----------
        def _send(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None, csp=CSP_PAGE, frame_ok=False):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            if not frame_ok:   # 枠に入れてよいのは /m/ の作る画面だけ(frame-ancestors で元を決める)
                self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", csp)
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, code, obj, extra=None):
            self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), extra=extra)

        def _err(self, code, reason, msg):
            self._json(code, {"error": msg, "reason": reason})

        def _file(self, path):
            p = Path(path)
            if not p.is_file() or p.is_symlink():
                return self._err(404, "not_found", "ありません")
            ext = p.suffix.lower()
            self._send(200, p.read_bytes(), TYPES.get(ext, "application/octet-stream"),
                       csp=CSP_SVG if ext == ".svg" else CSP_PAGE)

        # ---------- 確かめ ----------
        def _sid(self):
            for part in (self.headers.get("Cookie") or "").split(";"):
                k, _, v = part.strip().partition("=")
                if k == "yc_s":
                    return v
            return None

        def _host_ok(self):
            return (self.headers.get("Host") or "") in hosts

        def _loopback(self):
            return self.client_address[0] in ("127.0.0.1", "::1")

        def _origin_kind(self):
            """None(Origin 無し)/ "same"(この PC のサーバーの画面)/ "bad"(よその元。許した元も、/m/ を枠に入れてよいだけ)。"""
            origin = self.headers.get("Origin")
            if origin is None:
                return None
            return "same" if origin in same else "bad"

        def _key_ok(self):
            given = self.headers.get("X-YC-Key")
            if not given:
                return False
            r = gate.check_key(self.client_address[0], given)
            if r == "blocked":
                self._blocked = True
                return False
            return bool(r)

        def _can_read(self):
            if self._origin_kind() == "bad":
                return False
            return gate.has(self._sid()) or self._key_ok() or (not bind_public and self._loopback())

        # ---------- GET ----------
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if not self._host_ok():
                return self._err(421, "host", "この名前では開けません")
            url = urlsplit(self.path)
            p = url.path
            if p == "/api/review/health":
                return self._json(200, {"ok": True})
            if p == "/k":
                return self._enter(parse_qs(url.query).get("k", [""])[0])
            if p == "/qr":
                return self._qr()
            if p in ("/", "/r"):
                return self._send(303, b"", extra={"Location": "/r/"})
            if p == "/r/":
                return self._file(PAGE_DIR / "index.html")
            if p in ("/m", "/m/"):
                if not cur.make:
                    return self._err(404, "not_found", "ありません")
                fa = " ".join(sorted(allow)) or "'none'"
                csp = CSP_PAGE.replace("frame-ancestors 'none'", f"frame-ancestors {fa}")
                body = (PAGE_DIR / MAKE_PAGE).read_bytes()
                return self._send(200, body, "text/html; charset=utf-8", csp=csp, frame_ok=True)
            if p.startswith("/r/assets/"):
                name = p[len("/r/assets/"):]
                if not ASSET_RE.match(name):
                    return self._err(404, "not_found", "ありません")
                return self._file(PAGE_DIR / name)
            if not p.startswith("/api/review/"):
                return self._err(404, "not_found", "ありません")
            if gate.expired():
                return self._err(401, "expired", "時間切れです。serve_review.py を起動し直してください")
            if not self._can_read():
                if getattr(self, "_blocked", False):
                    return self._err(429, "rate", "合言葉の試しが多すぎます。しばらく待つか、起動し直してください")
                return self._err(401, "auth", "合言葉の入口から開いてください")
            if p == "/api/review/state":
                return self._state()
            if cur.id is None:
                return self._err(404, "not_found", "まだ子がいません")
            cid = cur.id
            m = re.match(r"^/api/review/bundle/(C0|C2|C3|C5)$", p)
            if m:
                return self._bundle(m.group(1), parse_qs(url.query).get("round", [None])[0])
            m = FILE_RE.match(p)
            if m:
                return self._bundle_file(m.group(1), int(m.group(2)), m.group(3))
            m = CONVERT_RE.match(p)
            if m:
                target = (rs.review_dir(cid) / "convert" / f"r{m.group(1)}" / m.group(2)).resolve()
                if target.parent.parent != (rs.review_dir(cid) / "convert").resolve() or not target.is_file():
                    return self._err(404, "not_found", "まだ描けていません")
                return self._file(target)
            if p == "/api/review/original":
                st = rs.load_state(cid)
                if not st["original"]:
                    return self._err(404, "not_found", "元の絵はありません")
                return self._file(rs.review_dir(cid) / st["original"]["file"])
            return self._err(404, "not_found", "ありません")

        def _enter(self, given):
            ip = self.client_address[0]
            if gate.expired():
                return self._err(401, "expired", "時間切れです")
            sid = gate.try_token(ip, given)
            if sid == "blocked":
                return self._err(429, "rate", "合言葉の試しが多すぎます。しばらく待つか、起動し直してください")
            if not sid:
                time.sleep(0.3)
                return self._send(401, "合言葉が違います".encode("utf-8"), "text/plain; charset=utf-8")
            age = int(gate.expires - time.time())
            self._send(303, b"", extra={"Location": "/r/",
                                        "Set-Cookie": f"yc_s={sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age={age}"})

        def _qr(self):
            host = self.headers.get("Host") or ""
            if not self._loopback() or host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
                return self._err(404, "not_found", "ありません")
            addr = hosts[-1].rsplit(":", 1)[0] if bind_public else "127.0.0.1"
            url = f"http://{addr}:{port}/k?k={gate.token}"
            try:
                import segno
                qr = segno.make(url, error="m").svg_inline(scale=6)
            except ImportError:
                qr = "<p>QR を出すには、先に python -m pip install segno を打ってください。下のリンクは、そのまま使えます。</p>"
            first = ""
            if cur.make and web:
                from html import escape
                link = f"{web.rstrip('/')}/?onboard=1#yc-make=http://127.0.0.1:{port}&yc-key={gate.token}"
                # 画面の文字には合言葉を出さない(画面の録画や写真に残らないように。リンクと QR の中だけ。CRITux 22)
                first = ("<h2 style='font-size:18px'>この PC の初めての会話(言葉か絵で作る)</h2>"
                         f"<p style='word-break:break-all'><a href='{escape(link, quote=True)}'>{escape(link.replace(gate.token, '••••••'))}</a></p>"
                         "<p>開くと、初めての会話の 1〜3 つ目のステップの中に、この PC の作る画面が出ます。言葉か絵を入れたら、"
                         + ("この PC が自分で Claude Code を動かして描きます(/yuru-next を打たなくてよい)。</p>" if runner and runner.on
                            else "Claude Code で /yuru-next と打ってください。</p>"))
            html = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                    "<title>確認画面の入口</title><body style='font:16px sans-serif;margin:24px'>"
                    f"<h1 style='font-size:20px'>スマホで読む QR({cur.id or '作る道'})</h1>{qr}"
                    f"<p style='word-break:break-all'><a href='{url}'>{url.replace(gate.token, '••••••')}</a></p>"
                    "<p>合言葉は伏せて出しています(リンクと QR には入っています)。</p>"
                    f"{first}"
                    "<p>この画面は人にだけ見せてください。使い終わったら serve_review.py を止めて、合言葉を捨ててください。</p></body>")
            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8",
                       csp="default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'")

        def _state(self):
            cid = cur.id
            if cid is None:  # --make で、まだ「作って」が来ていない
                return self._json(200, {"state": None, "pending": None, "make": None, "tags": {g: rs.TAGS[g] for g in ("C0", "C2")},
                                        "note_max": rs.NOTE_MAX, "words_max": rs.WORDS_MAX, "redo_max": rs.C0_REDO_MAX,
                                        "server": {"mode": "live", "can_write": gate.has(self._sid()) or self._key_ok(),
                                                   "lan": bind_public, "make": cur.make, "auto": runner.status() if runner else None}})
            st = rs.load_state(cid)
            pend = rs.pending(cid)
            mk = rs.load_make(cid)
            choice = (mk or {}).get("choice") or {}
            auto = runner.status() if runner else None
            etag = f'"{st["rev"]}-{1 if pend else 0}-{1 if choice else 0}-{(auto or {}).get("runs", 0)}{1 if (auto or {}).get("busy") else 0}"'
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            can_write = (gate.has(self._sid()) or self._key_ok()) and not gate.expired()
            make = ({"from": mk["from"], "created_at": mk["created_at"], "choice": choice.get("value")} if mk else None)
            self._json(200, {"state": st, "pending": pend, "make": make, "tags": {g: rs.TAGS[g] for g in ("C0", "C2")},
                             "note_max": rs.NOTE_MAX, "words_max": rs.WORDS_MAX, "redo_max": rs.C0_REDO_MAX,
                             "server": {"mode": "live", "can_write": can_write, "lan": bind_public, "make": cur.make, "auto": auto}},
                       extra={"ETag": etag})

        def _bundle(self, g, rnd):
            cid = cur.id
            st = rs.load_state(cid)
            n = int(rnd) if rnd and rnd.isdigit() else st["gates"][g]["round"]
            p = rs.review_dir(cid) / g / f"r{n}" / "manifest.json"
            if n < 1 or not p.is_file():
                return self._err(404, "not_found", "まだ出ていません")
            man = rs.read_json(p)
            self._json(200, {"manifest": man, "hash": rs.bundle_hash(man), "look": look_of(p.parent, man)})

        def _bundle_file(self, g, n, name):
            bdir = (rs.review_dir(cur.id) / g / f"r{n}").resolve()
            man_p = bdir / "manifest.json"
            if not man_p.is_file():
                return self._err(404, "not_found", "ありません")
            man = rs.read_json(man_p)
            if name not in man["files"]:
                return self._err(404, "not_found", "ありません")
            target = (bdir / name).resolve()
            if target.parent != bdir:
                return self._err(404, "not_found", "ありません")
            return self._file(target)

        # ---------- POST ----------
        def do_POST(self):
            path = urlsplit(self.path).path

            def kick():
                # 合言葉の門を通った書き込みの後だけ、/yuru-next を自分で流す(--auto-next off なら何もしない)
                if runner:
                    runner.kick()
            limit = MAKE_MAX if path == "/api/review/make" and cur.make else BODY_MAX
            # 先に本文を読み切る(読まずに断ると、残りが次の呼び出しとして読まれる。実測)
            try:
                size = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                size = -1
            if size < 0 or size > limit:
                self.close_connection = True
                return self._err(413, "too_large", "大きすぎます")
            raw = self.rfile.read(size) if size else b""
            if not self._host_ok():
                return self._err(421, "host", "この名前では開けません")
            if self._origin_kind() == "bad":
                return self._err(403, "origin", "よそのページからは押せません")
            if gate.expired():
                return self._err(401, "expired", "時間切れです。serve_review.py を起動し直してください")
            sid = self._sid()
            # スマホの確認画面は Cookie、枠の中の作る画面は見出しの合言葉(枠の中は Cookie が使えない)
            authed = gate.has(sid) or self._key_ok()
            if not authed:
                if getattr(self, "_blocked", False):
                    return self._err(429, "rate", "合言葉の試しが多すぎます。しばらく待つか、起動し直してください")
                return self._err(401, "auth", "合言葉の入口から開いてください")
            bucket = sid if gate.has(sid) else "key:" + self.client_address[0]
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
            if ctype != "application/json" or self.headers.get("X-YC") != "1":
                return self._err(400, "bad_request", "送り方が違います")
            try:
                body = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                return self._err(400, "bad_request", "本文の形が違います")
            if not gate.allow_write(bucket):
                return self._err(429, "rate", "少し待ってから押してください")
            try:
                with write_lock:
                    if path == "/api/review/make" and cur.make:
                        rec = rs.make_new(body, client_kind(self.headers.get("User-Agent")))
                        cur.id = rec["id"]
                        kick()
                        return self._json(201, {"id": rec["id"], "make_id": rec["make_id"]})
                    if cur.id is None:
                        return self._err(404, "not_found", "まだ子がいません")
                    if path == "/api/review/make/choice" and cur.make:
                        rs.make_choice(cur.id, body)
                        kick()
                        return self._json(200, {"ok": True})
                    if path == "/api/review/make/convert" and cur.make and cur.id:
                        cv = rs.make_convert(cur.id, body)
                        kick()
                        return self._json(201, {"round": cv["round"]})
                    if path == "/api/review/make/convert_ok" and cur.make and cur.id:
                        cv = rs.make_convert_ok(cur.id, body)
                        kick()
                        return self._json(200, {"ok": True, "round": cv["round"]})
                    if path == "/api/review/decision":
                        req = rs.make_request(cur.id, body, client_kind(self.headers.get("User-Agent")))
                        kick()
                        return self._json(201, {"request_id": req["request_id"]})
                    if path == "/api/review/cancel":
                        rs.cancel_request(cur.id, (body or {}).get("request_id"))
                        return self._json(200, {"ok": True})
            except rs.ReviewError as e:
                return self._err(e.status, e.reason, e.msg)
            return self._err(404, "not_found", "ありません")

    return H


def main(argv=None):
    ap = argparse.ArgumentParser(description="スマホの確認画面(C0・C2)と、初めての会話の作る道")
    ap.add_argument("id", nargs="?")
    ap.add_argument("--port", type=int, default=8796)
    ap.add_argument("--bind")
    ap.add_argument("--lan", action="store_true")
    ap.add_argument("--hours", type=float, default=8)
    ap.add_argument("--make", action="store_true", help="初めての会話から、言葉か絵 1 枚で新しい子を受け付ける")
    ap.add_argument("--web", help="初めての会話の画面の元(例 http://localhost:5173)。/qr に入口を出し、作る画面を枠に入れてよい元にする")
    ap.add_argument("--allow-origin", action="append", default=[], help="作る画面(/m/)を枠に入れてよい元(何回でも)")
    ap.add_argument("--auto-next", choices=an.MODES, default=None,
                    help="頼みが届いたら /yuru-next を自分で流す(claude = 使う人の Claude Code で /yuru-next、direct = yuru_make.py next、off = 流さない)")
    ap.add_argument("--auto-args", default="", help="direct の時に yuru_make.py next へ足す引数(試験用。例 --fake-draw --fake-check yuru)")
    ap.add_argument("--auto-timeout", type=int, default=an.JOB_TIMEOUT, help="1 本の時間の上限(秒)")
    args = ap.parse_args(argv)
    if not args.id and not args.make:
        print("子の id か --make のどちらかを渡してください", file=sys.stderr)
        return 2
    if args.id:
        try:
            rs.load_state(args.id)
        except rs.ReviewError as e:
            print(f"{e.msg}。先に review_state.py init を流してください", file=sys.stderr)
            return 2
    origins = list(args.allow_origin)
    if args.make:
        origins += list(DEFAULT_WEB_ORIGINS)
    if args.web:
        w = urlsplit(args.web)
        if w.scheme not in ("http", "https") or not w.netloc:
            print("--web は http(s)://名前:番号 の形にしてください", file=sys.stderr)
            return 2
        origins.append(f"{w.scheme}://{w.netloc}")
    for o in origins:
        if not re.match(r"^https?://[A-Za-z0-9.\-\[\]:]+$", o) or o.endswith("/"):
            print(f"元の形が違います: {o}(例 http://localhost:5173)", file=sys.stderr)
            return 2
    bind = args.bind or (lan_address() if args.lan else "127.0.0.1")
    if bind in ("0.0.0.0", "::"):
        print("0.0.0.0 にはつなぎません。--lan か決まったアドレスを使ってください", file=sys.stderr)
        return 2
    if os.environ.get("YC_REVIEW_TEST") == "1" and os.environ.get("YC_REVIEW_TOKEN"):
        token = os.environ["YC_REVIEW_TOKEN"]
    else:
        token = secrets.token_urlsafe(16)
    lock_p = rs.work_root() / ".review_serve.lock"
    lock_p.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(lock_p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            old = json.loads(lock_p.read_text(encoding="utf-8"))
            alive = _pid_alive(int(old.get("pid", 0)))
        except (ValueError, OSError):
            alive = False
        if alive:
            print(f"もう 1 本動いています(番号 {old.get('port')}、{old.get('id')})", file=sys.stderr)
            return 2
        os.remove(lock_p)
        fd = os.open(lock_p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    gate = Gate(token, args.hours)
    try:
        srv = ExclusiveServer((bind, args.port), None)
    except OSError:
        os.close(fd)
        os.remove(lock_p)
        print(f"番号 {args.port} はほかの物が使っています。--port で別の番号にしてください", file=sys.stderr)
        return 2
    port = srv.server_address[1]
    # --lan・--bind の時も、QR の画面(/qr)はこの PC のブラウザの 127.0.0.1 で開く(/qr は 127.0.0.1 から来た時だけ出す)。
    # 外へ出るアドレスだけで待つと、127.0.0.1 の /qr に届かない(つながらない)。同じ番号で 127.0.0.1 にも待つ(撮影の練習で見つけた)
    local_srv = None
    if srv.server_address[0] != "127.0.0.1":
        try:
            local_srv = ExclusiveServer(("127.0.0.1", port), None)
        except OSError:
            srv.server_close()
            os.close(fd)
            os.remove(lock_p)
            print(f"番号 {port} は、この PC の 127.0.0.1 でほかの物が使っています。--port で別の番号にしてください", file=sys.stderr)
            return 2
    hosts = [f"127.0.0.1:{port}", f"localhost:{port}"] if bind == "127.0.0.1" else [f"{bind}:{port}"]
    if bind != "127.0.0.1":
        hosts = [f"127.0.0.1:{port}", f"localhost:{port}"] + hosts
    runner = None
    # 既定は claude。試験(YC_REVIEW_TEST=1)の時は、決めて渡した時だけ流す(試験で本物の Claude を起こさない)
    if args.auto_next is None:
        args.auto_next = "off" if os.environ.get("YC_REVIEW_TEST") == "1" else "claude"
    if args.make and args.auto_next != "off":
        import yuru_make as ym   # 進められる物があるか(1 本流した後に、続けて流すか)

        def _log(*parts):
            print("[auto-next]", *[str(x).replace(chr(10), " ")[:200] for x in parts], flush=True)

        runner = an.AutoNext(args.auto_next, extra=args.auto_args.split(), timeout=max(60, min(args.auto_timeout, 1200)),
                             has_work=lambda: bool(ym.candidates()), log=_log)
    handler = make_handler(Current(args.id, args.make), gate, threading.Lock(), hosts, bind != "127.0.0.1", port,
                           allow=origins, web=args.web, runner=runner)
    srv.RequestHandlerClass = handler
    if local_srv:
        local_srv.RequestHandlerClass = handler
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps({"pid": os.getpid(), "port": port, "id": args.id, "at": rs.now_iso()}))
    where = "この PC の中だけ" if bind == "127.0.0.1" else "同じネットワークの中だけ"
    print(f"確認画面: {args.id or '作る道(初めての会話から言葉か絵で作る)'}({where}。{args.hours:g} 時間で切れます)")
    print(f"PORT {port}")
    print(f"スマホで開くには、この PC のブラウザで http://127.0.0.1:{port}/qr を開き、QR を読んでください。")
    if runner:
        print(f"頼みが届いたら、この PC が自分で /yuru-next を流します({args.auto_next}。止めるには --auto-next off)。")
    print("合言葉は、その画面にだけ出し、記録しません。止めるときは Ctrl+C。", flush=True)
    local_thread = None
    try:
        if local_srv:
            local_thread = threading.Thread(target=local_srv.serve_forever, name="review-local", daemon=True)
            local_thread.start()
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if local_thread:
            local_srv.shutdown()  # 動かした時だけ(動かしていないのに呼ぶと待ち続ける)
        if local_srv:
            local_srv.server_close()
        srv.server_close()
        try:
            os.remove(lock_p)
        except OSError:
            pass
    return 0


def _pid_alive(pid):
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not h:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(h)
        return code.value == 259
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


if __name__ == "__main__":
    sys.exit(main())
