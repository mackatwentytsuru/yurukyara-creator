"""リアルタイムの一式を起動する。signalling → UE(-game)→(試しなら)送り手とブラウザ。止めるのは自分の PID だけ。

  試し(測って閉じる): python run_live.py try --out <記録のフォルダ> --seconds 30 [--res 1280x720] [--max-fps 60]
  本番(端末から見る): python run_live.py serve --out <記録のフォルダ> --lan --start-pos 130 1500 170 [--media <mp4>]
  別の機械では --ue-exe --project --ddc --media で場所を変える。
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
UE_EXE = "C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe"
PROJECT = "work/ue_show/HackShow_live/HackShow.uproject"
DDC = "work/ue_show/DDC"
LEVEL = "/Game/Show/L_Live"
DEFAULT_MEDIA = "work/ue_show/show_build/song1/video/preview.mp4"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
PLAYER_PORT, STREAMER_PORT, UDP_PORT = 8080, 8888, 9000
READY_TIMEOUT_SEC = 240


def kill_tree(process, name):
    """自分で起動した PID だけを止める。"""
    if process.poll() is None:
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    print(f"stopped {name} pid {process.pid}", flush=True)


def ue_command(args, out, config_path):
    width, height = args.res.split("x")
    commands = [f"t.MaxFPS {args.max_fps}", "r.VSync 0", f"py {HERE.as_posix()}/live_camera.py"]
    command = [args.ue_exe, args.project, LEVEL, "-game", "-windowed", f"-ResX={width}", f"-ResY={height}", "-ForceRes",
               "-RenderOffScreen", "-nosplash", "-nosound", "-log", f"-abslog={out.as_posix()}/ue.log",
               "-ddc=InstalledNoZenLocalFallback", f"-LocalDataCachePath={args.ddc}",
               f"-PixelStreamingConnectionURL=ws://127.0.0.1:{STREAMER_PORT}",
               "-PixelStreamingEncoderCodec=H264", "-PixelStreamingEncoderLatencyMode=ULTRA_LOW_LATENCY",
               # 目標を固定すると、回線の見積りが上がるまで送り待ちの列が伸びて遅れる。見積りの始めを高くする
               f"-PixelStreamingWebRTCStartBitrate={args.bitrate}", f"-PixelStreamingWebRTCMaxBitrate={args.bitrate * 2}",
               "-PixelStreamingWebRTCDisableTransmitAudio", "-PixelStreamingWebRTCDisableReceiveAudio",
               "-PixelStreamingWebRTCDisableReceiveVideo",
               "-ExecCmds=" + ", ".join(commands)]
    env = dict(os.environ, LIVE_CONFIG=str(config_path))
    return command, env


def wait_for_streamer(log_path, process, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"UE が終わった: 終了コード {process.returncode}")
        if log_path.exists() and "LIVE_READY" in log_path.read_text(encoding="utf-8", errors="ignore"):
            return
        time.sleep(1)
    raise RuntimeError("UE の用意が時間内に終わらない")


def show_ue_lines(log_path):
    for line in log_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if any(key in line for key in ("LIVE_", "LogPython: Error", "LogPixelStreaming2: Error")):
            print(line[:300], flush=True)


def run_try(args, out):
    sender = subprocess.Popen([sys.executable, str(HERE / "fake_phone_udp.py"), "--port", str(UDP_PORT), "--rate", str(args.rate),
                               "--seconds", str(args.seconds), "--hold-after", str(args.seconds - args.hold),
                               "--size", args.phone_size,
                               "--log", str(out / "sent.jsonl")])
    profile = tempfile.mkdtemp(prefix="live_chrome_")
    # 送り手の起動のほうが遅れることがあるので、最後の絵は送り手が止まる間際より後に撮る
    shot_times = f"{args.seconds * 0.4:.0f},{args.seconds + 2:.0f}"
    chrome = subprocess.Popen([CHROME, "--headless=new", "--use-angle=d3d11", "--ignore-gpu-blocklist", f"--user-data-dir={profile}",
                               "--no-first-run", "--autoplay-policy=no-user-gesture-required",
                               "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                               "--disable-backgrounding-occluded-windows", "--window-size=1280,720",
                               f"http://127.0.0.1:{PLAYER_PORT}/?shots={shot_times}"])
    print(f"sender pid {sender.pid} chrome pid {chrome.pid}", flush=True)
    try:
        if args.ctl_test:
            time.sleep(args.seconds - args.hold + 0.5)
            for command in (["recenter", "--pos", "0", "730", "60", "--yaw", "-90"], ["media", "--seconds", "3"]):
                subprocess.run([sys.executable, str(HERE / "live_ctl.py")] + command, check=True)
        sender.wait(timeout=args.seconds + 30)
        time.sleep(6)  # ページの最後の絵と記録を待つ
    finally:
        kill_tree(sender, "sender")
        kill_tree(chrome, "chrome")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["try", "serve"])
    parser.add_argument("--out", required=True)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--hold", type=float, default=6.0, help="最後にカメラを止める秒(絵と計算を比べる)")
    parser.add_argument("--rate", type=float, default=60.0)
    parser.add_argument("--res", default="1280x720", help="端末の画像と同じ縦横比にする(4:3 なら 1280x960)")
    parser.add_argument("--phone-size", default="1920x1080", help="試しの送り手の画像の大きさ")
    parser.add_argument("--max-fps", type=int, default=60)
    parser.add_argument("--bitrate", type=int, default=10000000)
    parser.add_argument("--media", default=DEFAULT_MEDIA)
    parser.add_argument("--ue-exe", default=UE_EXE)
    parser.add_argument("--project", default=PROJECT)
    parser.add_argument("--ddc", default=DDC)
    parser.add_argument("--start-pos", nargs=3, type=float, help="最初の 1 コマを UE のこの位置 cm にする(実機のとき)")
    parser.add_argument("--start-yaw", type=float, default=-90.0)
    parser.add_argument("--ctl-test", action="store_true", help="試しの途中で recenter と media の命令を送る")
    parser.add_argument("--lan", action="store_true", help="端末から受ける(ファイアウォールの許可が要る)")
    parser.add_argument("--serve-minutes", type=float, default=30.0)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "ue_stats.jsonl").unlink(missing_ok=True)
    bind = "0.0.0.0" if args.lan else "127.0.0.1"
    config_path = out / "live_config.json"
    config_path.write_text(json.dumps({"udp_bind": bind, "udp_port": UDP_PORT, "media": args.media,
                                       "auto_recenter": {"pos": args.start_pos, "yaw": args.start_yaw} if args.start_pos else None,
                                       "stats_path": (out / "ue_stats.jsonl").as_posix()}), encoding="utf-8")
    server = subprocess.Popen([sys.executable, str(HERE / "signalling.py"), "--bind", bind, "--out", str(out),
                               "--player-port", str(PLAYER_PORT), "--streamer-port", str(STREAMER_PORT)],
                              stdout=open(out / "signalling.log", "w"), stderr=subprocess.STDOUT)
    print(f"signalling pid {server.pid}", flush=True)
    time.sleep(1.5)
    command, env = ue_command(args, out, config_path)
    ue = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"ue pid {ue.pid}", flush=True)
    started = time.time()
    try:
        wait_for_streamer(out / "ue.log", ue, READY_TIMEOUT_SEC)
        print(f"ue ready after {time.time() - started:.0f}s", flush=True)
        time.sleep(3)
        if args.mode == "try":
            run_try(args, out)
        else:
            print(f"ready: 端末の Safari で http://<この機械の IP>:{PLAYER_PORT}/ UDP {UDP_PORT}", flush=True)
            ue.wait(timeout=args.serve_minutes * 60)
    except subprocess.TimeoutExpired:
        print("時間になったので閉じる", flush=True)
    finally:
        kill_tree(ue, "ue")
        kill_tree(server, "signalling")
        if (out / "ue.log").exists():
            show_ue_lines(out / "ue.log")


if __name__ == "__main__":
    main()
