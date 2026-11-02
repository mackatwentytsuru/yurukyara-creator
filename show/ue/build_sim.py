"""全編のシミュレーター: LED だけが光る暗いレベルと、3 カットの Level Sequence を作る。

-run=pythonscript -script=このファイル で動かす。設定は環境変数 SIM_CONFIG の JSON(render_sim.py が書く)。
L_Stage と既存のカットは変えない。キャラはレベルに置かない(LED の中だけ)。
"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

from sim_parts import (MEDIA_DIR, build_file_source, build_level_for_sim, build_render_config,  # noqa: E402
                       build_sequence, describe, import_sound, load_required, outside_show_dependencies)
from sim_layout import FPS  # noqa: E402
from ue_helpers import SHOW_ROOT, assets, write_report  # noqa: E402

REPORT_PATH = "work/ue_show/logs/build_sim_report.txt"


def main():
    with open(os.environ["SIM_CONFIG"], encoding="utf-8") as f:
        config = json.load(f)
    report = [f"config {config}"]
    cameras, glows = build_level_for_sim(config, report)
    media_texture = load_required(f"{MEDIA_DIR}/MT_LED")
    source = build_file_source("sim", config["media_path"])
    sound = import_sound(config["wav_path"])
    media_frames = int(round(float(config["media_seconds"]) * FPS))
    first = int(round(float(config["range"][0]) * FPS))
    last = int(round(float(config["range"][1]) * FPS))
    build_render_config(config["frames_dir"])
    for name, actor in cameras.items():
        report.append(describe(build_sequence(name, actor, source, media_texture, sound, media_frames, first, last,
                                              glows, config.get("glow_keys", []))))
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    everything = assets.list_assets("/Game", recursive=True, include_folder=False)
    report.append("content outside /Game/Show: " + ", ".join(p for p in everything if not p.startswith(SHOW_ROOT)))
    count, outside = outside_show_dependencies()
    report.append(f"L_Sim uses {count} packages under /Game; outside /Game/Show: {outside}")
    if outside:
        raise RuntimeError(f"新しいステージの外の資産を使っている: {outside}")
    report.append("BUILD_OK")
    write_report(REPORT_PATH, report)


try:
    main()
except Exception:
    write_report(REPORT_PATH, ["BUILD_FAILED", traceback.format_exc()])
    raise
