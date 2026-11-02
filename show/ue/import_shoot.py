"""撮影の記録を UE の Cine Camera のキーにする。

使い方: python show/ue/import_shoot.py <撮影フォルダ> <シーケンス名> [--level /Game/Show/L_Sim] [--media <mp4>] [--show-start 秒]
       [--stmap stmap.json]  レンズの校正の焦点距離と、広げたセンサーを使う
別のカメラの動きを読むとき: <撮影フォルダ> は作る先。--camera-frames <jsonl> --phone-shoot <記録の撮影> --alignment <盤の json> --image-size 幅 高さ
ふつうの Python で動かすと、カメラの動きを計算して報告し(track.json)、UE を画面なしで呼ぶ。
UE の中では、レベルにカメラを 1 台置き、同じ名前の Level Sequence にキーを打つ。
Git Bash から --level を渡すときは MSYS_NO_PATHCONV=1 を付ける(/Game/... が書きかえられる)。
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ENV_JOB = "SHOOT_IMPORT_JOB"
UE_CMD = "C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
PROJECT = "work/ue_show/HackShow/HackShow.uproject"
LOGS = Path("work/ue_show/logs")
UE_TIMEOUT_SEC = 600


def run_outside_ue():
    import argparse
    import subprocess
    sys.path.insert(0, str(HERE.parent / "composite"))
    from shoot_track import assemble_camera_shoot, build_track

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shoot_dir", type=Path)
    parser.add_argument("sequence")
    parser.add_argument("--level", default="/Game/Show/L_Sim")
    parser.add_argument("--media", help="LED の映像(2840x620 の H.264)。無ければメディアのトラックを入れない")
    parser.add_argument("--show-start", type=float, default=0.0, help="撮影の 0 秒が全編の何秒か")
    parser.add_argument("--stmap", type=Path, help="lens_render.py の stmap.json")
    parser.add_argument("--camera-frames", type=Path, help="export_a7_ue.py の --world-jsonl の出力")
    parser.add_argument("--phone-shoot", type=Path)
    parser.add_argument("--alignment", type=Path)
    parser.add_argument("--image-size", nargs=2, type=int)
    args = parser.parse_args()
    if args.camera_frames:
        assemble_camera_shoot(args.shoot_dir, args.camera_frames, args.phone_shoot, args.alignment, args.image_size)
    camera = json.loads(args.stmap.read_text(encoding="utf-8")) if args.stmap else None
    track = build_track(args.shoot_dir, ue_camera=camera)
    track_path = args.shoot_dir / "track.json"
    track_path.write_text(json.dumps(track), encoding="utf-8")
    report_path = LOGS / f"import_{args.sequence}.txt"
    report_path.unlink(missing_ok=True)
    job = LOGS / f"import_{args.sequence}.json"
    job.write_text(json.dumps({"track": track_path.resolve().as_posix(), "sequence": args.sequence, "level": args.level,
                               "media": args.media, "show_start": args.show_start,
                               "report": report_path.as_posix()}), encoding="utf-8")
    subprocess.run([UE_CMD, PROJECT, "-run=pythonscript", f"-script={Path(__file__).resolve().as_posix()}",
                    "-unattended", "-nosplash", "-nullrhi", "-ddc=InstalledNoZenLocalFallback",
                    "-LocalDataCachePath=work/ue_show/DDC",
                    f"-abslog={LOGS / ('import_' + args.sequence + '.log')}"],
                   env={**os.environ, ENV_JOB: str(job)}, timeout=UE_TIMEOUT_SEC, stdout=subprocess.DEVNULL)
    done = report_path.read_text(encoding="utf-8") if report_path.exists() else "(報告が無い)"
    print(json.dumps({k: track[k] for k in ("faces", "residuals", "tracking_gaps_sec", "principal_offset_px")},
                     ensure_ascii=False))
    print(done)
    if "IMPORT_OK" not in done:
        raise SystemExit(1)


def run_inside_ue(job):
    import traceback

    import unreal

    from build_sequences import add_camera_cut, reset_sequence
    from comp_keys import key_camera, make_camera
    from sim_layout import FPS, LEAD_FRAMES, MEDIA_LATENCY_FRAMES
    from sim_parts import build_file_source, load_required
    from ue_helpers import MEDIA_DIR, SEQUENCE_DIR, get_or_create, save, write_report

    def build():
        with open(job["track"], encoding="utf-8") as f:
            track = json.load(f)
        levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        if not levels.load_level(job["level"]):
            raise RuntimeError(f"レベルを開けない: {job['level']}")
        name = job["sequence"]
        rows = track["rows"]
        camera = make_camera(f"Shot_{name}", rows, (track["sensor_w_mm"], track["sensor_h_mm"]))
        sequence, _ = get_or_create(name, SEQUENCE_DIR, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
        reset_sequence(sequence)
        sequence.set_display_rate(unreal.FrameRate(FPS, 1))
        sequence.set_tick_resolution(unreal.FrameRate(24000, 1))
        sequence.set_playback_start(LEAD_FRAMES)
        sequence.set_playback_end(LEAD_FRAMES + len(rows))
        binding = add_camera_cut(sequence, camera, LEAD_FRAMES + len(rows))
        key_camera(sequence, binding, camera, rows)
        if job.get("media"):
            media = sequence.add_track(unreal.MovieSceneMediaTrack).add_section()
            start = LEAD_FRAMES - MEDIA_LATENCY_FRAMES - int(round(job["show_start"] * FPS))
            media.set_range(start, LEAD_FRAMES + len(rows))
            media.set_editor_property("media_source", build_file_source(name, job["media"]))
            media.set_editor_property("media_texture", load_required(f"{MEDIA_DIR}/MT_LED"))
            media.set_editor_property("looping", False)
        save(sequence)
        if not levels.save_current_level():
            raise RuntimeError("レベルを保存できない")
        return f"{name}: {len(rows)} コマ、カメラ Shot_{name}"

    try:
        write_report(job["report"], [build(), "IMPORT_OK"])
    except Exception:
        write_report(job["report"], ["IMPORT_FAILED", traceback.format_exc()])
        raise


if os.environ.get(ENV_JOB):
    with open(os.environ[ENV_JOB], encoding="utf-8") as job_file:
        run_inside_ue(json.load(job_file))
elif __name__ == "__main__":
    run_outside_ue()
