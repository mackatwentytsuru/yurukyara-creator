"""同時に動かす試験を、作業用 PC から自動で回す(iPhone は画面を点けたまま立てておくだけ)。

  python place/shootlog/run_concurrency.py --out <出力フォルダ> --tests A B C D [--seconds 60] [--cooldown 120]
    [--host 192.168.x.x] [--ue-url "http://192.168.x.x:8080/?AutoConnect=true&AutoPlayVideo=true&StartVideoMuted=true&HoveringMouse=true"]
  A 録画のみ / B 録画 + UE モニター / C 録画 + 作業用 PC へ映像 / D 録画 + 両方
やること(試験ごと): 受け手(C・D)を起動 → Mac 経由で iPhone のアプリを起動引数つきで起動(--auto-record で 5 秒後に録画、指定の秒数で止める)
  → 終わったら撮影フォルダを iPhone から取り出して作業用 PC へ → 次の試験の前に冷ます → 最後に concurrency_report.py で表にする。
前提: iPhone がロック解除・画面点灯で、機種が Mac(ssh pc3)から見える。B・D は UE の待ち受け(show/live/run_live.py serve)が動いている。
作業用 PC 側の記録は --out(J: か D:)。重い GPU 処理は無いが、受け手が書き込むので、呼ぶ前に札を取る(machine_lock.py run --kind cpu)。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE = "dev.hackathon.shootlog"
MAC_ENV = "export PATH=/opt/homebrew/bin:$PATH; "


def ssh(cmd: str, timeout=120) -> str:
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=10", "pc3", MAC_ENV + cmd], capture_output=True, text=True, timeout=timeout)
    return (r.stdout or "") + (r.stderr or "")


def device_id() -> str:
    return ssh("cat ~/sample_work/place_ios/device_id.txt").strip().splitlines()[-1]


def list_shoots(dev: str) -> list[str]:
    out = ssh(f"xcrun devicectl device info files --device {dev} --domain-type appDataContainer --domain-identifier {BUNDLE} --subdirectory Documents/shoots 2>&1")
    names = sorted({tok.split("/")[-1] for line in out.splitlines() for tok in line.split() if tok.startswith("20") and "-" in tok and len(tok.split("/")[-1]) == 15})
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tests", nargs="+", default=["A", "B", "C", "D"])
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--cooldown", type=int, default=240)
    ap.add_argument("--host", default="192.168.x.x")
    ap.add_argument("--ue-url", default="")
    ap.add_argument("--pc-port", type=int, default=9100)
    ap.add_argument("--ue-port", type=int, default=9000)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    dev = device_id()
    labels = {"A": "A 録画のみ", "B": "B 録画+UE", "C": "C 録画+作業用 PC へ映像", "D": "D 録画+UE+作業用 PC へ映像"}
    report_items = []
    for t in a.tests:
        d = out / t
        d.mkdir(exist_ok=True)
        before = set(list_shoots(dev))
        recv = None
        if t in ("C", "D"):
            recv = subprocess.Popen([sys.executable, str(HERE / "pc_stream_receiver.py"), "--out", str(d / "recv"), "--port", str(a.pc_port), "--seconds", str(a.seconds + 40)],
                                    stdout=open(d / "recv.log", "w"), stderr=subprocess.STDOUT)
            time.sleep(1.5)
        args = ["--auto-record", str(a.seconds), "--exit-after-record"]
        if t in ("B", "D"):
            args += ["--ue-on", "--ue-host", a.host, "--ue-port", str(a.ue_port), "--ue-url", a.ue_url]
        if t in ("C", "D"):
            args += ["--pc-on", "--pc-host", a.host, "--pc-port", str(a.pc_port)]
        launch = ssh(f"xcrun devicectl device process launch --device {dev} --terminate-existing {BUNDLE} " + " ".join(f"'{x}'" for x in args) + " 2>&1 | tail -3")
        print(f"[{t}] 起動:", launch.strip().replace("\n", " | "))
        time.sleep(5 + a.seconds + 15)
        after = list_shoots(dev)
        new = [n for n in after if n not in before]
        if not new:
            print(f"[{t}] 新しい撮影フォルダが見つからない(起動に失敗した可能性)。次へ")
            if recv:
                recv.terminate()
            continue
        name = new[-1]
        ssh(f"rm -rf /tmp/conc_{t} && mkdir -p /tmp/conc_{t} && xcrun devicectl device copy from --device {dev} --domain-type appDataContainer --domain-identifier {BUNDLE} --source Documents/shoots/{name} --destination /tmp/conc_{t}/{name} 2>&1 | tail -2", timeout=600)
        subprocess.run(["scp", "-r", "-q", f"pc3:/tmp/conc_{t}/{name}", str(d / "shoot")], check=False)
        if recv:
            try:
                recv.wait(timeout=60)
            except subprocess.TimeoutExpired:
                recv.terminate()
        item = f"{labels[t]}={d / 'shoot'}" + (f"|{d / 'recv'}" if recv else "")
        report_items.append(item)
        print(f"[{t}] 取り出した:", name)
        if t != a.tests[-1]:
            print(f"冷ます {a.cooldown} 秒")
            time.sleep(a.cooldown)
    if report_items:
        subprocess.run([sys.executable, str(HERE / "concurrency_report.py"), *report_items, "--out", str(out / "report.md")])


if __name__ == "__main__":
    main()
