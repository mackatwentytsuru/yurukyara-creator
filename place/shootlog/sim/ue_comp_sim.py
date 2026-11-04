"""サブ機の UE の中で動く(-run=pythonscript)。show/ue/build_comp.py を変えずに、報告の置き場だけを自分の作業フォルダへ向けて動かす。
設定は環境変数 COMP_CONFIG(sim_ue.py が書く)。"""
import os
import sys

ROOT = os.environ.get("SIM_ROOT", "work/hackshow_sim")
SHOW = os.environ.get("SIM_SHOW", ROOT + "/repo/show")
sys.path[:0] = [SHOW + "/ue", SHOW + "/live"]

import ue_helpers  # noqa: E402

_original = ue_helpers.write_report


def _write_report(path, lines):
    os.makedirs(ROOT + "/logs", exist_ok=True)
    return _original(ROOT + "/logs/" + os.path.basename(path), lines)


ue_helpers.write_report = _write_report
import build_comp  # noqa: E402,F401  (読み込むと main が動く)


def _make_jpg_config():
    """色のパス用に、出力だけ JPG(品質 95)の撮影設定 Cfg_CompJpg を作る(サブ機から取り戻す量を減らすため)。Cfg_Comp と同じ設定のコピー。"""
    import json
    import unreal
    import sim_parts
    with open(os.environ["COMP_CONFIG"], encoding="utf-8") as f:
        config = json.load(f)
    resolution = tuple(config.get("resolution", (1920, 1080)))
    cfg, _ = ue_helpers.get_or_create("Cfg_CompJpg", ue_helpers.RENDER_CONFIG_DIR, unreal.MoviePipelinePrimaryConfig,
                                      unreal.MoviePipelinePrimaryConfigFactory() if hasattr(unreal, "MoviePipelinePrimaryConfigFactory") else None)
    out = cfg.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    out.set_editor_property("output_directory", unreal.DirectoryPath(config["frames_dir"]))
    out.set_editor_property("output_resolution", unreal.IntPoint(*resolution))
    out.set_editor_property("file_name_format", "{sequence_name}/f.{frame_number_rel}")
    out.set_editor_property("override_existing_output", True)
    cfg.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    jpg = cfg.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_JPG)
    try:      # 5.8 の Python には品質の項目が出ない(確認済み)。出る版なら 95 にする
        jpg.set_editor_property("quality", 95)
    except Exception:
        pass
    aa = cfg.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    aa.set_editor_property("temporal_sample_count", 1)
    aa.set_editor_property("spatial_sample_count", 4)
    aa.set_editor_property("override_anti_aliasing", True)
    aa.set_editor_property("anti_aliasing_method", unreal.AntiAliasingMethod.AAM_NONE)
    aa.set_editor_property("engine_warm_up_count", sim_parts.WARMUP_FRAMES)
    aa.set_editor_property("render_warm_up_count", sim_parts.WARMUP_FRAMES)
    cfg.find_or_add_setting_by_class(unreal.MoviePipelineGameOverrideSetting)
    ue_helpers.save(cfg)
    with open(ROOT + "/logs/jpg_cfg_report.txt", "w", encoding="utf-8") as f:
        f.write("JPG_CFG_OK\n")


try:
    _make_jpg_config()
except Exception:
    import traceback
    with open(ROOT + "/logs/jpg_cfg_report.txt", "w", encoding="utf-8") as f:
        f.write("JPG_CFG_FAILED\n" + traceback.format_exc())
