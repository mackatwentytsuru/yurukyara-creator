"""点の格子を LED に出し、決まった位置のカメラで 1 コマずつ撮るシーケンスを作る(レンズの校正の試し)。

-run=pythonscript -script=このファイル で動かす。設定は環境変数 CALIB_CONFIG の JSON(make_calib_trial.py の poses.json)。
"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

from build_sequences import add_camera_cut, reset_sequence  # noqa: E402
from comp_keys import key_camera, make_camera  # noqa: E402
from sim_layout import FPS, LEAD_FRAMES  # noqa: E402
from sim_parts import build_file_source, build_render_config, load_required  # noqa: E402
from ue_helpers import MEDIA_DIR, SEQUENCE_DIR, SHOW_ROOT, get_or_create, save, write_report  # noqa: E402

REPORT_PATH = "work/ue_show/logs/build_calib_report.txt"
SEQUENCE = "Calib_Trial"
MEDIA_FRAMES = 60


def main():
    with open(os.environ["CALIB_CONFIG"], encoding="utf-8") as f:
        config = json.load(f)
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not levels.load_level(f"{SHOW_ROOT}/L_Sim"):
        raise RuntimeError("L_Sim を開けない")
    rows = config["rows"]
    camera = make_camera("Calib_Cam", rows, config["sensor_mm"])
    sequence, _ = get_or_create(SEQUENCE, SEQUENCE_DIR, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    reset_sequence(sequence)
    sequence.set_display_rate(unreal.FrameRate(FPS, 1))
    sequence.set_tick_resolution(unreal.FrameRate(24000, 1))
    sequence.set_playback_start(LEAD_FRAMES)
    sequence.set_playback_end(LEAD_FRAMES + len(rows))
    binding = add_camera_cut(sequence, camera, LEAD_FRAMES + len(rows))
    key_camera(sequence, binding, camera, rows)
    media = sequence.add_track(unreal.MovieSceneMediaTrack).add_section()
    media.set_range(LEAD_FRAMES - MEDIA_FRAMES, LEAD_FRAMES + len(rows) + 1)
    media.set_editor_property("media_source", build_file_source("calib", config["media"]))
    media.set_editor_property("media_texture", load_required(f"{MEDIA_DIR}/MT_LED"))
    media.set_editor_property("looping", True)
    save(sequence)
    build_render_config(config["frames_dir"], "Cfg_Calib", 4, tuple(config["resolution"]))
    if not levels.save_current_level():
        raise RuntimeError("L_Sim を保存できない")
    write_report(REPORT_PATH, ["BUILD_OK"])


try:
    main()
except Exception:
    write_report(REPORT_PATH, ["BUILD_FAILED", traceback.format_exc()])
    raise
