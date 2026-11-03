"""合成の素材をまとめて撮る。記録の読み込み → シーケンス作り → 各パスの撮影。

使い方: python render_comp.py <撮影フォルダ> <LED の映像のフォルダ> <出力フォルダ> --show-start 秒 [--passes 名前...] [--no-build]
LED の映像のフォルダには led_with.mp4・led_without.mp4・led_fade.mp4 を置く。
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "run"), str(HERE.parent / "ue")]

from render_sim import LOGS, PROJECT, UE_CMD, UE_COMMON, glow_from_video, media_seconds  # noqa: E402
from shoot_track import build_track  # noqa: E402

BUILD_SCRIPT = HERE.parent / "ue" / "build_comp.py"
LEVEL_OF = {"Comp_PlateWith": "L_Comp", "Comp_PlateWithout": "L_Comp", "Comp_UeEmerge": "L_Comp",
            "Comp_BeautyWith": "L_Comp", "Comp_BeautyWithout": "L_Comp", "Comp_MatteChar": "L_CompMatte",
            "Comp_MatteMarks": "L_CompMatte", "Comp_RollTest": "L_CompMatte", "Comp_ShadowWith": "L_CompShadow",
            "Comp_ShadowWithout": "L_CompShadow"}
TRUTH_ONLY_PASSES = {"Comp_PlateWith", "Comp_PlateWithout", "Comp_MatteMarks", "Comp_RollTest"}
MATTE_PASSES = {"Comp_MatteChar", "Comp_MatteMarks", "Comp_RollTest"}
MARKERS_XY = [[-90.0, 180.0], [90.0, 180.0], [-90.0, 300.0], [90.0, 300.0], [-300.0, 120.0], [300.0, 120.0]]
ROLL_TEST_DEG = 10.0
ROLL_TEST_FRAMES = 3
GLOW_CANDELA = 60.0
EMERGE_SEC = [6.5, 9.5]
EMERGE_FROM_Y = -260.0
BUILD_TIMEOUT_SEC = 900
RENDER_TIMEOUT_SEC = 1800


def build(args, frames_dir):
    camera = json.loads(args.stmap.read_text(encoding="utf-8")) if args.stmap else None
    track = build_track(args.shoot, ue_camera=camera)
    track_path = args.shoot / "track.json"
    track_path.write_text(json.dumps(track), encoding="utf-8")
    media = {name: (args.led / f"led_{name}.mp4").resolve().as_posix() for name in ("with", "without", "fade")}
    keys, colors = {}, None
    for name, path in media.items():
        keys[name], color = glow_from_video(path)
        colors = colors or color
    truth_path = args.truth or args.shoot / "truth.json"
    config = {"track": track_path.resolve().as_posix(),
              "truth": truth_path.resolve().as_posix() if truth_path.exists() else None,
              "media": media, "show_start": args.show_start, "frames_dir": frames_dir.as_posix(),
              "glow_candela": GLOW_CANDELA, "glow_color": colors, "glow_keys": keys, "markers_xy": MARKERS_XY,
              "roll_test_deg": ROLL_TEST_DEG, "roll_test_frames": ROLL_TEST_FRAMES,
              "emerge_sec": EMERGE_SEC, "emerge_from_y": EMERGE_FROM_Y,
              "character": args.character, "character_scale": args.character_scale,
              "stage": json.loads(args.stage.read_text(encoding="utf-8")) if args.stage else None,
              "resolution": [camera["render_w"], camera["render_h"]] if camera else [1920, 1080]}
    config_path = LOGS / "comp_config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    (args.out / "comp_config.json").write_text(json.dumps(config, indent=0), encoding="utf-8")
    report_path = LOGS / "build_comp_report.txt"
    report_path.unlink(missing_ok=True)
    subprocess.run([UE_CMD, PROJECT, "-run=pythonscript", f"-script={BUILD_SCRIPT.as_posix()}", "-unattended",
                    "-nosplash", "-nullrhi", *UE_COMMON, f"-abslog={LOGS / 'build_comp.log'}"],
                   env={**__import__("os").environ, "COMP_CONFIG": str(config_path)},
                   timeout=BUILD_TIMEOUT_SEC, stdout=subprocess.DEVNULL)
    text = report_path.read_text(encoding="utf-8") if report_path.exists() else "(報告が無い)"
    print(text[:1500] if "BUILD_OK" in text else text)
    if "BUILD_OK" not in text:
        raise RuntimeError("組み立てに失敗")


def render(name):
    cfg = "Cfg_CompMatte" if name in MATTE_PASSES else "Cfg_Comp"
    started = time.time()
    code = subprocess.run(
        [UE_CMD, PROJECT, f"/Game/Show/{LEVEL_OF[name]}", "-game", f"-LevelSequence=/Game/Show/Seq/{name}.{name}",
         f"-MoviePipelineConfig=/Game/Show/RenderConfig/{cfg}.{cfg}", "-windowed", "-resx=640", "-resy=360",
         "-log", "-Unattended", "-nosound", *UE_COMMON, f"-abslog={LOGS / ('render_' + name + '.log')}"],
        timeout=RENDER_TIMEOUT_SEC, stdout=subprocess.DEVNULL).returncode
    if code != 0:
        raise RuntimeError(f"{name} の撮影が終了コード {code} で止まった")
    return round(time.time() - started, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shoot", type=Path)
    parser.add_argument("led", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--show-start", type=float, default=30.0)
    parser.add_argument("--passes", nargs="*", default=list(LEVEL_OF))
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--character", help="import_motion_glb.py で入れた名前。全編の動きと同じ時刻で動く。無ければ試しのキャラ")
    parser.add_argument("--character-scale", type=float, default=1.0)
    parser.add_argument("--stage", type=Path, help="show_stage.json。舞台の上の動きと LED にいる間")
    parser.add_argument("--truth", type=Path, help="正解のカメラの json(試しだけ)。無ければ実写の代わりと目印のパスは撮らない")
    parser.add_argument("--stmap", type=Path, help="make_stmap.py の stmap.json。レンズの歪みの分だけ広く描く")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    frames_dir = (args.out / "frames").resolve()
    if not args.no_build:
        started = time.time()
        build(args, frames_dir)
        print("build seconds", round(time.time() - started, 1))
    has_truth = (args.truth or args.shoot / "truth.json").exists()
    for name in args.passes:
        if not has_truth and name in TRUTH_ONLY_PASSES:
            continue
        print(name, render(name), flush=True)


if __name__ == "__main__":
    main()
