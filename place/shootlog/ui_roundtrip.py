"""録画の往復の試験(本人の手なし): iPad の本物の録画のボタンの経路で Mac へ送り、保存を確かめる。受け手を途中で止める試験もする。

  python place/shootlog/ui_roundtrip.py --out <出力フォルダ> [--seconds 20]
①正常: 録画 → 停止で「保存済み」、iPad の記録のコマ数と Mac のファイルのコマ数が合う、映像が読める。
②異常: 録画の途中で受け手を止める → iPad の画面に「Mac に保存できていません」が出る、テイクが「保存未確認」になる。
Mac の IP は LAN(iPad と同じ Wi-Fi)。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

DEV = "00008103-001959392279001E"
BUNDLE = "dev.hackathon.shootlog"
MAC_IP = "192.168.x.x"


def ssh(cmd, timeout=120):
    r = subprocess.run(["ssh", "pc3", "export PATH=/opt/homebrew/bin:$PATH; " + cmd], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return r.stdout + r.stderr


def pull(name, dest: Path):
    ssh(f"rm -f /tmp/{name}; xcrun devicectl device copy from --device {DEV} --domain-type appDataContainer --domain-identifier {BUNDLE} --source Documents/{name} --destination /tmp/{name} > /dev/null 2>&1")
    subprocess.run(["scp", "-q", f"pc3:/tmp/{name}", str(dest / name)], check=False)


def start_receiver(tag, seconds):
    ssh(f"rm -rf ~/sample_work/rx/{tag}; mkdir -p ~/sample_work/rx/{tag}")
    return subprocess.Popen(["ssh", "pc3", f"python3 ~/sample_work/rx/pc_stream_receiver.py --out ~/sample_work/rx/{tag} --port 9100 --seconds {seconds} --split-takes"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def launch(seconds):
    ssh(f"xcrun devicectl device process launch --device {DEV} --terminate-existing {BUNDLE} --ui-roundtrip {seconds} --ui-host {MAC_IP} 2>&1 | tail -1")


def clear_takes():
    ssh(f"rm -f /tmp/empty.json; echo '[]' > /tmp/empty.json; xcrun devicectl device copy to --device {DEV} --domain-type appDataContainer --domain-identifier {BUNDLE} --source /tmp/empty.json --destination Documents/takes.json > /dev/null 2>&1")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=int, default=20)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(("合格" if cond else "不合格"), name, detail, flush=True)

    # ①正常
    clear_takes()
    rx = start_receiver("rt_ok", a.seconds + 30)
    time.sleep(2)
    launch(a.seconds)
    time.sleep(a.seconds + 3 + 2 + 8 + 3)
    pull("ui_result.json", out)
    pull("ui_log.jsonl", out)
    takes = json.loads((out / "ui_result.json").read_text(encoding="utf-8"))
    t = takes[-1] if takes else {}
    print("iPad の記録:", t, flush=True)
    rx.wait(timeout=60)
    summary = ssh("cat ~/sample_work/rx/rt_ok/take_001/summary.json")
    s = json.loads(summary) if summary.strip().startswith("{") else {}
    probe = ssh("ls ~/sample_work/rx/rt_ok/; ffprobe -v error -count_packets -f hevc -select_streams v -show_entries stream=nb_read_packets,width,height -of csv=p=0 ~/sample_work/rx/rt_ok/take_001/stream.hevc 2>&1 | tail -1")
    print("Mac:", s.get("frames"), s.get("seq_missing"), probe.strip().replace("\n", " | "), flush=True)
    check("録画が「保存済み」になる", t.get("saved") is True)
    check("iPad の送ったコマと Mac の記録が合う", t.get("sent") and abs(t.get("sent", 0) - s.get("frames", -1)) <= 2, f"送った {t.get('sent')}・Mac {s.get('frames')}・iPad が受けた応答 {t.get('macFrames')}")
    check("連番の欠けが 0", s.get("seq_missing") == 0)
    check("長さが合う", abs(t.get("seconds", 0) - a.seconds) < 3, f"{t.get('seconds')} 秒")
    log = [json.loads(x) for x in (out / "ui_log.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    check("正常の間は赤の知らせが出ない", not any(r["alarm"].startswith("Mac") for r in log))

    # ②異常: 録画の途中で受け手を止める
    clear_takes()
    rx = start_receiver("rt_ng", a.seconds + 30)
    time.sleep(2)
    launch(a.seconds)
    time.sleep(3 + 2 + a.seconds / 2)
    rx.terminate()
    ssh("pkill -f 'rx/rt_ng' ; true")
    time.sleep(a.seconds / 2 + 2 + 8 + 3)
    pull("ui_result.json", out)
    pull("ui_log.jsonl", out)
    takes = json.loads((out / "ui_result.json").read_text(encoding="utf-8"))
    t = takes[-1] if takes else {}
    print("iPad の記録:", t, flush=True)
    log = [json.loads(x) for x in (out / "ui_log.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    alarms = [r for r in log if r["alarm"].startswith("Mac")]
    first = log[0]["t"] if log else 0
    rec_start = next((r["t"] for r in log if r["phase"] == "recording"), first)
    delay = alarms[0]["t"] - rec_start if alarms else None
    check("受け手を止めると「Mac に保存できていません」が出る", bool(alarms) and delay > a.seconds / 2 - 3, f"{len(alarms)} 回(録画の開始から {delay:.1f} 秒。止めたのは約 {a.seconds / 2:.0f} 秒)" if alarms else "")
    check("そのテイクは保存未確認になる", t.get("saved") is False, f"送った {t.get('sent')}・応答 {t.get('macFrames')}")
    print("全部合格" if ok else "不合格あり")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
