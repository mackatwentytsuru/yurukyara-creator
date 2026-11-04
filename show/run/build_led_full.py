"""LED の全編を 1 行で作る: 背景のループ → UE のキャラの層 → 層の後始末 → 頭(待ち・同期) → 重ね → 原版 → 書き出し → 確認シート → 検査。

使い方(曲が来た日もこの 1 行。秒は全部 timeline・stage・cues から読む):
  python build_led_full.py --timeline <timeline.json> --stage <show_stage.json> --cues <cues.json> \\
      --closed <閉じた緞帳の png か動画> --open <開いた世界の png か動画> --character sample_show60 \\
      --version sample3_3 --out <作業の置き場>

- 段ごとに、できた物は飛ばす(入力の指紋が同じなら)。途中で止まっても、同じ 1 行で続きから流れる。
  やり直すときは --redo <段の名前 ...>。段: bg ue post head body master deliver sheet check。
- 背景の差し替えは --closed か --open を替えるだけ。背景で決まる段(bg body master deliver sheet check)だけが動き、
  キャラの層と頭は使い回す(背景ごとの作業は <out>/body/<指紋> に分かれる)。
- キャラだけ撮り直すときは --character を替える(ue post body 以降が動く)。
- 動画の背景が区間より短いときは、頭と尾を重ねて継ぎ目の見えないループにする(--loop-blend コマ)。
- 試し: --scale 0.125 --every 4 で、小さな絵と間引きで最後まで通す。--skip-ue はキャラの層を撮らない(層の予定だけ書く)。
- 重い段は札で包む(--no-lock で外す)。UE の資産を保存する段の間だけ、組み立ての印のフォルダを取る。

出力(<out> の中):
  plan.json  stages.json(段ごとの秒と容量)  layers/  head/  body/<指紋>/master.mov(原版 ProRes)
  出す物/<version>_全編_キャラあり_5680x1240_H264.mp4(音あり)  出す物/<version>_UE再生用_2840x620_音なし_H264.mp4
  出す物/<version>_確認シート.jpg  check.json
"""
import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHOW = HERE.parent
sys.path[:0] = [str(SHOW / "ue"), str(SHOW / "fx")]
import led_plan  # noqa: E402

PY = sys.executable
LOCK_TOOL = "machine_lock.py"
WHO = "ハッカソン|キャラクターショー"
SESSION_TAG = os.environ.get("SHOW_SESSION_TAG", "s:2bfec9e0")
BUILD_LOCK = Path("work/ue_show/_ue_build_lock_HackShow")
BUILD_LOCK_WAIT_SEC = 600
UE_ATTEMPTS = 3
LOCK_TOOL_BUSY = 72  # 札の道具の mutex が取れないときの終了コード(命令は動いていない)
LOCK_RETRIES = 5
QUIET_SEC = 300  # 層のレベルの撮影がこの秒だけ続けて無ければ、組み直してよい
CANVAS = (5680, 1240)
UE_PLAY = (2840, 620)
STAGES = ["bg", "ue", "post", "head", "tail", "body", "master", "deliver", "sheet", "check"]
CHUNK_SEC = 20.0  # 重ねの 1 区切り(原寸で約 8 分。1 区切りごとに札を取り直す)
PRORES = ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0", "-color_primaries", "bt709",
          "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"]
UE_LAYER_SEC_PER_FRAME = 0.22  # 札の分の見込み(実測 0.20〜0.22)


def log(*parts):
    print(time.strftime("%H:%M:%S"), *parts, flush=True)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")


def file_mark(path):
    """ファイルの指紋の元(名前・大きさ・時刻)。中身を全部読まない。"""
    if path is None:
        return None
    p = Path(path)
    stat = p.stat()
    return [p.resolve().as_posix(), stat.st_size, int(stat.st_mtime)]


def finger(*values):
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()[:10]


def folder_bytes(path):
    p = Path(path)
    if p.is_file():
        return p.stat().st_size
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def is_video(path):
    return Path(path).suffix.lower() not in (".png", ".jpg", ".jpeg")


def probe_frames(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    try:
        return int(out.stdout.strip().split(",")[0])
    except ValueError:
        return -1


def ffmpeg(*args, timeout=3600):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True, stdin=subprocess.DEVNULL, timeout=timeout)


