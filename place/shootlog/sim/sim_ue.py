"""UE の撮影をサブ機で行う薄い包み(メイン PC から動かす)。show/composite/render_comp.py の設定の作り方をそのまま使い、パスだけサブ機に向ける。

  python place/shootlog/sim/sim_ue.py run --shoot <撮影フォルダ(truth.json と、あれば track.json)> --name <名前> --passes Comp_PlateWith Comp_PlateWithout \
         --media rehearsal|dots --show-start 56.0 [--dots-stage]
各パスの連番(PNG)を <撮影フォルダ>/frames/<パス名>/f.NNNN.png に取り戻し、サブ機の中の自分の物を消す(--keep で残す)。
サブ機では ffmpeg も numpy も使わない。UE の撮影だけ。札(machine_lock のサブ機・ue)を取って動かす。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sim_common import OUT, REPO, STAGE  # noqa: E402

sys.path[:0] = [str(REPO / "show" / "composite"), str(REPO / "show" / "run"), str(REPO / "show" / "ue")]
from render_comp import (EMERGE_FROM_Y, EMERGE_SEC, GLOW_CANDELA, LEVEL_OF, MARKERS_XY, MATTE_PASSES, ROLL_TEST_DEG,  # noqa: E402
                         ROLL_TEST_FRAMES)
from render_sim import glow_from_video  # noqa: E402

LOCK = os.environ.get("MACHINE_LOCK_TOOL") or str(Path.home() / "machine_lock" / "machine_lock.py")
# 環境ごとの名前は環境変数で渡す(公開の記録に機械名を書かない): SIM_UE_HOST=サブ機の ssh の名前、SIM_LOCK_SUB / SIM_LOCK_MAIN=札の機械名
UE_HOST = os.environ.get("SIM_UE_HOST", "")
LOCK_SUB = os.environ.get("SIM_LOCK_SUB", "")
LOCK_MAIN = os.environ.get("SIM_LOCK_MAIN", "")
REMOTE = "work/hackshow_sim"
REMOTE_WIN = REMOTE.replace("/", "\\")
MEDIA_LOCAL = {"rehearsal": Path("work/_venue_work/rehearsal_ue/media/show_rehearsal.mp4"), "dots": Path("work/_venue_work/rehearsal_ue/media/led_dots.mp4")}
MEDIA_REMOTE = {"rehearsal": f"{REMOTE}/media/show_rehearsal.mp4", "dots": f"{REMOTE}/media/led_dots.mp4"}
CHARACTER = "sample_show60"
JPG_PASSES = {"Comp_PlateWith", "Comp_PlateWithout", "Comp_BeautyWith", "Comp_BeautyWithout"}      # 色のパス(Matte・Shadow は絵が単純なので PNG のまま)
PNG_NEEDED = {"Comp_BeautyWith", "Comp_BeautyWithout"}      # composite.py が f.NNNN.png で読む物。取り戻したあとメイン PC で PNG に直す
LOCAL_ROOT = "work/仮想iPad/ue_sim"
LOCAL_UE = "C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
PS_TASK = "powershell -NoProfile -ExecutionPolicy Bypass -File " + REMOTE_WIN + "\\scripts\\ue_task.ps1"
PS = "powershell -NoProfile -ExecutionPolicy Bypass -File " + REMOTE_WIN + "\\scripts\\ue_run.ps1"


def win(path: str) -> str:
    return path.replace("/", "\\")


def sh(cmd, check=True, timeout=None):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, stdin=subprocess.DEVNULL)
    if check and r.returncode != 0:
        raise RuntimeError(f"失敗: {cmd}\n{r.stdout}\n{r.stderr}")
    return r


def ssh(command, timeout=None, check=True):
    return sh(["ssh", UE_HOST, command], check=check, timeout=timeout)


def locked(job, minutes, command, timeout):
    """札を取って ssh の 1 コマンドを動かす。"""
    cmd = [sys.executable, LOCK, "run", "--machine", LOCK_SUB, "--kind", "ue", "--who", "場所の柱・仮想iPad", "--job", job, "--minutes", str(minutes),
           "--wait", "600", "--no-table", "--", "ssh", UE_HOST, command]
    r = sh(cmd, check=False, timeout=timeout)
    return r.stdout + r.stderr


def glow(media):
    cache = OUT / "data" / f"glow_{media}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    keys, colors = glow_from_video(str(MEDIA_LOCAL[media]))
    cache.write_text(json.dumps({"keys": keys, "colors": colors}), encoding="utf-8")
    return {"keys": keys, "colors": colors}


def provisional_track(truth):
    """正解のカメラだけで撮るパス(PlateWith・PlateWithout)の組み立て用。Beauty 系の絵は使わない。"""
    w, h = truth["width"], truth["height"]
    return {"width": w, "height": h, "sensor_w_mm": 36.0, "sensor_h_mm": 36.0 * h / w, "principal_offset_px": [0.0, 0.0], "faces": [], "residuals": {},
            "tracking_gaps_sec": [], "world_to_ue": {}, "rows": truth["rows"]}


def make_config(shoot: Path, name, media, show_start, dots_stage, where="sub", resolution=(1920, 1080)):
    g = glow(media)
    stage = dict(STAGE)
    if dots_stage:
        stage["led_character"] = [[0.0, 1e9]]       # いつも「LED の中」にして、舞台の上に出さない(rehearsal.py の dots と同じ)
    remote = f"{REMOTE}/work/{name}" if where == "sub" else shoot.as_posix()
    m = MEDIA_REMOTE[media] if where == "sub" else f"{LOCAL_ROOT}/media/{MEDIA_LOCAL[media].name}"
    track_name = "track_used.json"
    config = {"track": f"{remote}/{track_name}", "truth": f"{remote}/truth.json", "media": {"with": m, "without": m, "fade": m},
              "show_start": show_start, "frames_dir": f"{remote}/frames", "glow_candela": GLOW_CANDELA, "glow_color": g["colors"],
              "glow_keys": {"with": g["keys"], "without": g["keys"], "fade": g["keys"]}, "markers_xy": MARKERS_XY,
              "roll_test_deg": ROLL_TEST_DEG, "roll_test_frames": ROLL_TEST_FRAMES, "emerge_sec": EMERGE_SEC, "emerge_from_y": EMERGE_FROM_Y,
              "character": CHARACTER, "character_scale": 1.0, "stage": stage, "resolution": list(resolution)}
    (shoot / "comp_config.json").write_text(json.dumps(config), encoding="utf-8")


def local_ue(mode, name, config=None, pass_name="", level="L_Comp", cfg="Cfg_Comp", timeout=2400):
    """メイン PC で UE を 1 回動かす(自分で起動した PID だけを止める)。戻り: (終了コード, 秒, 出力の最後)。"""
    import os
    logs = Path(LOCAL_ROOT) / "logs"
    proj = f"{LOCAL_ROOT}/proj_HackShow/HackShow.uproject"
    common = ["-ddc=InstalledNoZenLocalFallback", f"-LocalDataCachePath={LOCAL_ROOT}/ddc", "-notraceserver", "-trace=none", f"-abslog={logs}/ue_{name}.log"]
    env = dict(os.environ, SIM_ROOT=LOCAL_ROOT, SIM_SHOW=(REPO / "show").as_posix())
    if mode == "build":
        env["COMP_CONFIG"] = str(config)
        (logs / "build_comp_report.txt").unlink(missing_ok=True)
        cmd = [LOCAL_UE, proj, "-run=pythonscript", f"-script={(HERE / 'ue_comp_sim.py').as_posix()}", "-unattended", "-nosplash", "-nullrhi", *common]
    else:
        cmd = [LOCAL_UE, proj, f"/Game/Show/{level}", "-game", f"-LevelSequence=/Game/Show/Seq/{pass_name}.{pass_name}", f"-MoviePipelineConfig=/Game/Show/RenderConfig/{cfg}.{cfg}",
               "-RenderOffScreen", "-windowed", "-resx=640", "-resy=360", "-log", "-Unattended", "-nosound", *common]
    t0 = time.time()
    p = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    print(f"  UE の PID {p.pid}", flush=True)
    try:
        code = p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        p.kill()
        code = -9
    report = ""
    if mode == "build":
        rp = logs / "build_comp_report.txt"
        report = "BUILD_OK" if rp.exists() and "BUILD_OK" in rp.read_text(encoding="utf-8") else "BUILD_FAILED " + (rp.read_text(encoding="utf-8")[:1500] if rp.exists() else "")
    return code, round(time.time() - t0, 1), report


def locked_local(job, minutes, fn):
    """メイン PC の UE の札を取ってから fn を動かす。"""
    marker = Path(LOCAL_ROOT) / "logs" / "lock_child.json"
    code = (f"import sys,json;sys.path.insert(0,r'{HERE}');import sim_ue;a=json.load(open(r'{marker}',encoding='utf-8'));"
            f"r=sim_ue.local_ue(**a);print('RESULT',json.dumps(r))")
    return code


def run_local_step(job, minutes, **kw):
    marker = Path(LOCAL_ROOT) / "logs" / "lock_child.json"
    marker.write_text(json.dumps(kw), encoding="utf-8")
    cmd = [sys.executable, LOCK, "run", "--machine", LOCK_MAIN, "--kind", "ue", "--who", "場所の柱・仮想iPad", "--job", job, "--vram", "8", "--minutes", str(minutes), "--wait", "600", "--no-table", "--",
           sys.executable, "-c", locked_local(job, minutes, None)]
    r = sh(cmd, check=False, timeout=minutes * 60 + 900)
    text = r.stdout + r.stderr
    for line in text.splitlines():
        if line.startswith("RESULT "):
            return json.loads(line[7:])
    raise RuntimeError("札か UE の実行に失敗: " + text[-1500:])


def run(a):
    shoot = Path(a.shoot)
    name = a.name
    where = a.where
    truth_path = shoot / "truth.json"
    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    track_src = shoot / "track.json"
    if not track_src.exists() or a.provisional:
        track_src = shoot / "track_provisional.json"
        track_src.write_text(json.dumps(provisional_track(truth)), encoding="utf-8")
    used = shoot / "track_used.json"
    used.write_bytes(track_src.read_bytes())
    make_config(shoot, name, a.media, a.show_start, a.dots_stage, where, tuple(int(v) for v in a.res.split("x")))
    log = []
    dst = shoot / "frames"
    dst.mkdir(exist_ok=True)

    def rename_if_needed(p):
        if not a.suffix:
            return p
        target = dst / (p + a.suffix)
        if target.exists():
            import shutil
            shutil.rmtree(target)
        (dst / p).rename(target)
        return p + a.suffix

    if where == "main":
        if not a.no_build:
            code, sec, rep = run_local_step(f"{name} 組み立て", 20, mode="build", name=f"{name}_build", config=str(shoot / "comp_config.json"), timeout=1200)
            print("組み立て", code, sec, rep[:300], flush=True)
            log.append(("build", sec))
            if rep != "BUILD_OK":
                raise RuntimeError("組み立てに失敗: " + rep)
        for p in a.passes:
            cfg = "Cfg_CompMatte" if p in MATTE_PASSES else "Cfg_Comp"
            code, sec, _ = run_local_step(f"{name} {p}", 40, mode="render", name=f"{name}_{p}", pass_name=p, level=LEVEL_OF[p], cfg=cfg, timeout=2400)
            n = len(list((dst / p).glob("f.*.png")))
            d = rename_if_needed(p)
            print(f"{p}: 終了 {code}、{sec} 秒、{n} コマ", flush=True)
            log.append((p, sec, n))
        (shoot / f"ue_log_{name}.json").write_text(json.dumps(log), encoding="utf-8")
        return
    remote_dir = f"{REMOTE}/work/{name}"
    ssh(f"if not exist {win(remote_dir)} mkdir {win(remote_dir)}")
    for local, remote in ((shoot / "comp_config.json", "comp_config.json"), (truth_path, "truth.json"), (used, "track_used.json")):
        sh(["scp", str(local), f"{UE_HOST}:{remote_dir}/{remote}"])
    if not a.no_build:
        t0 = time.time()
        out = locked(f"{name} 組み立て", 20, f"{PS} -Mode build -Config {remote_dir}/comp_config.json -Tag {name}_build -TimeoutSec 1200", 1500)
        print(out.strip()[-1500:], flush=True)
        log.append(("build", round(time.time() - t0, 1)))
        if "BUILD_OK" not in out:
            raise RuntimeError("組み立てに失敗(上の出力を見る)")
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(max_workers=1)      # 取り戻しは、次のパスの撮影と並べて回す(サブ機の撮影を止めて待たない)
    futures = []

    def fetch(p, jpg):
        t2 = time.time()
        tar = f"{remote_dir}/{p}.tar"
        ssh(f"cd /d {win(remote_dir)}\\frames && tar -cf {win(tar)} {p}", timeout=600)      # サブ機の中で 1 本に固める
        sh(["scp", f"{UE_HOST}:{tar}", str(dst / f"{p}.tar")], timeout=3600)
        size = (dst / f"{p}.tar").stat().st_size
        sh(["tar", "-xf", str(dst / f"{p}.tar"), "-C", str(dst)])
        (dst / f"{p}.tar").unlink()
        ssh(f"del /q {win(tar)}", check=False)
        if jpg and p in PNG_NEEDED and not a.keep_jpg:      # composite.py は png で読むので、JPG を無劣化で PNG に直す
            import cv2
            import numpy as np
            for f in sorted((dst / p).glob("f.*.jp*g")):
                img = cv2.imdecode(np.fromfile(str(f), np.uint8), cv2.IMREAD_COLOR)
                f.with_suffix(".png").write_bytes(cv2.imencode(".png", img)[1].tobytes())
                f.unlink()
        p_dir = rename_if_needed(p)
        n = len(list((dst / p_dir).glob("f.*.*")))
        sec = round(time.time() - t2, 1)
        print(f"  {p}: 取り戻した {n} コマ、{size / 1e6:.0f} MB、{sec} 秒({size / 1e6 / max(sec, 0.1):.2f} MB/s)", flush=True)
        return (p + "_fetch", sec, n, size)

    for p in a.passes:
        use_jpg = a.jpg and p in JPG_PASSES
        cfg = "Cfg_CompMatte" if p in MATTE_PASSES else ("Cfg_CompJpg" if use_jpg else "Cfg_Comp")
        t1 = time.time()
        out = locked(f"{name} {p}", 40, f"{PS_TASK} -Pass {p} -Level {LEVEL_OF[p]} -Cfg {cfg} -Tag {name}_{p} -TimeoutSec 2400", 2700)
        sec = round(time.time() - t1, 1)
        print(p, out.strip()[-200:], "秒", sec, flush=True)
        log.append((p, sec))
        futures.append(pool.submit(fetch, p, use_jpg))
    for fu in futures:
        log.append(fu.result())
    (shoot / f"ue_log_{name}.json").write_text(json.dumps(log), encoding="utf-8")
    if not a.keep:
        ssh(f"rmdir /s /q {win(remote_dir)}", check=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["run"])
    ap.add_argument("--shoot", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--passes", nargs="+", default=["Comp_PlateWith", "Comp_PlateWithout"])
    ap.add_argument("--media", choices=["rehearsal", "dots"], default="rehearsal")
    ap.add_argument("--show-start", type=float, required=True)
    ap.add_argument("--dots-stage", action="store_true")
    ap.add_argument("--provisional", action="store_true", help="track.json があっても使わず、正解のカメラで組み立てる")
    ap.add_argument("--suffix", default="", help="取り戻した連番のフォルダ名に足す(例 _truth)")
    ap.add_argument("--res", default="1920x1080", help="撮る大きさ(カットの計画の絵は 1280x720)")
    ap.add_argument("--keep-jpg", action="store_true", help="取り戻した JPG を PNG に直さない(カットの計画の絵)")
    ap.add_argument("--jpg", action="store_true", help="色のパスを JPG(品質 95)で撮る(サブ機のみ)")
    ap.add_argument("--where", choices=["sub", "main"], default="sub")
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--keep", action="store_true")
    run(ap.parse_args())


if __name__ == "__main__":
    main()
