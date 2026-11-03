"""LED に流す絵を UE で描く。秒は全部 timeline と show_stage から読むので、曲が替わっても引数だけ替える。

使い方:
  python render_led_ue.py --timeline <timeline.json> --stage <show_stage.json> --out <フォルダ> \\
      --audio <show_mix.wav> --job 名前 始め秒 終わり秒 [--job ...] [--matte 名前 ...] [--no-build] [--build-only]
--job を付けなければショーの全部を「full」として描く。--matte に書いた名前は、キャラだけの通しで撮る。
会場は --venue(show/ue/led_venue.py の VENUES の名前)。
層だけを撮る形: --look 案 --layer 種類 名前 始め秒 終わり秒 [--layer ...]。種類は char reflect shadow close。
  会場は組まない。透明は本物(--look のとき PropagateAlpha を起動の引数で入れる。プロジェクトの設定は変えない)。
  close は範囲に重なる cue の全部を、左右別に撮る。shadow は、キャラのいないコマの基準も撮る。
  後の始末は show/run/led_layers_post.py。
描くのは正方形の画素の 3838x1240。mp4 にするときに横 1.48 倍(5680x1240)にする。
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "ue")]

import led_plan  # noqa: E402
from render_sim import LOGS, PROJECT, UE_CMD, UE_COMMON  # noqa: E402

BUILD_SCRIPT = HERE.parent / "ue" / "build_led_theatre.py"
REPORT_PATH = LOGS / "build_led_report.txt"
BUILD_TIMEOUT_SEC = 900
RENDER_TIMEOUT_SEC = 3300  # 札の 1 時間に収める
SPATIAL = 4
MATTE_SPATIAL = 4
PREVIEW_WIDTH = 1920
CANVAS = (5680, 1240)
NIAGARA_SYSTEM = "/Niagara/DefaultAssets/Templates/Systems/RadialBurst.RadialBurst"
LAYER_SPATIAL = 8
ALPHA_ARGS = ["-ini:Engine:[/Script/Engine.RendererSettings]:r.PostProcessing.PropagateAlpha=True"]


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def make_plan(timeline, stage):
    """UE に渡すキーの全部。ここから先に秒の直書きは無い。"""
    fps = timeline["fps"]
    start, end = led_plan.show_range(timeline, stage)
    return {
        "first_frame": round(start * fps), "last_frame": round(end * fps),
        "visibility": led_plan.visibility_changes(timeline, stage, fps),
        "lights": led_plan.light_keys(timeline, stage, max(0.0, start - 2.0), end),
        "flashes": led_plan.flash_keys(stage, start, end, fps),
        "fires": led_plan.niagara_fires(timeline, stage, start, end),
        "monitors": led_plan.monitor_frames(stage, start, end, fps),
        "fps": fps,
        "look": led_plan.look_keys(timeline, stage, max(0.0, start - 2.0), end),
        "close": {str(side): rows for side, rows in led_plan.close_rows(timeline, stage, fps).items()},
    }


def build(config):
    path = LOGS / "led_config.json"
    path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    REPORT_PATH.unlink(missing_ok=True)
    subprocess.run([UE_CMD, PROJECT, "-run=pythonscript", f"-script={BUILD_SCRIPT.as_posix()}", "-unattended", "-nosplash",
                    "-nullrhi", *UE_COMMON, f"-abslog={LOGS / 'build_led.log'}"],
                   env={**os.environ, "LED_CONFIG": str(path)}, timeout=BUILD_TIMEOUT_SEC,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    text = REPORT_PATH.read_text(encoding="utf-8") if REPORT_PATH.exists() else "(報告が無い)"
    print(text[:2000])
    if "BUILD_OK" not in text:
        raise RuntimeError("組み立てに失敗")


def layer_jobs(specs, plan, stage):
    """--layer の指定を、撮る job の並びにする。close は左右と cue ごとに分かれる。"""
    jobs = []
    monitor = [int(v) for v in stage["monitor_rects"][0][2:]]
    for kind, name, a, b in specs:
        first, last = round(float(a) * plan["fps"]), round(float(b) * plan["fps"])
        base = {"spatial": LAYER_SPATIAL, "matte": False, "alpha": True}
        if kind == "close":
            for side, rows in plan["close"].items():
                for low, high, cue in led_plan.close_ranges(rows, first, last):
                    jobs.append({**base, "name": f"{name}_s{side}_c{cue}", "first_frame": low, "last_frame": high, "resolution": monitor,
                                 "level": "L_LedLayerClose", "sequence": f"Seq_LedLayerClose{side}"})
            continue
        title = kind.capitalize()
        place = {"level": f"L_LedLayer{title}", "sequence": f"Seq_LedLayer{title}"}
        jobs.append({**base, **place, "name": name, "first_frame": first, "last_frame": last})
        if kind == "shadow":
            empty = next(frame for frame, shown in plan["visibility"] if not shown)
            jobs.append({**base, **place, "name": f"{name}_ref", "first_frame": empty, "last_frame": empty + 1})
    return jobs


def render(job, matte, spec=None):
    """1 本撮り、起動から終わりまでの秒を返す。spec があれば層の job(レベルとシーケンスはそこから)。"""
    spec = spec or {}
    level, sequence = ("L_LedMatte", "Seq_LedMatte") if matte else ("L_LedTheatre", "Seq_LedMain")
    level, sequence = spec.get("level", level), spec.get("sequence", sequence)
    config = f"Cfg_Led_{job}"
    started = time.time()
    code = subprocess.run(
        [UE_CMD, PROJECT, f"/Game/Show/LedTheatre/{level}", "-game", f"-LevelSequence=/Game/Show/LedTheatre/{sequence}.{sequence}",
         f"-MoviePipelineConfig=/Game/Show/RenderConfig/{config}.{config}", "-windowed", "-resx=640", "-resy=360",
         "-log", "-Unattended", "-nosound", *(ALPHA_ARGS if spec.get("alpha") else []), *UE_COMMON, f"-abslog={LOGS / ('render_led_' + job + '.log')}"],
        timeout=RENDER_TIMEOUT_SEC, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL).returncode
    if code != 0:
        raise RuntimeError(f"{job} の撮影が終了コード {code} で止まった")
    return round(time.time() - started, 1)


def frames_in_job(folder, job):
    """この撮影のコマのファイル。前の撮影の残りが同じフォルダにあっても数えない。"""
    paths = (folder / f"f.{frame:04d}.png" for frame in range(job["first_frame"], job["last_frame"]))
    return [p for p in paths if p.exists()]


def frame_seconds(paths):
    """書き出された時刻の間隔から、1 コマの秒を測る。起動と準備のコマを含まない。"""
    stamps = sorted(p.stat().st_mtime for p in paths)
    return round((stamps[-1] - stamps[0]) / (len(stamps) - 1), 3) if len(stamps) > 1 else None


def encode(folder, first_frame, fps, audio, start_sec, seconds, out_path):
    """連番を横 1.48 倍に戻してから、横 1920 に縮めた mp4 にする。"""
    video = ["-framerate", str(fps), "-start_number", str(first_frame), "-i", str(folder / "f.%04d.png")]
    sound = ["-ss", f"{start_sec:.3f}", "-t", f"{seconds:.3f}", "-i", str(audio), "-map", "0:v", "-map", "1:a",
             "-c:a", "aac", "-b:a", "256k"] if audio else []
    scale = f"scale={CANVAS[0]}:{CANVAS[1]}:flags=lanczos,scale={PREVIEW_WIDTH}:-2:flags=lanczos,format=yuv420p"
    frames = str(round(seconds * fps))
    subprocess.run(["ffmpeg", "-v", "error", "-y", *video, *sound, "-frames:v", frames, "-vf", scale, "-c:v", "libx264", "-crf", "18",
                    "-map_metadata", "-1", str(out_path)], check=True, stdin=subprocess.DEVNULL)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--timeline", required=True, type=Path)
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--job", nargs=3, action="append", metavar=("NAME", "START", "END"), default=[])
    parser.add_argument("--matte", nargs="*", default=[], help="キャラだけの通しで撮る job の名前")
    parser.add_argument("--render", nargs="*", help="撮る job の名前。無ければ全部")
    parser.add_argument("--venue", default="placeholder")
    parser.add_argument("--character", default="sample_show")
    parser.add_argument("--stretch", type=float, default=1.48)
    parser.add_argument("--niagara", default=NIAGARA_SYSTEM)
    parser.add_argument("--niagara-scale", type=float, default=2.0)
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--look", choices=sorted(led_plan.LOOKS), help="層だけを撮る。見た目の案の名前")
    parser.add_argument("--layer", nargs=4, action="append", metavar=("KIND", "NAME", "START", "END"), default=[])
    return parser.parse_args()


def main():
    args = parse_args()
    timeline, stage = read_json(args.timeline), read_json(args.stage)
    fps = timeline["fps"]
    start, end = led_plan.show_range(timeline, stage)
    specs = [(name, float(a), float(b)) for name, a, b in args.job] or [("full", start, end)]
    jobs = [{"name": n, "first_frame": round(a * fps), "last_frame": round(b * fps),
             "spatial": MATTE_SPATIAL if n in args.matte else SPATIAL, "matte": n in args.matte} for n, a, b in specs]
    plan = make_plan(timeline, stage)
    layers = None
    if args.look:
        if not args.layer:
            raise SystemExit("--look には --layer が要る")
        jobs = layer_jobs(args.layer, plan, stage)
        layers = {"look": led_plan.LOOKS[args.look], "parts": sorted({spec[0] for spec in args.layer}),
                  "close_look": led_plan.LOOKS[led_plan.CLOSE_LOOK.get(args.look, args.look)]}
    args.out.mkdir(parents=True, exist_ok=True)
    frames_dir = (args.out / "frames").resolve()
    (args.out / "plan_summary.json").write_text(json.dumps(
        {"range_sec": [start, end], "visibility": plan["visibility"], "fires": plan["fires"],
         "flash_frames": {k: len(v) for k, v in plan["flashes"].items()}, "monitor_frames": len(plan["monitors"]),
         "timeline": str(args.timeline), "stage": str(args.stage)}, ensure_ascii=False, indent=1), encoding="utf-8")
    if not args.no_build:
        began = time.time()
        build({"stage": stage, "plan": plan, "fps": fps, "total_frames": timeline["frames"], "stretch": args.stretch,
               "venue": args.venue, "character": args.character, "niagara_system": args.niagara,
               "niagara_scale": args.niagara_scale, "frames_dir": frames_dir.as_posix(), "jobs": jobs, **({"layers": layers} if layers else {})})
        print("組み立ての秒", round(time.time() - began, 1), flush=True)
    if args.build_only:
        return
    timing = {}
    for job in jobs:
        if args.render is not None and job["name"] not in args.render:
            continue
        seconds = render(job["name"], job["matte"], job if layers else None)
        folder = frames_dir / job["name"]
        paths = frames_in_job(folder, job)
        count = len(paths)
        expected = job["last_frame"] - job["first_frame"]
        timing[job["name"]] = {"total_sec": seconds, "frames": count, "expected": expected, "sec_per_frame": frame_seconds(paths)}
        print(job["name"], timing[job["name"]], flush=True)
        if count != expected:
            raise RuntimeError(f"{job['name']}: コマ数が {count}(見込み {expected})")
        if count > 1 and not job["matte"] and not layers:
            encode(folder, job["first_frame"], fps, args.audio, job["first_frame"] / fps, count / fps,
                   args.out / f"{job['name']}_1920.mp4")
    if layers:
        (args.out / "close_plan.json").write_text(json.dumps(plan["close"], ensure_ascii=False), encoding="utf-8")
    (args.out / "timing.json").write_text(json.dumps(timing, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