class Builder:
    def __init__(self, args):
        self.args = args
        self.out = Path(args.out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.timeline = read_json(args.timeline)
        self.stage = read_json(args.stage)
        self.fps = int(self.timeline["fps"])
        self.frames = int(self.timeline["frames"])
        self.audio = Path(args.audio) if args.audio else Path(args.timeline).with_name("show_mix.wav")
        self.every = max(1, args.every)
        self.quick = args.scale != 1.0 or self.every != 1
        self.size = (int(round(CANVAS[0] * args.scale)), int(round(CANVAS[1] * args.scale)))  # compose_led と同じ式
        self.stages_path = self.out / "stages.json"
        self.records = read_json(self.stages_path) if self.stages_path.exists() else {}
        self.deliver_dir = self.out / "出す物"
        self.input_mark = {"timeline": file_mark(args.timeline), "stage": file_mark(args.stage), "cues": file_mark(args.cues)}
        self.plan = self.make_plan()
        write_json(self.out / "plan.json", self.plan)
        self.bg_key = finger(file_mark(args.closed), file_mark(args.open), args.loop_blend, args.scale, self.every,
                             self.input_mark, args.character, args.skip_ue, file_mark(args.bulbs), file_mark(args.plates and Path(args.plates) / "warp_open.npy"))
        self.body_dir = self.out / "body" / self.bg_key
        self.master = self.body_dir / "master.mov"

    # ---- 予定(秒は全部 timeline・stage から) ----
    def make_plan(self):
        import fx_plan
        timeline, stage, fps = self.timeline, self.stage, self.fps
        plan = fx_plan.FxPlan(timeline, stage, [], read_json(self.args.cues) if self.args.cues else None)
        body_start, body_end = plan.body_range()
        spans = led_plan.character_spans(timeline, stage)
        layers = []
        for index, (a, b) in enumerate(spans):
            for kind in ("char", "reflect", "shadow"):
                layers.append([kind, f"{kind}_{index}", round(a, 6), round(b, 6)])
        monitors = [(float(m["on"]), float(m["off"])) for m in stage["monitors"]]
        if monitors:
            layers.append(["close", "close", min(a for a, _ in monitors), max(b for _, b in monitors)])
        calib = next((s for s in timeline["sections"] if s["id"] == "calib"), None)
        chunk = int(round(CHUNK_SEC * fps)) // self.every * self.every
        first, last = int(round(body_start * fps)), int(round(body_end * fps))
        chunks = [[a, min(a + chunk, last)] for a in range(first, last, chunk)]
        crossings = [{"kind": c["kind"], "t": float(c["t"])} for c in stage["flashes"]]
        return {"fps": fps, "frames": self.frames, "duration_sec": self.frames / fps,
                "head": [0, first], "body": [first, last], "tail": [last, self.frames],
                "body_sec": [body_start, body_end], "character_spans": spans, "layers": layers,
                "monitors": monitors, "crossings": crossings, "curtain": plan.curtain_events(), "landings": plan.land_times,
                "calib": [calib["start"], calib["end"]] if calib else None, "chunks": chunks,
                "scale": self.args.scale, "every": self.every, "size": list(self.size), "character": self.args.character,
                "inputs": self.input_mark, "closed": str(self.args.closed), "open": str(self.args.open)}

    # ---- 共通 ----
    def locked(self, kind, minutes, job, command, timeout=3600):
        if self.args.no_lock:
            full = command
        else:
            full = [PY, LOCK_TOOL, "run", "--machine", "pc1", "--kind", kind, "--who", WHO, "--job", f"{job} {SESSION_TAG}",
                    "--minutes", str(max(1, int(math.ceil(minutes)))), "--wait", str(self.args.lock_wait), "--no-table", "--", *command]
        log("動かす:", kind, job)
        for _ in range(LOCK_RETRIES):
            result = subprocess.run(full, stdin=subprocess.DEVNULL, timeout=timeout)
            if result.returncode != LOCK_TOOL_BUSY or self.args.no_lock:
                break
            log("札の道具の排他が取れなかった(終了コード 72)。30 秒後に取り直す")
            time.sleep(30)
        if result.returncode != 0:
            raise RuntimeError(f"{job} が終了コード {result.returncode} で止まった")

    def done_path(self, stage):
        return self.out / "done" / f"{stage}.json"

    def load_done(self, stage):
        """済みの印 {"current": 記録, "history": {指紋: 記録}}。古い形(記録だけ)も読む。"""
        path = self.done_path(stage)
        if not path.exists():
            return {"current": None, "history": {}}
        data = read_json(path)
        if "history" not in data:
            data = {"current": data, "history": {data["key"]: data}}
        return data

    def current(self, stage):
        """今の流しで使った(済みと確かめた)記録。下流の指紋に入れる。"""
        return self.load_done(stage)["current"]

    def is_done(self, stage, key):
        """この指紋で済んでいれば True。背景を替えて戻したときも、前の指紋の記録が残っていれば飛ばす。"""
        data = self.load_done(stage)
        record = data["history"].get(key)
        if record is None or stage in self.args.redo:
            return False
        data["current"] = record
        write_json(self.done_path(stage), data)
        return True

    def mark_done(self, stage, key, began, outputs, extra=None):
        seconds = round(time.time() - began, 1)
        size = sum(folder_bytes(p) for p in outputs)
        record = {"key": key, "sec": seconds, "bytes": size, "done_at": time.time(), **(extra or {})}
        data = self.load_done(stage)
        data["history"][key] = record
        data["current"] = record
        write_json(self.done_path(stage), data)
        self.records[stage] = {"sec": seconds, "bytes": size, "gb": round(size / 1e9, 3), "at": time.strftime("%Y-%m-%d %H:%M:%S"),
                               **(extra or {})}
        write_json(self.stages_path, self.records)
        log(f"段 {stage} 済み: {seconds} 秒、{size / 1e9:.2f} GB")

    def skip(self, stage):
        log(f"段 {stage} は済んでいるので飛ばす")

    # ---- 1. 背景のループ ----
    def loop_path(self, which):
        source = Path(getattr(self.args, which))
        if not is_video(source):
            return source
        return self.out / "bg" / f"{which}_{finger(file_mark(source), self.args.loop_blend)}.mp4"

    def stage_bg(self):
        key = finger(file_mark(self.args.closed), file_mark(self.args.open), self.args.loop_blend)
        if self.is_done("bg", key):
            return self.skip("bg")
        began = time.time()
        made, info = [], {}
        body_frames = self.plan["body"][1] - self.plan["body"][0]
        for which in ("closed", "open"):
            source = Path(getattr(self.args, which))
            if not is_video(source):
                info[which] = "静止画"
                continue
            count = probe_frames(source)
            target = self.loop_path(which)
            target.parent.mkdir(parents=True, exist_ok=True)
            if count >= body_frames:
                shutil.copyfile(source, target)  # 区間より長い動画はそのまま(余りで割るだけ)
                info[which] = {"frames": count, "loop": False}
            else:
                blend = min(self.args.loop_blend, count // 4)
                self.make_loop(source, count, blend, target)
                info[which] = {"frames": count, "loop_frames": count - blend, "blend": blend}
            made.append(target)
        self.mark_done("bg", key, began, made, {"backgrounds": info})

    def make_loop(self, source, count, blend, target):
        """頭と尾を blend コマ重ねる。長さは count - blend。最後のコマの次は最初のコマにつながる。"""
        graph = (f"[0:v]split=3[m][a][b];[m]trim=start_frame={blend}:end_frame={count - blend},setpts=PTS-STARTPTS[mid];"
                 f"[a]trim=start_frame={count - blend},setpts=PTS-STARTPTS[tail];[b]trim=end_frame={blend},setpts=PTS-STARTPTS[head];"
                 f"[tail][head]blend=all_expr='A*(1-(N+0.5)/{blend})+B*((N+0.5)/{blend})+0.5'[x];[x][mid]concat=n=2:v=1[v]")
        # +0.5: blend の式は小数を切り捨てる。無いと重ねた所だけ 0.5 段暗くなり、継ぎ目に段が出た(測定 0.54 → 下の確かめ)
        self.locked("cpu", 10, "全編の背景のループ", ["ffmpeg", "-y", "-v", "error", "-i", str(source), "-filter_complex", graph,
                                                 "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "10", "-preset", "medium",
                                                 "-pix_fmt", "yuv420p", "-r", str(self.fps), "-map_metadata", "-1", str(target)], timeout=1800)
        got = probe_frames(target)
        if got != count - blend:
            raise RuntimeError(f"ループのコマ数が {got}(見込み {count - blend})")

    # ---- 2. UE のキャラの層 ----
    def ue_raw(self):
        return self.out / "ue_raw" / self.args.character

    def ue_command(self, extra):
        command = [PY, str(HERE / "render_led_ue.py"), "--timeline", str(self.args.timeline), "--stage", str(self.args.stage),
                   "--out", str(self.ue_raw()), "--look", self.args.look, "--character", self.args.character]
        for kind, name, a, b in self.plan["layers"]:
            command += ["--layer", kind, name, f"{a:.6f}", f"{b:.6f}"]
        return command + extra

    def ue_jobs(self):
        """render_led_ue と同じ job の並び(名前と範囲)。影の基準は最初の 1 本だけ撮る。"""
        sys.path.insert(0, str(HERE))
        import render_led_ue
        plan = render_led_ue.make_plan(self.timeline, self.stage)
        jobs = render_led_ue.layer_jobs([tuple(x) for x in self.plan["layers"]], plan, self.stage)
        refs = [j for j in jobs if j["name"].endswith("_ref")]
        return [j for j in jobs if not j["name"].endswith("_ref")] + refs[:1]

    def stage_ue(self):
        key = finger(self.input_mark, self.args.character, self.args.look, self.plan["layers"])
        if self.args.skip_ue:
            write_json(self.out / "ue_jobs_planned.json", [{k: j[k] for k in ("name", "first_frame", "last_frame")} for j in self.ue_jobs()])
            log("--skip-ue: キャラの層は撮らない(予定だけ ue_jobs_planned.json に書いた)")
            return
        if self.is_done("ue", key):
            return self.skip("ue")
        began = time.time()
        jobs = self.ue_jobs()
        frames_dir = self.ue_raw() / "frames"
        timing = {}

        def build_and_render():
            # 層のシーケンスはほかの担当と共有。組み立てから撮り終わりまで印を持ち続け、間に組み直されないようにする
            if self.other_layer_renders():
                raise RuntimeError("印を取った直後に、ほかの担当の層の撮影が始まった。あとで流し直す")
            self.locked("ue", 5, "全編のキャラの層の組み立て", self.ue_command(["--build-only"]), timeout=1200)
            groups = {}
            for job in jobs:
                groups.setdefault(job["name"].split("_")[0], []).append(job)
            for group, members in groups.items():
                # 撮影の途中で png が 1 枚欠けることがある(11-04 に 492 コマ中 1 枚。書き込みの詰まり)。欠けた job だけ撮り直す
                for attempt in range(UE_ATTEMPTS):
                    todo = [j for j in members if self.job_missing(frames_dir, j)]
                    if not todo:
                        break
                    frames = sum(j["last_frame"] - j["first_frame"] for j in todo)
                    minutes = frames * UE_LAYER_SEC_PER_FRAME / 60.0 + 0.5 * len(todo) + 3
                    start = time.time()
                    try:
                        self.locked("ue", minutes, f"全編のキャラの層 {group} {frames} コマ",
                                    self.ue_command(["--no-build", "--render", *[j["name"] for j in todo]]), timeout=3600)
                    except RuntimeError as error:
                        log(f"層 {group} の撮影 {attempt + 1} 回目が不完全: {error}")
                    timing.setdefault(group, []).append({"frames": frames, "sec": round(time.time() - start, 1),
                                                         "jobs": [j["name"] for j in todo]})

        self.wait_for_other_layer_renders()
        self.with_build_lock(build_and_render)
        missing = [j["name"] for j in jobs if self.job_missing(frames_dir, j)]
        if missing:
            raise RuntimeError(f"撮れていない層: {missing}")
        self.mark_done("ue", key, began, [frames_dir], {"groups": timing})

    @staticmethod
    def job_missing(frames_dir, job):
        folder = frames_dir / job["name"]
        return any(not (folder / f"f.{f:04d}.png").exists() for f in range(job["first_frame"], job["last_frame"]))

    @staticmethod
    def other_layer_renders():
        """同じ HackShow で層のレベル(L_LedLayer*)を撮っている UE の PID。動いている間に組み直すと相手の撮影が壊れる。"""
        script = ("Get-CimInstance Win32_Process -Filter \"Name like 'UnrealEditor%'\" | "
                  "Where-Object { $_.CommandLine -match 'HackShow/HackShow.uproject' -and $_.CommandLine -match 'L_LedLayer' } | "
                  "ForEach-Object { $_.ProcessId }")
        out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", script], capture_output=True, text=True,
                             stdin=subprocess.DEVNULL, timeout=60).stdout
        return [int(x) for x in out.split() if x.strip().isdigit()]

    def wait_for_other_layer_renders(self):
        """ほかの担当は撮影を何本も続けて流すので、本と本の間の切れ目で組み直さない。QUIET_SEC 続けて誰も撮っていないのを待つ。"""
        waited, quiet = 0, 0
        while quiet < QUIET_SEC:
            others = self.other_layer_renders()
            if others:
                quiet = 0
                log(f"ほかの担当が層のレベルで撮影中(PID {others})。終わるのを待つ")
            else:
                quiet += 30
            if waited >= self.args.lock_wait * 60:
                raise RuntimeError(f"ほかの担当が層のレベルで撮影中(PID {others})。{self.args.lock_wait} 分待っても静かにならない")
            time.sleep(30)
            waited += 30

    def with_build_lock(self, action):
        waited = 0
        while True:
            try:
                BUILD_LOCK.mkdir()
                break
            except FileExistsError:
                if waited >= BUILD_LOCK_WAIT_SEC:
                    raise RuntimeError(f"組み立ての印 {BUILD_LOCK} が 10 分取れない(ほかの担当が資産を保存中)")
                log("組み立ての印の空きを待つ")
                time.sleep(30)
                waited += 30
        try:
            action()
        finally:
            BUILD_LOCK.rmdir()

    # ---- 3. 層の後始末 ----
    def layers(self, kind):
        return self.out / "layers" / self.args.character / kind

    def stage_post(self):
        if self.args.skip_ue:
            return
        key = finger(self.current("ue"))  # 撮り直したら後始末もやり直す
        if self.is_done("post", key):
            return self.skip("post")
        began = time.time()
        frames_dir = self.ue_raw() / "frames"
        post = [PY, str(HERE / "led_layers_post.py")]
        jobs = self.ue_jobs()
        reference = next(j for j in jobs if j["name"].endswith("_ref"))
        reference_png = frames_dir / reference["name"] / f"f.{reference['first_frame']:04d}.png"
        commands = []
        for job in jobs:
            name = job["name"]
            source = frames_dir / name
            if name.endswith("_ref"):
                continue
            if name.startswith("char_"):
                commands.append(post + ["straight", str(source), str(self.layers("char"))])
            elif name.startswith("reflect_"):
                commands.append(post + ["reflect", str(source), str(self.layers("reflect"))])
            elif name.startswith("shadow_"):
                commands.append(post + ["shadow", str(source), str(reference_png), str(self.layers("shadow"))])
            elif name.startswith("close_s0"):
                commands.append(post + ["straight", str(source), str(self.layers("close_L"))])
            elif name.startswith("close_s1"):
                commands.append(post + ["straight", str(source), str(self.layers("close_R"))])
        script = self.out / "_post_commands.json"
        write_json(script, commands)
        self.locked("cpu", 20, "全編のキャラの層の後始末", [PY, str(Path(__file__)), "--run-commands", str(script)], timeout=3600)
        self.mark_done("post", key, began, [self.out / "layers" / self.args.character])

    # ---- 4. 頭(待ち・同期・校正)。今の全編と同じ、ブラウザの描画のキャラなし ----
    def stage_head(self):
        self.browser_part("head", "待ちと同期")

    def stage_tail(self):
        self.browser_part("tail", "尾の同期と黒")

    def browser_part(self, name, label):
        """本編の外(頭と尾)。今の全編と同じ、ブラウザの描画のキャラなし(待ちの数字・同期のフラッシュ・校正・黒)。"""
        first, last = self.plan[name]
        key = finger(self.input_mark["timeline"], file_mark(self.args.calib_video) if name == "head" else None, first, last)
        folder = self.out / name
        if last <= first:
            return
        if self.is_done(name, key):
            return self.skip(name)
        began = time.time()
        minutes = (last - first) * 0.25 / 60.0 + 3
        self.locked("gpu", minutes, f"全編の{label} {last - first} コマ",
                    ["node", str(SHOW / "led_browser" / "render_show.mjs"), "--timeline", str(self.args.timeline), "--no-character",
                     "--plate", str(self.args.head_plate), "--at", f"{first / self.fps:.6f}", "--seconds", f"{(last - first) / self.fps:.6f}",
                     "--out", str(folder)], timeout=3600)
        got = probe_frames(folder / "master.mov")
        if got != last - first:
            raise RuntimeError(f"{label}のコマ数が {got}(見込み {last - first})")
        if name == "head" and self.plan["calib"] and self.args.calib_video:
            subprocess.run([PY, str(HERE / "splice_calib.py"), str(folder / "master.mov"), str(self.args.timeline), str(self.args.calib_video)],
                           check=True, stdin=subprocess.DEVNULL, timeout=1800)
        self.mark_done(name, key, began, [folder / "master.mov"])

    # ---- 5. 重ね(区切って描く。どの区切りからでも同じ絵) ----
    def compose_command(self, a, b, part, stats):
        args, fps = self.args, self.fps
        command = [PY, str(SHOW / "fx" / "compose_led.py"), "--timeline", str(args.timeline), "--stage", str(args.stage),
                   "--start", f"{a / fps:.6f}", "--end", f"{b / fps:.6f}", "--bg", str(self.loop_path("closed")),
                   "--bg-open", str(self.loop_path("open")), "--open-plates", str(args.plates),
                   "--bg-anchor", f"{self.plan['body'][0] / fps:.6f}", "--bg-envelope", "--out", str(part), "--stats", str(stats),
                   "--scale", str(args.scale), "--every", str(self.every)]
        if args.cues:
            command += ["--cues", str(args.cues)]
        if args.bulbs:
            command += ["--bulbs", str(args.bulbs)]
        if not args.skip_ue:
            command += ["--char-dir", str(self.layers("char")), "--shadow-dir", str(self.layers("shadow")),
                        "--reflect-dir", str(self.layers("reflect")), "--mon-left", str(self.layers("close_L")),
                        "--mon-right", str(self.layers("close_R"))]
        return command

    def chunk_frames(self, a, b):
        return len(range(-(-a // self.every) * self.every, b, self.every))

    def stage_body(self):
        key = self.bg_key
        if self.is_done("body", key):
            return self.skip("body")
        began = time.time()
        parts = self.body_dir / "parts"
        parts.mkdir(parents=True, exist_ok=True)
        per_frame = self.args.sec_per_frame * (self.args.scale ** 2 if self.quick else 1.0) + 0.02
        timing = []
        for a, b in self.plan["chunks"]:
            part, stats = parts / f"part_{a:06d}.mov", parts / f"stats_{a:06d}.jsonl"
            expected = self.chunk_frames(a, b)
            if "body" not in self.args.redo and part.exists() and stats.exists() and probe_frames(part) == expected:
                continue
            start = time.time()
            self.locked("gpu", expected * per_frame / 60.0 + 2, f"全編の重ね {a}〜{b}", self.compose_command(a, b, part, stats), timeout=3600)
            got = probe_frames(part)
            if got != expected:
                raise RuntimeError(f"重ねの区切り {a} のコマ数が {got}(見込み {expected})")
            timing.append({"chunk": a, "frames": expected, "sec": round(time.time() - start, 1)})
        with open(self.body_dir / "stats.jsonl", "w", encoding="utf-8") as joined:
            for a, _ in self.plan["chunks"]:
                joined.write((parts / f"stats_{a:06d}.jsonl").read_text(encoding="utf-8"))
        self.mark_done("body", key, began, [parts], {"chunks_rendered_now": timing})

    # ---- 6. 原版(頭 + 重ね + 尾の黒) ----
    def stage_master(self):
        # 重ねや頭をやり直したら原版も作り直す(済みの印の時刻まで指紋に入れる)
        key = finger(self.bg_key, *[self.current(s) for s in ("head", "tail", "body")])
        if self.is_done("master", key) and self.master.exists():
            return self.skip("master")
        began = time.time()
        work = self.body_dir / "join"
        work.mkdir(parents=True, exist_ok=True)
        rate = f"{self.fps}/{self.every}"
        scale = f"scale={self.size[0]}:{self.size[1]}:flags=area:out_color_matrix=bt709:out_range=tv"
        listing = []

        def to_prores(name):
            """ブラウザの描画(FFV1)を重ねと同じ ProRes へ。間引きは全編のコマ番号で N の倍数だけ残す。"""
            first = self.plan[name][0]
            pick = f"select='not(mod(n+{first}\\,{self.every}))',setpts=N/({rate})/TB," if self.every > 1 else ""
            target = work / f"{name}.mov"
            self.locked("render", 10, f"全編の原版 {name}", ["ffmpeg", "-y", "-v", "error", "-i", str(self.out / name / "master.mov"),
                                                         "-vf", pick + scale, "-r", rate, *PRORES, "-map_metadata", "-1", str(target)], timeout=1800)
            return target

        if self.plan["head"][1] > self.plan["head"][0]:
            listing.append(to_prores("head"))
        listing += [self.body_dir / "parts" / f"part_{a:06d}.mov" for a, _ in self.plan["chunks"]]
        if self.plan["tail"][1] > self.plan["tail"][0]:
            listing.append(to_prores("tail"))
        text = "".join(f"file '{p.as_posix()}'\n" for p in listing)
        (work / "list.txt").write_text(text, encoding="utf-8")
        self.locked("render", 15, "全編の原版 つなぎ", ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(work / "list.txt"),
                                                    "-c", "copy", "-map_metadata", "-1", "-video_track_timescale", str(self.fps * 1000),
                                                    str(self.master)], timeout=3600)
        expected = self.expected_frames()
        got = probe_frames(self.master)
        if got != expected:
            raise RuntimeError(f"原版のコマ数が {got}(見込み {expected})")
        self.mark_done("master", key, began, [self.master], {"frames": got})

    def expected_frames(self):
        if self.every == 1:
            return self.frames
        total = 0
        for a, b in (self.plan["head"], *self.plan["chunks"], self.plan["tail"]):
            total += len(range(-(-a // self.every) * self.every, b, self.every)) if b > a else 0
        return total

    # ---- 7. 書き出し ----
    def deliver_names(self):
        tag = "_試し" if self.quick else ""
        return (self.deliver_dir / f"{self.args.version}_全編_キャラあり_5680x1240_H264{tag}.mp4",
                self.deliver_dir / f"{self.args.version}_UE再生用_2840x620_音なし_H264{tag}.mp4")

    def stage_deliver(self):
        key = finger(self.current("master")["key"], file_mark(self.audio), self.args.version)
        if self.is_done("deliver", key):
            return self.skip("deliver")
        began = time.time()
        self.deliver_dir.mkdir(parents=True, exist_ok=True)
        led, ue = self.deliver_names()
        duration = self.expected_frames() * self.every / self.fps
        color = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]
        rate = f"{self.fps}/{self.every}"
        led_size = (self.size[0] // 2 * 2, self.size[1] // 2 * 2) if self.quick else CANVAS
        self.locked("render", 15, f"全編の書き出し LED 用 {self.args.version}",
                    ["ffmpeg", "-y", "-v", "error", "-i", str(self.master), "-i", str(self.audio), "-map", "0:v:0", "-map", "1:a:0",
                     "-t", f"{duration:.6f}", "-af", "aresample=48000,aformat=channel_layouts=stereo,apad",
                     "-vf", f"scale={led_size[0]}:{led_size[1]}:flags=lanczos,format=yuv420p",
                     "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", rate, *color,
                     "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2", "-map_metadata", "-1", "-movflags", "+faststart", str(led)],
                    timeout=3600)
        ue_size = (max(2, self.size[0] // 2 // 2 * 2), max(2, self.size[1] // 2 // 2 * 2)) if self.quick else UE_PLAY
        self.locked("render", 8, f"全編の書き出し UE 用 {self.args.version}",
                    ["ffmpeg", "-y", "-v", "error", "-i", str(self.master), "-map", "0:v:0", "-an",
                     "-vf", f"scale={ue_size[0]}:{ue_size[1]}:flags=lanczos,format=yuv420p",
                     "-c:v", "libx264", "-profile:v", "high", "-crf", "18", "-preset", "medium", "-g", str(self.fps), "-bf", "0",
                     "-pix_fmt", "yuv420p", "-r", rate, *color, "-map_metadata", "-1", "-movflags", "+faststart", str(ue)], timeout=3600)
        self.mark_done("deliver", key, began, [led, ue])

    # ---- 8. 確認シート ----
    def stage_sheet(self):
        key = finger(self.current("deliver")["key"])
        sheet = self.deliver_dir / f"{self.args.version}_確認シート{'_試し' if self.quick else ''}.jpg"
        if self.is_done("sheet", key) and sheet.exists():
            return self.skip("sheet")
        began = time.time()
        subprocess.run([PY, str(SHOW / "check" / "make_full_sheet.py"), "--video", str(self.master), "--timeline", str(self.args.timeline),
                        "--stage", str(self.args.stage), "--out", str(sheet), "--every", str(self.every),
                        *(["--cues", str(self.args.cues)] if self.args.cues else [])],
                       check=True, stdin=subprocess.DEVNULL, timeout=1800)
        self.mark_done("sheet", key, began, [sheet])

    # ---- 9. 検査 ----
    def stage_check(self):
        began = time.time()
        led, ue = self.deliver_names()
        command = [PY, str(SHOW / "check" / "check_led_full.py"), "--out-dir", str(self.out), "--timeline", str(self.args.timeline),
                   "--stage", str(self.args.stage), "--master", str(self.master), "--led", str(led), "--ue", str(ue),
                   "--stats", str(self.body_dir / "stats.jsonl"), "--audio", str(self.audio), "--every", str(self.every),
                   "--scale", str(self.args.scale), "--report", str(self.out / "check.json")]
        if self.args.cues:
            command += ["--cues", str(self.args.cues)]
        if not self.args.skip_ue:
            command += ["--char-dir", str(self.layers("char"))]
        if self.args.compare_head:
            command += ["--compare-head", str(self.args.compare_head)]
        if self.args.ref_boxes:
            command += ["--ref-boxes", str(self.args.ref_boxes), "--ref-foot-shift", str(self.args.ref_foot_shift)]
        result = subprocess.run(command, stdin=subprocess.DEVNULL, timeout=3600)
        self.mark_done("check", finger(time.time()), began, [self.out / "check.json"], {"passed": result.returncode == 0})
        return result.returncode

    def run(self):
        wanted = self.args.stages or STAGES
        code = 0
        for stage in STAGES:
            if stage not in wanted:
                continue
            log(f"== {stage}")
            value = getattr(self, f"stage_{stage}")()
            if stage == "check":
                code = value
        total = {k: v for k, v in self.records.items()}
        log("段ごと:", json.dumps({k: [v["sec"], v["gb"]] for k, v in total.items()}, ensure_ascii=False))
        return code


def run_commands(path):
    """後始末の命令の並びを順に流す(1 枚の札の中で)。"""
    for command in read_json(path):
        print(" ".join(command[-3:]), flush=True)
        subprocess.run(command, check=True, stdin=subprocess.DEVNULL)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    if "--run-commands" in sys.argv:
        parser.add_argument("--run-commands", required=True)
        return parser.parse_args()
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--cues", help="秒の追加(fx_plan.py の先頭の説明)")
    parser.add_argument("--closed", required=True, help="閉じた緞帳の背景(静止画か動画)")
    parser.add_argument("--open", required=True, help="開いた世界の背景(静止画か動画)")
    parser.add_argument("--plates", required=True, help="stage_plates.py の出力(額縁の型と開いた絵の合わせ)")
    parser.add_argument("--bulbs", help="電球の位置(既定は <plates>/bulbs.json があればそれ)")
    parser.add_argument("--character", default="sample_show60", help="UE のキャラの資産の名前")
    parser.add_argument("--look", default="B_lit")
    parser.add_argument("--version", required=True, help="版の名前(出す物の頭)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--audio", help="全編の音(既定は timeline と同じ所の show_mix.wav)")
    parser.add_argument("--head-plate", help="頭を描くページに渡す絵(会場が消える区間なので映らない。既定は --closed か plates の closed_clean)")
    parser.add_argument("--calib-video", help="timeline に calib の区間があれば、ここへ校正の盤を差しこむ")
    parser.add_argument("--ref-boxes", help="ブラウザ版の character_box.json(足・身長・中心 x の比べ)")
    parser.add_argument("--ref-foot-shift", type=float, default=0.0, help="比べる枠の足の高さの差(足 1212 の古い版なら -14)")
    parser.add_argument("--compare-head", help="今の全編の mp4(同じ timeline)。頭と尾の明るさを比べる")
    parser.add_argument("--loop-blend", type=int, default=60, help="動画の背景のループの、頭と尾を重ねるコマ数")
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--every", type=int, default=1)
    parser.add_argument("--skip-ue", action="store_true", help="キャラの層を撮らない(試し)")
    parser.add_argument("--stages", nargs="*", help="この段だけ流す")
    parser.add_argument("--redo", nargs="*", default=[], help="済んでいても、この段をやり直す")
    parser.add_argument("--no-lock", action="store_true")
    parser.add_argument("--lock-wait", type=int, default=60, help="札を待つ分")
    parser.add_argument("--sec-per-frame", type=float, default=0.4, help="重ねの 1 コマの見込み(札の分)")
    args = parser.parse_args()
    if not args.bulbs and (Path(args.plates) / "bulbs.json").exists():
        args.bulbs = str(Path(args.plates) / "bulbs.json")
    if not args.head_plate:
        args.head_plate = args.closed if not is_video(args.closed) else str(Path(args.plates) / "closed_clean.png")
    return args


def main():
    args = parse_args()
    if getattr(args, "run_commands", None):
        run_commands(args.run_commands)
        return 0
    return Builder(args).run()


if __name__ == "__main__":
    sys.exit(main())
