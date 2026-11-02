"""シミュレーターの撮影: 映像を UE で読める形にし、シーケンスを作り、撮り、mp4 に音を重ねる。

使い方: python render_sim.py <映像> <音 wav> <出力フォルダ> [--range 始め秒 終わり秒] [--cams 1 2 3]
全編の素材の差し替えも、このコマンド 1 つでよい。
"""
import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np

UE_CMD = "C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
PROJECT = "work/ue_show/HackShow/HackShow.uproject"
MEDIA_DIR = Path("work/ue_show/media")
LOGS = Path("work/ue_show/logs")
BUILD_SCRIPT = Path(__file__).resolve().parent.parent / "ue" / "build_sim.py"
FPS = 30
UE_COMMON = ["-ddc=InstalledNoZenLocalFallback", "-LocalDataCachePath=work/ue_show/DDC"]
BUILD_TIMEOUT_SEC = 600
RENDER_TIMEOUT_SEC = 3300  # 札の 1 時間に収める
GLOW_KEYS_PER_SEC = 10


def media_seconds(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def glow_from_video(path):
    """映像の明るさの変化(直線の輝度。キーは 10 分の 1 秒ごと)と、明るさで重みを付けた平均の色を返す。"""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"fps={GLOW_KEYS_PER_SEC},scale=32:18",
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    linear = (np.frombuffer(raw, np.uint8).reshape(-1, 18, 32, 3).astype(np.float32) / 255.0) ** 2.2
    colors = linear.mean(axis=(1, 2))
    luma = colors @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    keys = [[round(i / GLOW_KEYS_PER_SEC, 3), round(float(v), 4)] for i, v in enumerate(luma)]
    mean_color = (colors.sum(axis=0) / max(float(colors.sum()), 1e-6) * 3.0).clip(0.0, 3.0) / 3.0
    return keys, [round(float(c) / float(mean_color.max()), 3) for c in mean_color] if mean_color.max() > 0 else [1, 1, 1]


def is_fresh(made, source):
    return made.exists() and made.stat().st_mtime >= source.stat().st_mtime


def prepare_video(source):
    """UE のメディアが読める 2840x620 の H.264 にする。B フレームなし、1 秒ごとにキーフレーム。"""
    target = MEDIA_DIR / f"sim_{source.stem}.mp4"
    if not is_fresh(target, source):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source),
                        "-vf", "scale=2840:620,format=yuv420p", "-c:v", "libx264", "-crf", "16",
                        "-bf", "0", "-g", "30", "-an", "-map_metadata", "-1", str(target)], check=True)
    return target


def prepare_sound(source):
    """シーケンスに入れる音。取り込みが確実な 16 bit にする(mp4 に重ねるのは元の wav)。"""
    target = MEDIA_DIR / f"sim_{source.stem}.wav"
    if not is_fresh(target, source):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ar", "48000", "-ac", "2",
                        "-c:a", "pcm_s16le", "-map_metadata", "-1", str(target)], check=True)
    return target


def build_sequences(config):
    config_path = LOGS / "sim_config.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    report_path = LOGS / "build_sim_report.txt"
    report_path.unlink(missing_ok=True)
    env = {**os.environ, "SIM_CONFIG": str(config_path)}
    subprocess.run([UE_CMD, PROJECT, "-run=pythonscript", f"-script={BUILD_SCRIPT.as_posix()}", "-unattended",
                    "-nosplash", "-nullrhi", *UE_COMMON, f"-abslog={LOGS / 'build_sim.log'}"],
                   env=env, timeout=BUILD_TIMEOUT_SEC, stdout=subprocess.DEVNULL)
    report = report_path.read_text(encoding="utf-8") if report_path.exists() else "(報告が無い)"
    if "BUILD_OK" not in report:
        raise RuntimeError(f"組み立てに失敗:\n{report}")


