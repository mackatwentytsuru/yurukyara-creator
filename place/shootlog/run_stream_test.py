"""録画なし(PC 録画の本命の形)の送りの試験を、Mac を受け手にして回す: iPhone の撮影記録が AR モニター+マイク+HEVC フル HD の送りを動かし、Mac が受けて記録する。

  python place/shootlog/run_stream_test.py --mac-ip 100.x.x.x --seconds 127 --runs 3 --out work/_stream
前提: Mac で ~/sample_work/start_site.command(AR ページの配信 8480=http、8481=https(自己署名。iPhone の ATS が 100.x の http を拒むので https を使う))が動いている。Mac の ssh は pc3。iPhone は Mac から見えてロック解除。
1 回ごとに: Mac で受け手(pc_stream_receiver.py、ポート 9100)を起動 → iPhone のアプリを起動引数つきで起動(--auto-stream 秒)→ 終わったら iPhone の Documents/stream_summary.json と
Mac の受け手の summary.json・index.jsonl の要約を作業用 PC へ。熱(iPhone の最大)、受け手の fps・Mbps・欠け・遅れ、ARKit のコマ数、AR の姿勢の送りを 1 行ずつ出す。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

BUNDLE = "dev.hackathon.shootlog"
PATH = "export PATH=/opt/homebrew/bin:$PATH; "


def ssh(cmd, timeout=300):
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=10", "pc3", PATH + cmd], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return (r.stdout or "") + (r.stderr or "")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mac-ip", required=True)
    ap.add_argument("--seconds", type=int, default=127)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--gap", type=int, default=20)
    ap.add_argument("--kbps", type=int, default=18000)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--fps", type=int, default=30, help="AR を描く fps")
    ap.add_argument("--pc-fps", type=int, default=30, help="PC へ送る fps")
    ap.add_argument("--pr", type=float, default=1.0, help="AR の描画の解像度の倍率")
    ap.add_argument("--start-at", type=float, default=45.0)
    ap.add_argument("--lock-exposure", action="store_true")
    ap.add_argument("--no-ar", action="store_true")
    ap.add_argument("--no-mic", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="", help="機器の UDID(省略すると Mac の device_id.txt の iPhone)")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    dev = a.device or ssh("cat ~/sample_work/place_ios/device_id.txt").strip().splitlines()[-1]
    url = (f"app://app/place/web/ar_show.html?demo=1&scale=0.5&charheight=1.0&led_bottom=0&start_at={a.start_at}"
           f"&track=/show/data/ar/dance_track&fps={a.fps}&pr={a.pr}")
    results = []
    for k in range(1, a.runs + 1):
        label = f"run{k}"
        rxdir = f"~/sample_work/rx/{label}"
        ssh(f"rm -rf {rxdir} && mkdir -p {rxdir}")
        rx = subprocess.Popen(["ssh", "-o", "ConnectTimeout=10", "pc3", f"python3 ~/sample_work/rx/pc_stream_receiver.py --out {rxdir} --port 9100 --seconds {a.seconds + 45}"],
                              stdout=open(out / f"{label}_rx.log", "w"), stderr=subprocess.STDOUT)
        time.sleep(3)
        args = ["--auto-stream", str(a.seconds), "--exit-after-record", "--pc-on", "--pc-host", a.mac_ip, "--pc-port", "9100", "--pc-codec", "hevc",
                "--pc-width", str(a.width), "--pc-kbps", str(a.kbps), "--pc-fps", str(a.pc_fps)]
        if not a.no_ar:
            args += ["--ar-on", "--ar-url", url]
        if not a.no_mic:
            args += ["--mic-on"]
        if a.lock_exposure:
            args += ["--lock-exposure"]
        launch = ssh(f"xcrun devicectl device process launch --device {dev} --terminate-existing {BUNDLE} " + " ".join(f"'{x}'" for x in args) + " 2>&1 | tail -2")
        print(f"[{label}] 起動:", launch.strip().replace("\n", " | "))
        time.sleep(a.seconds + 12)
        ssh(f"rm -rf /tmp/ss_{label} && mkdir -p /tmp/ss_{label} && xcrun devicectl device copy from --device {dev} --domain-type appDataContainer --domain-identifier {BUNDLE} --source Documents/stream_summary.json --destination /tmp/ss_{label}/s.json >/dev/null 2>&1; true")
        ss = ssh(f"cat /tmp/ss_{label}/s.json 2>/dev/null")
        try:
            rx.wait(timeout=90)
        except subprocess.TimeoutExpired:
            rx.terminate()
        rs = ssh(f"cat {rxdir}/summary.json 2>/dev/null")
        (out / f"{label}_phone.json").write_text(ss, encoding="utf-8")
        (out / f"{label}_rx_summary.json").write_text(rs, encoding="utf-8")
        row = {"run": label}
        try:
            p = json.loads(ss)
            row.update({"seconds": round(p["seconds"], 1), "arkit_frames": p["arkitFrames"], "thermal_max": p["thermalMax"],
                        "ar_poses": (p.get("ar") or {}).get("posesSent"), "ar_skipped": (p.get("ar") or {}).get("posesSkipped"), "flashes": (p.get("ar") or {}).get("flashes"),
                        "ar_status": (p.get("ar") or {}).get("pageStatus"), "pc_sent": (p.get("pc") or {}).get("framesSent"), "pc_busy_skips": (p.get("pc") or {}).get("skippedBusy"),
                        "thermal_start": (p.get("ar") or {}).get("thermalAtStart") or (p.get("pc") or {}).get("thermalMax")})
        except Exception as e:
            row["phone_summary_error"] = str(e)
        try:
            r = json.loads(rs)
            row.update({"rx_frames": r.get("frames"), "rx_fps": r.get("fps"), "rx_mbps": r.get("mbps"), "rx_missing": r.get("seq_missing"),
                        "rx_latency_ms": r.get("latency_corrected_ms"), "rx_rtt_ms": (r.get("clock") or {}).get("rtt_median_ms"), "rx_audio": r.get("audio")})
        except Exception as e:
            row["rx_summary_error"] = str(e)
        print(json.dumps(row, ensure_ascii=False))
        results.append(row)
        if k < a.runs:
            time.sleep(a.gap)
    (out / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
