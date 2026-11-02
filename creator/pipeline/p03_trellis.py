"""段 3: TRELLIS.2(作業用 PC のローカル ComfyUI)で、1 枚の絵から 3D の形(色なし)を作る。

使い方(GPU の札を取ってから):
  machine_lock.py run --machine pc1 --kind gpu --who hackathon_creator --job "TRELLIS" --minutes 40 --vram 16 -- \
    python p03_trellis.py <作業フォルダ> <名前>:<RGBA 絵>[:<seed>,<seed>] ...

- サーバーは自分で起動し(ポート 8191)、終わったら自分の PID だけを止める。すでに 8191 が上がっていたら止まる。
- 形だけを作る。TRELLIS.2 の色塗り(nvdiffrast を使う部品)は呼ばない。色は p05 で自分の絵から塗る。
- 出力: <作業フォルダ>/trellis/<名前>_s<seed>.glb と runs.json(秒・VRAM のピーク)
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

PORT = 8191
BASE = f"http://127.0.0.1:{PORT}"
START_PS1 = r"work\AI\scripts\start_comfyui_trellis_8190.ps1"


def get(path):
    # 生成の最中は応答が遅れるので、時間切れでは落とさず何度か試す
    for i in range(6):
        try:
            return json.load(urllib.request.urlopen(BASE + path, timeout=60))
        except (TimeoutError, urllib.error.URLError, ConnectionError):
            if i == 5:
                raise
            time.sleep(5)


def post(path, obj):
    req = urllib.request.Request(BASE + path, json.dumps(obj).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))


def vram_mb():
    out = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"])
    return int(out.decode().split()[0])


def graph(image_name, seed, prefix):
    """形だけの TRELLIS.2 グラフ(API 形式)。"""
    return {
        "6": {"class_type": "Trellis2LoadImageWithTransparency", "inputs": {"image": image_name}},
        "39": {"class_type": "Trellis2LoadModel", "inputs": {
            "modelname": "microsoft/TRELLIS.2-4B", "backend": "sdpa", "device": "cuda", "low_vram": True,
            "keep_models_loaded": False, "conv_backend": "flex_gemm", "sparse_backend": "flash_attn",
            "use_reconviagen": False}},
        "40": {"class_type": "Trellis2PreProcessImage", "inputs": {
            "image": ["6", 2], "padding": 10, "remove_background": False, "max_size": 1024}},
        "41": {"class_type": "Trellis2ImageCondGenerator", "inputs": {
            "pipeline": ["39", 0], "image": ["40", 0], "max_views": 1}},
        "42": {"class_type": "Trellis2SparseGenerator", "inputs": {
            "pipeline": ["41", 2], "image_cond": ["41", 0], "seed": seed, "sparse_structure_steps": 12,
            "sparse_structure_guidance_strength": 7.5, "sparse_structure_guidance_rescale": 0.01,
            "sparse_structure_rescale_t": 5, "sparse_structure_sampler": "heun", "sparse_structure_resolution": 64,
            "sparse_structure_guidance_interval_start": 0.1, "sparse_structure_guidance_interval_end": 1,
            "fill_holes": True, "hole_iterations": 1, "verbose": False, "dino_lock": 1, "dino_substeps": 8,
            "hole_fill_algorithm": "flood_fill", "dino_foundation_cap": 1, "keep_only_shell": True}},
        "43": {"class_type": "Trellis2ShapeGenerator", "inputs": {
            "pipeline": ["42", 2], "image_cond": ["41", 1], "coords": ["42", 0], "resolution": 1024,
            "shape_steps": 12, "shape_guidance_strength": 7.5, "shape_guidance_rescale": 0.01,
            "shape_rescale_t": 3, "shape_sampler": "heun", "shape_guidance_interval_start": 0.1,
            "shape_guidance_interval_end": 1, "verbose": False, "dino_lock": 0, "dino_substeps": 4,
            "dino_foundation_cap": 1}},
        "44": {"class_type": "Trellis2ShapeCascadeGenerator", "inputs": {
            "pipeline": ["43", 2], "image_cond": ["41", 1], "shape_slat": ["43", 0], "from_resolution": 512,
            "to_resolution": 1536, "sparse_structure_resolution": ["42", 1], "max_num_tokens": 999999,
            "shape_steps": 12, "shape_guidance_strength": 7.5, "shape_guidance_rescale": 0.01,
            "shape_rescale_t": 3, "shape_sampler": "heun", "shape_guidance_interval_start": 0.1,
            "shape_guidance_interval_end": 1, "verbose": False, "dino_lock": 0, "dino_substeps": 4,
            "dino_foundation_cap": 1}},
        "45": {"class_type": "Trellis2DecodeLatents", "inputs": {
            "pipeline": ["44", 2], "shape_slat": ["44", 0], "resolution": ["44", 1], "use_tiled_decoder": True}},
        "46": {"class_type": "Trellis2FillHolesWithCuMesh", "inputs": {"mesh": ["45", 0], "max_permieters": 1}},
        "47": {"class_type": "Trellis2ReconstructMeshWithQuad", "inputs": {
            "mesh": ["46", 0], "remesh_band": 1, "resolution": 1024, "remove_floaters": True,
            "remove_inner_faces": True}},
        "48": {"class_type": "Trellis2SimplifyMesh", "inputs": {
            "mesh": ["47", 0], "target_face_num": 400000, "method": "Cumesh"}},
        "49": {"class_type": "Trellis2FillHolesNicelyWithMeshlib", "inputs": {"mesh": ["48", 0]}},
        "50": {"class_type": "Trellis2MeshWithVoxelToTrimesh", "inputs": {
            "mesh": ["49", 0], "reorient_vertices": "90 degrees"}},
        "51": {"class_type": "Trellis2ExportMesh", "inputs": {
            "trimesh": ["50", 0], "filename_prefix": prefix, "file_format": "glb"}},
    }


def main():
    work = sys.argv[1]
    jobs = []
    for spec in sys.argv[2:]:
        parts = spec.split(":")
        # Windows のドライブ文字(C:\...)を含むので、右から切る
        seeds = [12345]
        if len(parts) >= 3 and parts[-1].replace(",", "").isdigit():
            seeds = [int(s) for s in parts.pop().split(",")]
        name = parts[0]
        jobs.append((name, ":".join(parts[1:]), seeds))
    in_dir = os.path.join(work, "comfy_in")
    out_dir = os.path.join(work, "comfy_out")
    tmp_dir = os.path.join(work, "comfy_tmp")
    final_dir = os.path.join(work, "trellis")
    for d in (in_dir, out_dir, tmp_dir, final_dir):
        os.makedirs(d, exist_ok=True)
    try:
        get("/system_stats")
        print(f"{PORT} がすでに上がっている。自分のではないので止まる", flush=True)
        sys.exit(2)
    except SystemExit:
        raise
    except Exception:
        pass
    base = vram_mb()
    log = open(os.path.join(work, "trellis_server.log"), "w")
    # 呼び出し元の Python の環境変数が残ると、別の版の標準ライブラリを読んで起動に失敗する(SRE module mismatch)
    env = {k: v for k, v in os.environ.items()
           if k not in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "PYTHONSAFEPATH", "UV_PYTHON")}
    proc = subprocess.Popen(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", START_PS1, "--port", str(PORT),
         "--input-directory", in_dir, "--output-directory", out_dir, "--temp-directory", tmp_dir],
        stdout=log, stderr=subprocess.STDOUT, env=env)
    print("server pid", proc.pid, flush=True)
    runs = {}
    t_start = time.time()
    try:
        for _ in range(300):
            try:
                get("/system_stats")
                break
            except Exception:
                time.sleep(2)
        print("server up", round(time.time() - t_start, 1), "s", flush=True)
        for name, img, seeds in jobs:
            shutil.copy(img, os.path.join(in_dir, f"{name}.png"))
            for seed in seeds:
                prefix = f"{name}_s{seed}"
                peak, stop = [vram_mb()], [False]

                def sample():
                    while not stop[0]:
                        peak[0] = max(peak[0], vram_mb())
                        time.sleep(2)

                th = threading.Thread(target=sample, daemon=True)  # 例外で止まっても居残らない
                th.start()
                t0 = time.time()
                r = post("/prompt", {"prompt": graph(f"{name}.png", seed, prefix), "client_id": str(uuid.uuid4())})
                pid = r.get("prompt_id")
                if not pid:
                    print("submit failed", r, flush=True)
                    stop[0] = True
                    th.join()
                    runs[prefix] = {"status": "submit_failed", "detail": r}
                    continue
                while True:
                    h = get("/history/" + pid)
                    if pid in h:
                        break
                    time.sleep(3)
                stop[0] = True
                th.join()
                h = h[pid]
                found = sorted(f for f in os.listdir(out_dir) if f.startswith(prefix) and f.endswith(".glb"))
                if found:
                    shutil.copy(os.path.join(out_dir, found[-1]), os.path.join(final_dir, prefix + ".glb"))
                runs[prefix] = {"seconds": round(time.time() - t0, 1), "vram_base_mb": base, "vram_peak_mb": peak[0],
                                "status": h["status"]["status_str"], "glb": found[-1] if found else None,
                                "err": [m for m in h["status"]["messages"] if m[0] == "execution_error"]}
                print(prefix, json.dumps(runs[prefix], ensure_ascii=False)[:600], flush=True)
    finally:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        print("server stopped", flush=True)
        with open(os.path.join(final_dir, "runs.json"), "w", encoding="utf-8") as f:
            json.dump(runs, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
