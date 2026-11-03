"""撮影の通しのリハーサル: iPad と同じ画角の仮想カメラで、カットごとに UE の会場を歩いて録る。

  python place/shootlog/scout/rehearsal.py cuts --out <フォルダ> --media <ショーの映像>   # カットの候補を録る
  python place/shootlog/scout/rehearsal.py dots --out <フォルダ> --media <点の映像>       # 点の映像を LED に流して定位置から録る
  python place/shootlog/scout/rehearsal.py sheet --out <フォルダ> --sheet <1 枚の絵> --movie <通しの動画>
UE は show/live/ の仕組み(L_Live)をそのまま使い、show/ のファイルは変えない。UE の札を取ってから流す。
座標は show/ue/stage_layout.py と同じ(cm、x 右、y 客席、z 上)。カメラの動きは show/live/live_math.py の形の UDP で送る。
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path[:0] = [str(HERE), str(REPO / "show" / "live"), str(REPO / "show" / "ue")]
import run_live  # noqa: E402
from live_math import axes_to_T, rotator_axes  # noqa: E402
from stage_path import ar_at, on_led  # noqa: E402

W4K, H4K = 3840, 2160
FX = {"wide": 3065.0, "zoom": 6130.0, "ultra": 1478.0}     # iPad の実測(4K の画素)。zoom は広角の中央を 2 倍に切り出した形
LENS_JP = {"wide": "広角", "zoom": "広角 寄り 2 倍", "ultra": "超広角 固定"}
UDP = ("127.0.0.1", run_live.UDP_PORT)
RES = "1920x1080"
STAGE = json.loads((REPO / "show" / "show_stage.json").read_text(encoding="utf-8"))
LED_MIDDLE = (0.0, 0.0, 330.0)
CHAR_Z = 185.0      # 舞台の上のキャラの胸のあたり

def at(kind, index, offset):
    """ショーの秒は show_stage.json の flashes から読む(曲が変わると時刻が変わるので、値を写さない)。kind は out か back。"""
    return [f["t"] for f in STAGE["flashes"] if f["kind"] == kind][index] + offset


# 候補のカット。start はショーの秒、keys は [カットの中の秒, 位置 cm]、look は "char"(キャラを追う)か座標
CUTS = [
    dict(no=1, name="全景 正面 13 m", lens="ultra", start=at("out", 0, -3.8), sec=15.0, keys=[(0, (0, 1300, 170))], look=LED_MIDDLE, walk="置いたまま"),
    dict(no=2, name="全景 下手 斜め", lens="ultra", start=at("out", 0, 1.0), sec=12.0, keys=[(0, (-600, 1200, 170))], look=(100, 0, 330), walk="置いたまま"),
    dict(no=3, name="正面 引き 出てくる", lens="wide", start=at("out", 0, -2.8), sec=12.0, keys=[(0, (0, 1300, 170))], look=LED_MIDDLE, walk="立ったまま"),
    dict(no=4, name="前へ歩く 13→8 m", lens="wide", start=at("out", 0, -1.8), sec=13.0, keys=[(0, (0, 1300, 170)), (2, (0, 1300, 170)), (12, (0, 800, 160))], look="char", walk="中央をまっすぐ前へ 5 m"),
    dict(no=5, name="正面 寄り 上半身", lens="zoom", start=at("out", 0, 3.2), sec=9.0, keys=[(0, (0, 1000, 170))], look="char", walk="立ったまま追う"),
    dict(no=6, name="上手へ回る 踊りを追う", lens="wide", start=at("out", 0, 4.2), sec=10.5, keys=[(0, (500, 1100, 160)), (10, (150, 800, 150))], look="char", walk="上手の斜めから中央へ"),
    dict(no=7, name="下手から弧", lens="wide", start=at("out", 0, 1.0), sec=12.0, keys=[(0, (-600, 1000, 160)), (11, (-150, 700, 150))], look="char", walk="下手の斜めから中央へ"),
    dict(no=8, name="上手へ歩いて LED へ戻る", lens="wide", start=at("back", 0, -5.0), sec=8.0, keys=[(0, (100, 800, 170))], look="char", walk="立ったまま追う"),
    dict(no=9, name="近く 低く 暗い場面", lens="wide", start=at("out", 1, 2.4), sec=10.0, keys=[(0, (0, 650, 110)), (9, (0, 560, 100))], look="char", walk="舞台の前でしゃがみ気味に"),
    dict(no=10, name="舞台の前を横に 暗い場面", lens="wide", start=at("out", 1, 3.4), sec=12.0, keys=[(0, (-300, 680, 150)), (11, (300, 680, 150))], look="char", walk="舞台の前を下手から上手へ 6 m"),
    dict(no=11, name="LED へ戻る", lens="wide", start=at("back", 1, -5.4), sec=9.0, keys=[(0, (0, 800, 170))], look=LED_MIDDLE, walk="立ったまま"),
]
# 点の答え合わせの定位置: 名前, レンズ, 位置, 向く先, 手ぶれ
STATIONS = [
    ("正面 13 m", "wide", (0, 1300, 170), LED_MIDDLE, False),
    ("正面 13 m 手持ち", "wide", (0, 1300, 170), LED_MIDDLE, True),
    ("正面 10 m", "wide", (0, 1000, 170), LED_MIDDLE, False),
    ("正面 8 m", "wide", (0, 800, 170), LED_MIDDLE, False),
    ("正面 6 m", "wide", (0, 600, 170), LED_MIDDLE, False),
    ("下手 斜め 13 m", "wide", (-600, 1200, 150), LED_MIDDLE, False),
    ("上手 斜め 13 m", "wide", (600, 1200, 150), LED_MIDDLE, False),
    ("超広角 正面 13 m", "ultra", (0, 1300, 170), LED_MIDDLE, False),
    ("超広角 正面 8 m", "ultra", (0, 800, 170), LED_MIDDLE, False),
    ("超広角 下手 斜め", "ultra", (-600, 1200, 170), (100, 0, 330), False),
]
DOT_SECONDS = 36.0     # 点の映像 1 本(緑の明るさ 3 段)
FLASH_SEC = 0.12       # リハーサルの映像の、出る・戻るの光の長さ
SHAKE_CM, SHAKE_DEG, SHAKE_HZ = 1.0, 0.15, 0.3


def smooth(k):
    k = min(max(k, 0.0), 1.0)
    return k * k * (3 - 2 * k)


def position_at(keys, t):
    if t <= keys[0][0]:
        return tuple(float(v) for v in keys[0][1])
    for (ta, a), (tb, b) in zip(keys, keys[1:]):
        if t < tb:
            k = smooth((t - ta) / (tb - ta))
            return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))
    return tuple(float(v) for v in keys[-1][1])


def char_point(show_t):
    x, y, _ = ar_at(STAGE["ar_path"], show_t)
    if on_led(STAGE, show_t):
        return (x, -100.0, 330.0)     # LED の中にいる間は、LED の中央のあたりを見る
    return (x, y, CHAR_Z)


def look_axes(pos, target, roll=0.0, extra_yaw=0.0, extra_pitch=0.0):
    dx, dy, dz = (target[i] - pos[i] for i in range(3))
    yaw = math.degrees(math.atan2(dy, dx)) + extra_yaw
    pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy))) + extra_pitch
    return rotator_axes(pitch, yaw, roll)


def pose_message(pos, axes, lens, t):
    forward, right, up = axes
    T = axes_to_T(pos, forward, right, up)
    fx = FX[lens]
    return {"t": t, "T": T, "K": [fx, fx, W4K / 2, H4K / 2], "w": W4K, "h": H4K, "ok": True}


class PoseSender(threading.Thread):
    """30 回/秒で姿勢を送り続ける。fn(経過秒) → 姿勢の dict。"""

    def __init__(self):
        super().__init__(daemon=True)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.fn = None
        self.t0 = time.time()
        self.alive = True

    def aim(self, fn):
        self.fn, self.t0 = fn, time.time()

    def command(self, message):
        self.sock.sendto(json.dumps(message).encode("utf-8"), UDP)

    def run(self):
        while self.alive:
            if self.fn:
                self.sock.sendto(json.dumps(self.fn(time.time() - self.t0)).encode("utf-8"), UDP)
            time.sleep(1 / 30)


RECORDER_JS = """
window.__rec = { chain: Promise.resolve(), r: null };
window.__startRec = (bps) => {
  const s = document.getElementById('video').srcObject;
  const r = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: bps });
  r.ondataavailable = (e) => {
    if (!e.data.size) return;
    window.__rec.chain = window.__rec.chain.then(async () => {
      const b = new Uint8Array(await e.data.arrayBuffer());
      let text = '';
      for (let i = 0; i < b.length; i += 32768) text += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
      await window.saveChunk(btoa(text));
    });
  };
  r.start(1000);
  window.__rec.r = r;
  return performance.now();
};
window.__stopRec = () => new Promise((done) => {
  const r = window.__rec.r;
  r.onstop = () => { window.__rec.chain.then(() => done(true)); };
  r.stop();
});
true;
"""


class Stage:
    """UE と取り次ぎと Chrome を起動して、録れる状態にする。止めるのは自分で起動した PID だけ。"""

    def __init__(self, out: Path, media: str, hide_character: bool):
        self.out, self.media, self.hide = out, media, hide_character
        self.sender = PoseSender()
        self.chunk_file = None

    def __enter__(self):
        try:
            return self._start()
        except BaseException:      # 途中で失敗しても、自分で起動した物を残さない
            self.__exit__()
            raise

    def _start(self):
        out = self.out
        out.mkdir(parents=True, exist_ok=True)
        stage = dict(STAGE)
        if self.hide:
            stage["led_character"] = [[0.0, 1e9]]    # いつも「LED の中」にして、舞台の上に出さない
        config = out / "live_config.json"
        config.write_text(json.dumps({"udp_bind": "127.0.0.1", "udp_port": run_live.UDP_PORT, "media": self.media, "character": "sample_show", "start_sec": None,
                                      "stage": stage, "auto_recenter": None, "stats_path": (out / "ue_stats.jsonl").as_posix()}), encoding="utf-8")
        self.server = subprocess.Popen([sys.executable, str(REPO / "show" / "live" / "signalling.py"), "--bind", "127.0.0.1", "--out", str(out),
                                        "--player-port", str(run_live.PLAYER_PORT), "--streamer-port", str(run_live.STREAMER_PORT)],
                                       stdout=open(out / "signalling.log", "w"), stderr=subprocess.STDOUT)
        time.sleep(1.5)
        args = argparse.Namespace(res=RES, max_fps=30, ue_exe=run_live.UE_EXE, project=run_live.PROJECT, ddc=run_live.DDC, bitrate=24000000)
        command, env = run_live.ue_command(args, out, config)
        self.ue = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"UE pid {self.ue.pid} 取り次ぎ pid {self.server.pid}", flush=True)
        run_live.wait_for_streamer(out / "ue.log", self.ue, run_live.READY_TIMEOUT_SEC)
        time.sleep(5)     # すぐつなぐと、UE が接続の知らせを受け落とす(run_live.py も待っている)
        self.sender.start()
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(channel="chrome", headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
                                                                                     "--disable-background-timer-throttling", "--disable-renderer-backgrounding"])
        self.page = self.browser.new_page(viewport={"width": 1280, "height": 720})
        self.page.expose_function("saveChunk", self._save_chunk)
        self.page.goto(f"http://127.0.0.1:{run_live.PLAYER_PORT}/")
        self.page.evaluate(RECORDER_JS)
        self.sender.aim(lambda t: pose_message((0, 1300, 170), look_axes((0, 1300, 170), LED_MIDDLE), "wide", t))
        self.page.wait_for_function("document.getElementById('video').videoWidth > 0", timeout=120000)
        print("絵が届いた", self.page.evaluate("[document.getElementById('video').videoWidth, document.getElementById('video').videoHeight]"), flush=True)
        return self

    def _save_chunk(self, text):
        self.chunk_file.write(base64.b64decode(text))

    def record(self, path: Path, seconds: float):
        """path に録る。録り始めの時刻(秒)を返す。"""
        self.chunk_file = open(path, "wb")
        started = time.time()
        self.page.evaluate("(bps) => window.__startRec(bps)", 20000000)
        self.page.wait_for_timeout(int(seconds * 1000))
        self.page.evaluate("window.__stopRec()")
        self.chunk_file.close()
        return started

    def last_sync(self):
        text = (self.out / "ue.log").read_text(encoding="utf-8", errors="ignore")
        found = re.findall(r"LIVE_SYNC ([0-9.]+)", text)
        return len(found), float(found[-1]) if found else None

    def seek(self, seconds: float):
        """ショーをその秒へ。キャラの動きが映像に合ったのを見て戻る(長くても 8 秒)。"""
        before, _ = self.last_sync()
        self.sender.command({"cmd": "media", "seconds": seconds})
        end = time.time() + 8
        while time.time() < end:
            self.page.wait_for_timeout(200)
            count, value = self.last_sync()
            if count > before and value is not None and abs(value - seconds) < 4:
                return value
        return None

    def __exit__(self, *exc):
        self.sender.alive = False
        for name in ("browser", "pw"):
            thing = getattr(self, name, None)
            if thing is None:
                continue
            try:
                thing.close() if name == "browser" else thing.stop()
            except Exception as e:  # noqa: BLE001
                print("閉じるときの知らせ:", e, flush=True)
        if getattr(self, "ue", None):
            run_live.kill_tree(self.ue, "ue")
        if getattr(self, "server", None):
            run_live.kill_tree(self.server, "signalling")


def to_cfr(src: Path, dst: Path):
    """録画(コマの間隔が揺れる webm)を 30 fps の mp4 にする。時間は保つ。"""
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", "fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-threads", "6", "-an", str(dst)], check=True)
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(src)], capture_output=True, text=True)
    return int(r.stdout.strip().strip(",") or 0)


def run_cuts(a):
    out = Path(a.out)
    only = {int(v) for v in a.only.split(",")} if a.only else None
    rows = []
    with Stage(out, a.media, hide_character=False) as st:
        for cut in CUTS:
            if only and cut["no"] not in only:
                continue
            start, keys, look, lens = cut["start"], cut["keys"], cut["look"], cut["lens"]

            def pose(t, keys=keys, look=look, lens=lens, start=start):
                pos = position_at(keys, t)
                target = char_point(start + t) if look == "char" else look
                # 手持ちの小さな揺れ(広角だけ。超広角は置いたまま)
                wob = 0.0 if lens == "ultra" else 0.25
                return pose_message(pos, look_axes(pos, target, roll=wob * math.sin(t * 1.3), extra_yaw=wob * math.sin(t * 0.9), extra_pitch=wob * math.sin(t * 1.7)), lens, t)

            st.sender.aim(lambda t, pose=pose: pose(0.0))
            got = st.seek(start)
            st.sender.aim(pose)
            raw = out / f"cut_{cut['no']:02d}.webm"
            st.record(raw, cut["sec"])
            frames = to_cfr(raw, out / f"cut_{cut['no']:02d}.mp4")
            rows.append({"no": cut["no"], "seek_seen": got, "frames_recorded": frames, "sec": cut["sec"]})
            print(f"カット {cut['no']} {cut['name']}: 映像 {got} 秒から、録れた {frames} コマ / {cut['sec']} 秒", flush=True)
    (out / "cuts_result.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


def run_dots(a):
    out = Path(a.out)
    only = {int(v) for v in a.only.split(",")} if a.only else None
    rows = []
    with Stage(out, a.media, hide_character=True) as st:
        for i, (name, lens, pos, target, shake) in enumerate(STATIONS):
            if only and i not in only:
                continue

            def pose(t, pos=pos, target=target, lens=lens, shake=shake):
                return station_pose(pos, target, lens, shake, t)

            st.sender.aim(pose)
            st.page.wait_for_timeout(1500)
            raw = out / f"dots_{i:02d}.webm"
            sender_t0 = st.sender.t0
            started = st.record(raw, a.dot_seconds)
            frames = to_cfr(raw, out / f"dots_{i:02d}.mp4")
            rows.append({"i": i, "name": name, "lens": lens, "pos": pos, "target": target, "shake": shake, "offset": started - sender_t0, "frames": frames})
            print(f"定位置 {i} {name}: {frames} コマ", flush=True)
    (out / "dots_stations.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


def make_media(a):
    """リハーサルの LED の映像: show_stage.json の led_character の間だけキャラあり、外はキャラなし、出る・戻るの秒に短い光。
    UE の映像の読み取りは 5680 幅の H264 を読めず、音の線があると絵が進まないので、2840×620・30p・音なしにする。"""
    inside = "+".join(f"between(t,{x},{y})" for x, y in STAGE["led_character"])
    flash = "+".join(f"between(t,{f['t']},{f['t'] + FLASH_SEC})" for f in STAGE["flashes"])
    length = max(y for _, y in STAGE["led_character"]) + 5
    graph = (f"[1:v]scale=2840:620:flags=area,fps=30[bg];[0:v]scale=2840:620:flags=area,fps=30[fg];"
             f"[bg][fg]overlay=enable='{inside}'[m];color=white:s=2840x620:r=30[w];[m][w]overlay=enable='{flash}':shortest=1[v]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-t", str(length), "-i", a.with_char, "-t", str(length), "-i", a.without_char, "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
                    "-level", "4.2", "-g", "30", "-pix_fmt", "yuv420p", "-threads", "6", str(Path(a.out))], check=True)
    print("作った:", a.out, "長さ", length)


def station_pose(pos, target, lens, shake, t):
    if not shake:
        return pose_message(pos, look_axes(pos, target), lens, t)
    w = 2 * math.pi * SHAKE_HZ * t
    moved = (pos[0] + SHAKE_CM * math.sin(w), pos[1], pos[2] + SHAKE_CM * math.sin(1.3 * w))
    return pose_message(moved, look_axes(moved, target, extra_yaw=SHAKE_DEG * math.sin(0.7 * w), extra_pitch=SHAKE_DEG * math.cos(w)), lens, t)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["cuts", "dots", "sheet", "media"])
    ap.add_argument("--with-char", help="media: キャラありの映像")
    ap.add_argument("--without-char", help="media: キャラなしの映像")
    ap.add_argument("--out", required=True)
    ap.add_argument("--media")
    ap.add_argument("--only", help="カットの番号(dots は定位置の番号)をカンマで")
    ap.add_argument("--dot-seconds", type=float, default=DOT_SECONDS)
    ap.add_argument("--sheet")
    ap.add_argument("--movie")
    a = ap.parse_args()
    if a.mode == "media":
        make_media(a)
    elif a.mode == "cuts":
        run_cuts(a)
    elif a.mode == "dots":
        run_dots(a)
    else:
        from rehearsal_sheet import make_sheet
        make_sheet(a, CUTS, FX, LENS_JP)


if __name__ == "__main__":
    main()
