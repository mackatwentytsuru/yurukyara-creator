"""スマホの確認画面(C0 絵・C2 形)を配り、人の OK・やり直しを request.json に書く、小さなサーバー。

使い方: python creator/review/serve_review.py <id> [--port 8790] [--lan | --bind <アドレス>] [--hours 8]
- 既定は 127.0.0.1 だけで待つ。--lan は外へ出る道のアドレス、--bind は決めたアドレス(0.0.0.0 にはしない)。
- 合言葉は起動のたびに作り、画面にも記録にも出さない。この PC のブラウザで http://127.0.0.1:<番号>/qr を開くと、
  スマホで読む QR と入口の URL が出る(その画面にだけ)。
- 書いてよいのは request.json だけ(K3。creator/review/schema/README.md)。state.json は読むだけ。
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

PAGE_DIR = Path(__file__).resolve().parent / "page"
ASSET_RE = re.compile(r"^[a-z0-9_]+\.(js|css)$")
FILE_RE = re.compile(r"^/api/review/file/(C0|C2|C3|C5)/r(\d{1,3})/([a-z0-9_]{1,48}\.(?:png|jpg|svg|json))$")
TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json",
         ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8"}
CSP_PAGE = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; "
            "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
CSP_SVG = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"
BODY_MAX = 8 * 1024
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


def make_handler(cid, gate, write_lock, hosts, bind_public, port):
    class H(BaseHTTPRequestHandler):
        server_version = "yc-review"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # 道の部分と番号だけ(合言葉・Cookie を書かない)
            path = self.path.split("?", 1)[0]
            code = args[1] if len(args) > 1 else ""
            sys.stderr.write(f"{self.command} {path} {code}\n")

        # ---------- 返す ----------
        def _send(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None, csp=CSP_PAGE):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
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

        def _can_read(self):
            return gate.has(self._sid()) or (not bind_public and self._loopback())

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
                return self._err(401, "auth", "合言葉の入口から開いてください")
            if p == "/api/review/state":
                return self._state()
            m = re.match(r"^/api/review/bundle/(C0|C2|C3|C5)$", p)
            if m:
                return self._bundle(m.group(1), parse_qs(url.query).get("round", [None])[0])
            m = FILE_RE.match(p)
            if m:
                return self._bundle_file(m.group(1), int(m.group(2)), m.group(3))
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
                qr = ""
            html = ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                    "<title>確認画面の入口</title><body style='font:16px sans-serif;margin:24px'>"
                    f"<h1 style='font-size:20px'>スマホで読む QR({cid})</h1>{qr}"
                    f"<p style='word-break:break-all'>{url}</p>"
                    "<p>この画面は人にだけ見せてください。撮影のあとは serve_review.py を止めて、合言葉を捨ててください。</p></body>")
            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8",
                       csp="default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'")

        def _state(self):
            st = rs.load_state(cid)
            pend = rs.pending(cid)
            etag = f'"{st["rev"]}-{1 if pend else 0}"'
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            can_write = gate.has(self._sid()) and not gate.expired()
            self._json(200, {"state": st, "pending": pend, "tags": {g: rs.TAGS[g] for g in ("C0", "C2")},
                             "note_max": rs.NOTE_MAX,
                             "server": {"mode": "live", "can_write": can_write, "lan": bind_public}},
                       extra={"ETag": etag})

        def _bundle(self, g, rnd):
            st = rs.load_state(cid)
            n = int(rnd) if rnd and rnd.isdigit() else st["gates"][g]["round"]
            p = rs.review_dir(cid) / g / f"r{n}" / "manifest.json"
            if n < 1 or not p.is_file():
                return self._err(404, "not_found", "まだ出ていません")
            man = rs.read_json(p)
            self._json(200, {"manifest": man, "hash": rs.bundle_hash(man)})

        def _bundle_file(self, g, n, name):
            bdir = (rs.review_dir(cid) / g / f"r{n}").resolve()
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
            # 先に本文を読み切る(読まずに断ると、残りが次の呼び出しとして読まれる。実測)
            try:
                size = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                size = -1
            if size < 0 or size > BODY_MAX:
                self.close_connection = True
                return self._err(413, "too_large", "大きすぎます")
            raw = self.rfile.read(size) if size else b""
            if not self._host_ok():
                return self._err(421, "host", "この名前では開けません")
            origin = self.headers.get("Origin")
            if origin is not None and origin not in {f"http://{h}" for h in hosts}:
                return self._err(403, "origin", "よそのページからは押せません")
            if gate.expired():
                return self._err(401, "expired", "時間切れです。serve_review.py を起動し直してください")
            sid = self._sid()
            if not gate.has(sid):
                return self._err(401, "auth", "合言葉の入口から開いてください")
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
            if ctype != "application/json" or self.headers.get("X-YC") != "1":
                return self._err(400, "bad_request", "送り方が違います")
            try:
                body = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                return self._err(400, "bad_request", "本文の形が違います")
            if not gate.allow_write(sid):
                return self._err(429, "rate", "少し待ってから押してください")
            path = urlsplit(self.path).path
            try:
                with write_lock:
                    if path == "/api/review/decision":
                        req = rs.make_request(cid, body, client_kind(self.headers.get("User-Agent")))
                        return self._json(201, {"request_id": req["request_id"]})
                    if path == "/api/review/cancel":
                        rs.cancel_request(cid, (body or {}).get("request_id"))
                        return self._json(200, {"ok": True})
            except rs.ReviewError as e:
                return self._err(e.status, e.reason, e.msg)
            return self._err(404, "not_found", "ありません")

    return H


def main(argv=None):
    ap = argparse.ArgumentParser(description="スマホの確認画面(C0・C2)")
    ap.add_argument("id")
    ap.add_argument("--port", type=int, default=8796)
    ap.add_argument("--bind")
    ap.add_argument("--lan", action="store_true")
    ap.add_argument("--hours", type=float, default=8)
    args = ap.parse_args(argv)
    try:
        rs.load_state(args.id)
    except rs.ReviewError as e:
        print(f"{e.msg}。先に review_state.py init を流してください", file=sys.stderr)
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
    hosts = [f"127.0.0.1:{port}", f"localhost:{port}"] if bind == "127.0.0.1" else [f"{bind}:{port}"]
    if bind != "127.0.0.1":
        hosts = [f"127.0.0.1:{port}", f"localhost:{port}"] + hosts
    srv.RequestHandlerClass = make_handler(args.id, gate, threading.Lock(), hosts, bind != "127.0.0.1", port)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps({"pid": os.getpid(), "port": port, "id": args.id, "at": rs.now_iso()}))
    where = "この PC の中だけ" if bind == "127.0.0.1" else "同じネットワークの中だけ"
    print(f"確認画面: {args.id}({where}。{args.hours:g} 時間で切れます)")
    print(f"PORT {port}")
    print(f"スマホで開くには、この PC のブラウザで http://127.0.0.1:{port}/qr を開き、QR を読んでください。")
    print("合言葉は、その画面にだけ出し、記録しません。止めるときは Ctrl+C。", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
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
