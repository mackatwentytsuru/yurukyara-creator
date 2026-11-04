"""UE 版の通しの録画: HackShow の入口のレベル(人型・縦長)が ① 録画の客を目で追う ② 文字の質問に答えて口が動く ③ 校正 ④ 校正後に同じ録画を追う。
前提: UE の窓が起動済み(kiosk/ue/run_entrance.ps1)。python -X utf8 kiosk/ue/run_ue_pass.py --pid <UE の PID> --out final
録画の客(rec20.mp4)と仮の幾何(nominal.json)は video_gaze.py make と calib_flow_pass.py が作る物(作業の場所は WEB を書き換える)。
鍵は利用者の環境変数から読み、表示・保存しない。"""
import argparse, json, os, subprocess, sys, time, urllib.request, winreg
from pathlib import Path

REPO = Path(r"repo")
WEB = Path(r"work_1105\web")
VG = REPO / "kiosk" / "tools" / "ue_link" / "video_gaze.py"
FACE = Path(r"work_1105\guest_face.png")
REC20 = WEB / "final" / "rec20.mp4"
NOMINAL = WEB / "calib_dry" / "nominal.json"
QUESTIONS = ["こんにちは、ここは何のお店ですか?", "今日はどんなショーがありますか?", "初めてでも楽しめますか?", "おすすめの楽しみ方を教えて"]


def user_env(name):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
        return winreg.QueryValueEx(k, name)[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pid", type=int, required=True)
    ap.add_argument("--out", default="final")
    ap.add_argument("--port", type=int, default=8841)
    ap.add_argument("--udp", type=int, default=5331)
    ap.add_argument("--frames", default=r"work\tmp_entrance_frames")
    a = ap.parse_args()
    out = Path(a.out).resolve(); out.mkdir(exist_ok=True)
    server = f"http://127.0.0.1:{a.port}"
    env = dict(os.environ, ANTHROPIC_API_KEY=user_env("CLAUDE_CREDIT_API_KEY_2"), SHOP_MEMORY_FILE=r"work\kiosk_memory\venue.json",
               CLAUDE_DAILY_CALL_CAP="3000", CLAUDE_PER_MINUTE="120", ELEVENLABS_API_KEY="", PORT=str(a.port), GAZE_UDP_PORT=str(a.udp))
    procs = []
    srv = subprocess.Popen(["node", "server/index.mjs"], cwd=REPO / "web", env=env, stdout=open(out / "server.log", "w"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    procs.append(srv)
    for _ in range(40):
        try:
            urllib.request.urlopen(server + "/api/gaze/now", timeout=1); break
        except OSError:
            time.sleep(0.5)
    relay = subprocess.Popen([sys.executable, "-X", "utf8", str(REPO / "kiosk" / "ue" / "gaze_to_ue.py"), "--server", server], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=open(out / "relay.err", "w"))
    procs.append(relay)
    cap = subprocess.Popen(["pwsh", "-NoProfile", "-File", r"work_1105\cap_loop.ps1", "-ProcId", str(a.pid), "-Dir", a.frames, "-Seconds", "300", "-IntervalMs", "66"],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    phases = []
    mark = lambda name: phases.append({"name": name, "unix_ms": int(time.time() * 1000)}) or print(name, flush=True)  # noqa: E731
    try:
        time.sleep(4)
        mark("A_follow_start")
        r = subprocess.run([sys.executable, "-X", "utf8", str(VG), "play", "--file", str(REC20), "--port", str(a.udp), "--geometry", str(NOMINAL),
                            "--log", str(out / "playA.jsonl")], capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
        (out / "playA.json").write_text(r.stdout.strip().splitlines()[-1], encoding="utf-8")
        mark("A_follow_end")
        time.sleep(1.5)
        stand = subprocess.Popen([sys.executable, "-X", "utf8", str(VG), "stand", "--face", str(FACE), "--x", "0.35", "--z", "2.0", "--seconds", "150", "--port", str(a.udp),
                                  "--geometry", str(NOMINAL)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
        time.sleep(3)
        mark("B_talk_start")
        subprocess.run([sys.executable, "-X", "utf8", str(REPO / "kiosk" / "ue" / "entrance_talk.py"), "--server", server, "--log", str(out / "talk.jsonl"), "--gap", "1.2", *QUESTIONS],
                       stdin=subprocess.DEVNULL, stdout=open(out / "talk.out", "w", encoding="utf-8"), stderr=subprocess.STDOUT)
        mark("B_talk_end")
        stand.terminate(); stand.wait()
        time.sleep(1.5)
        mark("C_calib_start")
        subprocess.run([sys.executable, "-X", "utf8", str(Path(__file__).resolve().parent / "calib_flow_pass.py"), "--server", server, "--udp", str(a.udp), "--out", str(out / "calib"), "--hold", "6"],
                       check=True, stdin=subprocess.DEVNULL, cwd=WEB, stdout=open(out / "calib.out", "w", encoding="utf-8"), stderr=subprocess.STDOUT)
        mark("C_calib_end")
        time.sleep(1.5)
        mark("D_follow_start")
        r = subprocess.run([sys.executable, "-X", "utf8", str(VG), "play", "--file", str(REC20), "--port", str(a.udp), "--geometry", str(out / "calib" / "fitted.json"),
                            "--log", str(out / "playD.jsonl")], capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
        (out / "playD.json").write_text(r.stdout.strip().splitlines()[-1], encoding="utf-8")
        mark("D_follow_end")
        time.sleep(2)
    finally:
        (out / "phases.json").write_text(json.dumps(phases, indent=1), encoding="utf-8")
        cap.terminate()
        for p in procs:
            p.terminate()
    print((out / "playA.json").read_text(), (out / "playD.json").read_text())


if __name__ == "__main__":
    main()