def render_cut(name):
    """1 カットを撮り、かかった秒を返す。音は mp4 に後で重ねるので、ここでは鳴らさない。"""
    started = time.time()
    code = subprocess.run(
        [UE_CMD, PROJECT, "/Game/Show/L_Sim", "-game", f"-LevelSequence=/Game/Show/Seq/{name}.{name}",
         "-MoviePipelineConfig=/Game/Show/RenderConfig/Cfg_Sim.Cfg_Sim", "-windowed", "-resx=640", "-resy=360",
         "-log", "-Unattended", "-nosound", *UE_COMMON, f"-abslog={LOGS / ('render_' + name + '.log')}"],
        timeout=RENDER_TIMEOUT_SEC, stdout=subprocess.DEVNULL).returncode
    if code != 0:
        raise RuntimeError(f"{name} の撮影が終了コード {code} で止まった")
    return time.time() - started


def encode_cut(frames, wav, start, seconds, out_path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(frames / "f.%04d.png"),
                    "-ss", f"{start:.3f}", "-t", f"{seconds:.3f}", "-i", str(wav),
                    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "320k", "-map_metadata", "-1", str(out_path)], check=True)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("wav", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--range", nargs=2, type=float, metavar=("START", "END"), help="撮る範囲(秒)。無ければ全編")
    parser.add_argument("--cams", nargs="+", type=int, default=[1, 2, 3])
    parser.add_argument("--keep-frames", action="store_true", help="連番の png を残す")
    parser.add_argument("--stage-roughness", type=float, default=0.08)
    parser.add_argument("--hall-roughness", type=float, default=0.2)
    parser.add_argument("--glow-candela", type=float, default=60.0,
                        help="面の前の面光源の、映像が真っ白のときの強さ。0 で置かない")
    parser.add_argument("--cam1", nargs=7, type=float, metavar=("X", "Y", "Z", "TX", "TY", "TZ", "MM35"),
                        help="案 1 のカメラを差し替える(位置 cm、狙う点 cm、35mm 判の焦点距離)")
    return parser.parse_args()


def render_all(args, frames_dir, start, end, timing):
    for number in args.cams:
        name = f"Sim_Cam{number}"
        cut_dir = frames_dir / name
        if cut_dir.exists():
            shutil.rmtree(cut_dir)
        seconds = render_cut(name)
        got = len(list(cut_dir.glob("f.*.png")))
        if got != timing["frames"]:
            raise RuntimeError(f"{name}: コマ数が {got}(見込み {timing['frames']})")
        encode_cut(cut_dir, args.wav, start, end - start, args.out / f"Cam{number}.mp4")
        timing["cuts"][name] = {"seconds": round(seconds, 1)}
        if not args.keep_frames:
            shutil.rmtree(cut_dir)


def main():
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    video = prepare_video(args.video)
    sound = prepare_sound(args.wav)
    total = media_seconds(video)
    start, end = args.range if args.range else (0.0, total)
    if not 0 <= start < end <= total + 0.01:
        raise SystemExit(f"範囲が映像の長さ {total:.2f} 秒に合わない: {start} {end}")
    sound_total = media_seconds(sound)
    if abs(sound_total - total) > 0.1:
        print(f"注意: 映像 {total:.2f} 秒と音 {sound_total:.2f} 秒の長さが違う")
    frames_dir = (args.out / "frames").resolve()
    glow_keys, glow_color = glow_from_video(video) if args.glow_candela > 0 else ([], [1, 1, 1])
    started = time.time()
    build_sequences({
        "media_path": video.as_posix(), "media_seconds": total, "wav_path": sound.as_posix(),
        "range": [start, end], "frames_dir": frames_dir.as_posix(),
        "stage_roughness": args.stage_roughness, "hall_roughness": args.hall_roughness,
        "glow_candela": args.glow_candela, "glow_color": glow_color, "glow_keys": glow_keys,
        "camera_override": ({"Sim_Cam1": {"pos": args.cam1[:3], "target": args.cam1[3:6], "mm35": args.cam1[6]}}
                            if args.cam1 else {}),
    })
    timing = {"build_sec": round(time.time() - started, 1), "frames": round((end - start) * FPS),
              "range": [start, end], "cuts": {}}
    render_all(args, frames_dir, start, end, timing)
    (args.out / "timing.json").write_text(json.dumps(timing, indent=1), encoding="utf-8")
    print(json.dumps(timing))


if __name__ == "__main__":
    main()
