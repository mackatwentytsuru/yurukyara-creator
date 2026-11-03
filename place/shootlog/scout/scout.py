"""画角の下見: iPad を動かすと、UE の会場の中のカメラが同じように動く(show/live/ の仕組み。レンズは iPad の値に自動で合う)。その操作盤。

  python place/shootlog/scout/scout.py [--media <映像>] [--minutes 60] [--panel-only]
やること: ①show/live/run_live.py serve を起動する(UE・絵を送る仕組み)②操作盤のページ http://<この機械の IP>:18090/ を出す。
操作盤: 「候補の位置」を押すと、今の iPad の姿勢がその位置・向きになる(そこから歩ける)。「ショーの秒」を押すと、LED の映像とキャラがその秒へ飛ぶ。
座標は show/ue/stage_layout.py と同じ(cm、x 右、y 客席、z 上)。止めるときは Ctrl+C(自分で起動した物だけ閉じる)。
"""
from __future__ import annotations

import argparse
import html
import http.server
import json
import math
import re
import socket
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO = Path(__file__).resolve().parents[3]
RUN_LIVE = REPO / "show" / "live" / "run_live.py"
UDP_PORT, PANEL_PORT = 9000, 18090
TARGET = (0.0, 0.0, 330.0)     # 向く先(B 面の中央あたり)

# 候補の位置: 名前, (x, y, z) cm。校正の点の数は、向く先を B 面の中央にしたときの計算(iPad の画角 横 64.1°、16:9)
SPOTS = [
    ("正面 13 m", (0, 1300, 170), "校正の点 33/33"),
    ("正面 10 m", (0, 1000, 170), "校正の点 27/33"),
    ("正面 8 m", (0, 800, 170), "校正の点 21/33"),
    ("正面 6 m", (0, 600, 170), "校正の点 17/33"),
    ("正面 4.8 m 低め", (0, 480, 140), "校正の点 10/33(B だけ)"),
    ("下手 斜め 13 m", (-600, 1200, 150), "校正の点 30/33"),
    ("上手 斜め 13 m", (600, 1200, 150), ""),
]
# ショーの秒: キャラが舞台に出ている所(show/show_stage.json の ar_path)
TIMES = [("キャラが出てくる", 58.8), ("正面で踊る", 66.0), ("客席へ歩く", 70.5), ("上手で踊る", 72.5), ("また正面", 82.0)]


def stop_live(proc, log_path):
    """run_live.py を閉じる。Windows では親を止めても UE と取り次ぎが残るので、ログの「ue pid」「signalling pid」(自分で起動した物)も閉じて、消えたことを確かめる。"""
    text = Path(log_path).read_text(encoding="utf-8", errors="replace") if Path(log_path).exists() else ""
    pids = [int(m) for m in re.findall(r"(?:ue|signalling) pid (\d+)", text)]
    proc.terminate()
    for pid in pids:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    left = [pid for pid in pids if str(pid) in subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, errors="replace").stdout]
    print("閉じた:", pids, "残り:", left, flush=True)
    return left


def yaw_to_target(pos):
    return math.degrees(math.atan2(TARGET[1] - pos[1], TARGET[0] - pos[0]))


def send(message: dict):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.sendto(json.dumps(message).encode("utf-8"), ("127.0.0.1", UDP_PORT))


def lan_ip():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("192.168.x.x", 9))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def page(last=""):
    btn = lambda href, label, note="": f'<a class="b" href="{href}">{html.escape(label)}<small>{html.escape(note)}</small></a>'
    spots = "".join(btn(f"/spot?i={i}", name, note) for i, (name, _, note) in enumerate(SPOTS))
    times = "".join(btn(f"/time?t={t}", name, f"{t} 秒") for name, t in TIMES)
    return f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>画角の下見</title>
<style>body{{font:16px system-ui;margin:16px;background:#14161a;color:#eee}}h2{{font-size:17px;margin:18px 0 8px}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}}
.b{{display:block;padding:14px 12px;background:#2b6cb0;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}}
.b small{{display:block;font-weight:400;opacity:.85;margin-top:4px}}.t .b{{background:#b83280}}p{{color:#bbb}}</style>
<h1 style="font-size:20px">画角の下見</h1><p>{html.escape(last) or "押すと、今の iPad の姿勢がその位置になります。そこから歩けます。"}</p>
<h2>候補の位置</h2><div class="g">{spots}</div><h2>ショーの秒</h2><div class="g t">{times}</div>"""


class Panel(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        last = ""
        if u.path == "/spot":
            name, pos, _ = SPOTS[int(q["i"][0])]
            send({"cmd": "recenter", "pos": list(pos), "yaw": yaw_to_target(pos)})
            last = f"位置: {name}"
        elif u.path == "/time":
            t = float(q["t"][0])
            send({"cmd": "media", "seconds": t})
            last = f"ショーの {t} 秒へ"
        body = page(last).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--media", default=None, help="LED に流す映像(H.264、2840×620 など幅 4096 以下)。省略は run_live.py の既定")
    ap.add_argument("--minutes", type=float, default=60.0)
    ap.add_argument("--out", default="work/_venue_work/scout")
    ap.add_argument("--panel-only", action="store_true", help="UE を起動せず、操作盤だけ出す(試し用)")
    a = ap.parse_args()
    ip = lan_ip()
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", PANEL_PORT), Panel)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"操作盤: http://{ip}:{PANEL_PORT}/   iPad の UE モニター: 送り先 {ip} ポート {UDP_PORT}、絵の URL http://{ip}:8080/", flush=True)
    if a.panel_only:
        threading.Event().wait()
    start = SPOTS[0][1]
    cmd = [sys.executable, str(RUN_LIVE), "serve", "--out", a.out, "--lan", "--start-pos", *[str(v) for v in start], "--start-yaw", str(yaw_to_target(start)),
           "--start-sec", "58.8", "--serve-minutes", str(a.minutes)]
    if a.media:
        cmd += ["--media", a.media]
    Path(a.out).mkdir(parents=True, exist_ok=True)
    log_path = Path(a.out) / "run_live.log"
    with open(log_path, "w", encoding="utf-8") as log:
        p = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
        print("UE を起動しています(1〜4 分)。止めるときは Ctrl+C。", flush=True)
        try:
            code = p.wait()
        except KeyboardInterrupt:
            code = 0
        finally:
            stop_live(p, log_path)
    sys.exit(code)


if __name__ == "__main__":
    main()
