#!/usr/bin/env python3
"""E04: CC5 bridge command-line client (Python 3.8+, standard library only).

Runs on the same machine as CC5; no SSH tunnel or MCP dependency.
--dry-run traces every request without connecting to CC5 or writing image files.
Route/body contract: route_table.md (read directly from the local bridge source).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import sys
import time
from datetime import datetime, timezone
import urllib.error
import urllib.request


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def checked(result, path):
    if isinstance(result, dict) and result.get("success") is False:
        raise RuntimeError("%s: %s" % (path, result.get("error", result)))
    return result


class Client:
    def __init__(self, port, host_header, timeout, dry_run):
        self.port = port
        self.host_header = host_header or "127.0.0.1:%d" % port
        self.timeout = timeout
        self.dry_run = dry_run
        self.calls = []

    def request(self, method, path, body=None):
        record = {"time": stamp(), "method": method, "path": path}
        if body is not None:
            record["body"] = body
        self.calls.append(record)
        if self.dry_run:
            print("DRY HTTP " + json.dumps(record, ensure_ascii=False, sort_keys=True), flush=True)
            if path == "/health":
                return {"status": "dry-run", "version": "not measured"}
            if path == "/api":
                return {"version": "dry-run"}
            if path == "/camera/info":
                return {"name": "Preview Camera (dry-run)", "position": None, "focal_length": None}
            if path == "/workflow/transform/get":
                return {"success": True, "name": body.get("item_name") if body else None,
                        "move": [0, 0, 0], "rotate": [0, 0, 0], "scale": [100, 100, 100]}
            if path == "/morph/get":
                return {"success": True, "morph_id": body.get("morph_id"), "value": 0.0}
            if path == "/ui/job":
                return {"success": True, "state": "done", "result": {"success": True}}
            return {"success": True, "dry_run": True}
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:%d%s" % (self.port, path), data=payload,
            headers={"Host": self.host_header, **({"Content-Type": "application/json"} if payload is not None else {})},
            method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise RuntimeError("HTTP %d %s: %s" % (exc.code, path, exc.read().decode("utf-8", errors="replace"))) from exc
        return checked(data.get("result", data) if isinstance(data, dict) else data, path)

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, data):
        return self.request("POST", path, data)


def existing_result_file(path, client, wait_sec=None):
    """CC5 writes on its own host; wait until a stable nonempty output file appears."""
    if client.dry_run:
        return None
    timeout = wait_sec or client.timeout
    p = Path(path)
    deadline = time.monotonic() + timeout
    last_size = -1
    stable = 0
    while time.monotonic() < deadline:
        if p.is_file():
            size = p.stat().st_size
            if size > 0 and size == last_size:
                stable += 1
                if stable >= 2:
                    return hashlib.sha256(p.read_bytes()).hexdigest()
            else:
                stable = 0
            last_size = size
        time.sleep(0.25)
    raise TimeoutError("output file not stable before deadline: %s" % p)


def camera_restore(client, old_camera):
    """Preview Camera has no API transform setter. Best-effort frame only; document discrepancy."""
    try:
        after = client.get("/camera/info")
        if old_camera.get("position") != after.get("position"):
            return {"restored": False, "reason": "preview camera pose is not settable through bridge",
                    "before": old_camera, "after": after}
        return {"restored": True, "before": old_camera, "after": after}
    except Exception as exc:
        return {"restored": False, "error": str(exc)}


def default_protocol_path():
    return str(Path(__file__).resolve().parent / "protocol_v1.json")


def shot_list(protocol, sets, matched_override=None):
    poses = protocol["poses"]
    match = matched_override if matched_override is not None else poses["q34"].get("rx_matched")
    fallback = match is None
    if fallback:
        match = protocol.get("matched_rx_fallback", 6)
    shots = []
    for name in sets:
        if name in ("front_grid", "front_fine"):
            for rx in poses[name]["rx"]:
                shots.append({"set": name, "rx": rx, "ry": 0, "rz": 0, "dolly": 0})
        elif name in ("side_grid", "side_fine", "side_yaw"):
            for rz in poses[name]["rz"]:
                for rx in poses[name]["rx"]:
                    shots.append({"set": name, "rx": rx, "ry": 0, "rz": rz, "dolly": 0})
        elif name == "dist_sweep":
            for dz in poses[name]["dolly_steps"]:
                shots.append({"set": name, "rx": match, "ry": 0, "rz": 0, "dolly": dz})
        elif name == "front_match":
            shots.append({"set": name, "rx": match, "ry": 0, "rz": 0, "dolly": 0})
        elif name == "side_match":
            shots.append({"set": name, "rx": poses[name]["rx"], "ry": 0, "rz": poses[name]["rz"], "dolly": 0})
        elif name == "q34":
            shots.append({"set": name, "rx": match, "ry": 0, "rz": poses[name]["rz"], "dolly": 0})
        elif name == "eyes":
            dz = poses[name]["dolly_steps"]
            shots.extend([
                {"set": name, "view": "front", "rx": match, "ry": 0, "rz": 0, "dolly": dz},
                {"set": name, "view": "q34", "rx": match, "ry": 0, "rz": poses["q34"]["rz"], "dolly": dz},
            ])
        elif name == "closed":
            shots.append({"set": name, "rx": match, "ry": 0, "rz": poses[name]["rz"],
                          "dolly": poses[name]["dolly_steps"], "blink": True})
        elif name == "repeat3":
            for n in range(poses[name]["repetitions"]):
                shots.append({"set": name, "repeat": n + 1, "rx": match, "ry": 0, "rz": 0, "dolly": 0})
        else:
            raise ValueError("unknown protocol set: %s" % name)
    return shots, fallback


def original_transform(client, avatar):
    result = client.post("/workflow/transform/get", {"item_name": avatar})
    keys = ("move", "rotate", "scale")
    if not all(isinstance(result.get(key), list) and len(result[key]) == 3 for key in keys):
        raise RuntimeError("/workflow/transform/get missing original move/rotate/scale; refusing to move avatar")
    return {key: result[key] for key in keys}


def restore_transform(client, avatar, original):
    return client.post("/workflow/transform/set", {"item_name": avatar, **original})


def machine_for(client, machine):
    return machine if machine != "auto" else ("pc1" if client.port == 5111 else "pc2" if client.port == 5101 else platform.node())


def shoot(client, args):
    protocol = read_json(args.protocol)
    choices = protocol["sets"]
    sets = choices if args.sets.lower() == "all" else [x.strip() for x in args.sets.split(",") if x.strip()]
    if not sets or any(x not in choices for x in sets):
        raise ValueError("valid sets: %s" % ", ".join(choices))
    shots, fallback = shot_list(protocol, sets, args.matched_rx)
    run = Path(args.out).resolve()
    if run.exists() and (run / "manifest.json").exists():
        raise FileExistsError("refuse to replace existing manifest: %s" % run)
    machine = machine_for(client, args.machine)
    t0 = stamp()
    health = client.get("/health")
    api = client.get("/api")
    avatars = client.get("/avatars")
    lights_before = client.get("/lights")
    visual = client.get("/visual/settings")
    if not client.dry_run and isinstance(avatars, list):
        if not any(x.get("name") == args.avatar for x in avatars if isinstance(x, dict)):
            raise RuntimeError("avatar not found: %s" % args.avatar)
    initial_camera = client.get("/camera/info")
    old = original_transform(client, args.avatar)
    project = args.project or None
    project_size = Path(project).stat().st_size if project and Path(project).is_file() else None
    manifest = {"schema": "et_cc5.manifest.v1", "dry_run": client.dry_run, "started": t0,
                "machine": machine, "hostname": socket.gethostname(),
                "bridge_port": client.port, "cc5_version": args.cc5_version or health.get("cc5_version") or (api.get("cc5_version") if isinstance(api, dict) else None),
                "bridge_version": api.get("version") if isinstance(api, dict) else None,
                "cc5_expected_version": protocol.get("cc5_expected_version"),
                "project_path": project, "project_size": project_size,
                "protocol": protocol, "protocol_path": str(Path(args.protocol).resolve()),
                "avatar": args.avatar, "avatar_transform_before": old,
                "camera_initial": initial_camera, "lights": lights_before,
                "visual_settings": visual, "rx_matched_provisional": fallback,
                "shots": [], "errors": [], "restore": {}}
    blink_values = {}
    current_set = None
    try:
        client.post("/expression/reset", {})
        for index, shot in enumerate(shots, 1):
            name = shot["set"]
            if name != current_set:
                preset = protocol["lights"].get(machine)
                if not preset:
                    raise ValueError("no light preset for machine: %s" % machine)
                try:
                    client.post("/asset/load", {"file_path": preset})
                except RuntimeError as exc:   # 11-03 作業用 PC: 照明の読み込みが 30 秒を超えて 504 になる。CC5 は読み続けているので、メインスレッドが空くまで待って続ける
                    if "504" not in str(exc) and "Timeout" not in str(exc):
                        raise
                    for _ in range(60):
                        time.sleep(3)
                        try:
                            h = client.get("/health").get("result", {})
                        except Exception:  # noqa: BLE001
                            continue
                        if not h.get("main_thread_blocked"):
                            break
                    time.sleep(3)
                # 照明(.iAtm)を読んだ直後の 1 枚目は、まだ落ち着いておらず外れ値になる(作業用 PC で 11-03 に実測。σ_shot が 16 倍)。捨て描画を 1 枚入れて待つ
                time.sleep(float(protocol.get("settle_sec_after_light", 1.5)))
                client.post("/viewport/capture", {"output_path": str(run / "_warmup_discard.png"), "width": 800, "height": 800})
                current_set = name
            shot_name = "%03d_%s%s_rx%+03d_rz%+04d.png" % (
                index, name, ("_" + shot["view"]) if shot.get("view") else "",
                shot["rx"], shot["rz"])
            out = run / shot_name
            if not client.dry_run and out.exists():
                raise FileExistsError("refusing to overwrite shot: %s" % out)
            if not client.dry_run:
                run.mkdir(parents=True, exist_ok=True)
            entry = {**shot, "size": {"width": protocol["image"]["width"], "height": protocol["image"]["height"]},
                     "path": shot_name, "sha256": None, "t_start": stamp(), "t_end": None,
                     "camera_info_before": None, "camera_info_after": None}
            manifest["shots"].append(entry)
            applied_dolly = False
            blink_started = False
            try:
                client.post("/workflow/transform/set",
                            {"item_name": args.avatar, "move": old["move"], "rotate": [shot["rx"], shot["ry"], shot["rz"]],
                             "scale": old["scale"]})
                if shot.get("blink"):
                    # Eye_Blink_L/R は「表情」のスライダー(形のモーフではない)。/morph/set だと Unknown morph ID(HTTP 400)になる(11-03 作業用 PC で実測)
                    ids = protocol["poses"]["closed"]["blink_morph_ids"]
                    for mid in ids:
                        blink_values[mid] = 0.0   # 撮影の前に /expression/reset 済みなので、もとの値は 0
                    client.post("/expression/set", {"expressions": [{"name": mid, "weight": protocol["poses"]["closed"]["blink_value"]} for mid in ids]})
                    blink_started = True
                client.post("/camera/frame", {"view": protocol["face"]["camera_view"]})
                time.sleep(float(protocol.get("settle_sec_after_frame", 0.8)))
                # 作業用 PC では、枠合わせ 1 回目の位置(y=-130)と 2 回目以降(y=-171.5)が違い、組の 1 枚目だけ外れ値になる=σ_shot が 16 倍の原因(11-03)。2 回押して落ち着かせる
                client.post("/camera/frame", {"view": protocol["face"]["camera_view"]})
                time.sleep(float(protocol.get("settle_sec_after_frame", 0.8)))   # 作業用 PC では、枠合わせの直後の 1 枚目が前の状態で撮れて外れ値になる(11-03)。画面が追いつくのを待つ
                if shot["dolly"]:
                    client.post("/camera/dolly", {"notches": shot["dolly"], "method": "win32"})
                    applied_dolly = True
                entry["camera_info_before"] = client.get("/camera/info")
                client.post("/viewport/capture",
                            {"output_path": str(out), "width": entry["size"]["width"], "height": entry["size"]["height"]})
                entry["sha256"] = existing_result_file(out, client)
                # 11-03 透かしの件: RenderImage が失敗すると、ブリッジが「窓のコピー」(メニューとデスクトップと CHARACTER CREATOR の透かしが写る)を黙って返す。
                # 頼んだ大きさと違う絵は、測定に使えないので、その場で止める(後の検査でなく、撮った直後に)
                png_w, png_h = png_size(out)
                if (png_w, png_h) != (entry["size"]["width"], entry["size"]["height"]):
                    raise RuntimeError("WINDOW_COPY: 頼んだ %dx%d と違う %dx%d の絵(窓のコピー=透かし入りの疑い)。Help > Activate Purchased Items を試す: %s"
                                       % (entry["size"]["width"], entry["size"]["height"], png_w, png_h, out))
                entry["camera_info_after"] = client.get("/camera/info")
                entry["t_end"] = stamp()
            finally:
                if applied_dolly:
                    client.post("/camera/dolly", {"notches": -shot["dolly"], "method": "win32"})
                if blink_started or blink_values:
                    try:
                        client.post("/expression/reset", {})
                    finally:
                        blink_values.clear()
        manifest["success"] = True
    except Exception as exc:
        manifest["success"] = False
        manifest["errors"].append("%s: %s" % (type(exc).__name__, exc))
        raise
    finally:
        try:
            manifest["restore"]["avatar"] = restore_transform(client, args.avatar, old)
        except Exception as exc:
            manifest["restore"]["avatar_error"] = str(exc)
        manifest["restore"]["camera"] = camera_restore(client, initial_camera)
        manifest["finished"] = stamp()
        manifest["http_calls"] = client.calls
        write_json(run / "manifest.json", manifest)
        print("MANIFEST " + str(run / "manifest.json"))
    return manifest


def png_size(path):
    """PNG の大きさ(幅, 高さ)を、ヘッダーだけ読んで返す。PNG でなければ (0, 0)"""
    with open(path, "rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return 0, 0
    import struct
    return struct.unpack(">II", head[16:24])


def parse_ids(file_path):
    data = Path(file_path).read_text(encoding="utf-8-sig").strip()
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        parsed = data.splitlines()
    if isinstance(parsed, dict):
        parsed = parsed.get("ids", [])
    if not isinstance(parsed, list) or not all(isinstance(x, str) and x.strip() for x in parsed):
        raise ValueError("ids file must contain JSON string array, {ids: [...]}, or one id per line")
    return [x.strip() for x in parsed]


def jacobian(client, args):
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    results = {"started": stamp(), "delta": args.delta, "morphs": [], "dry_run": client.dry_run}
    for mid in parse_ids(args.ids):
        base = float(client.post("/morph/get", {"morph_id": mid})["value"])
        if abs(base + args.delta) > 1.0 or abs(base - args.delta) > 1.0:
            raise ValueError("%s baseline %.4f +/- %.4f outside morph bounds [-1, 1]" % (mid, base, args.delta))
        record = {"id": mid, "baseline": base}
        try:
            for sign, name in ((1, "plus"), (-1, "minus")):
                target = base + sign * args.delta
                client.post("/morph/set", {"morph_id": mid, "value": target})
                run = out / ("%s_%s" % (mid.replace("/", "_").replace("\\", "_"), name))
                sub = argparse.Namespace(protocol=args.protocol, avatar=args.avatar, sets=args.sets,
                                         out=str(run), project=args.project, machine=args.machine,
                                         matched_rx=args.matched_rx, cc5_version=args.cc5_version)
                shot_manifest = shoot(client, sub)
                record[name] = {"value": target, "manifest": str(run / "manifest.json"),
                                "shots": len(shot_manifest["shots"])}
        finally:
            client.post("/morph/set", {"morph_id": mid, "value": base})
            actual = float(client.post("/morph/get", {"morph_id": mid})["value"])
            record["readback"] = actual
            record["reset_verified"] = abs(actual - base) < 1e-5
            if not record["reset_verified"]:
                raise RuntimeError("reset readback mismatch for %s: %s vs %s" % (mid, actual, base))
            results["morphs"].append(record)
            write_json(out / "jacobian.json", results)
    results["finished"] = stamp()
    write_json(out / "jacobian.json", results)


def add_common_shoot(p):
    p.add_argument("--protocol", default=default_protocol_path())
    p.add_argument("--avatar", required=True)
    p.add_argument("--sets", default="all", help="all or comma-separated protocol set names")
    p.add_argument("--out", required=True)
    p.add_argument("--machine", choices=("auto", "pc1", "pc2"), default="auto")
    p.add_argument("--project", help="CC5 project path for manifest provenance")
    p.add_argument("--cc5-version", help="CC5 version measured independently; bridge /health only exposes bridge version")
    p.add_argument("--matched-rx", type=float, default=None, help="measured front pitch; otherwise provisional +6")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=5101)
    parser.add_argument("--host-header", default=None, help="default: 127.0.0.1:<port>")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=float, default=120)
    sub = parser.add_subparsers(dest="command", required=True)
    for simple in ("health", "windows", "avatars", "expression-reset"):
        sub.add_parser(simple)
    p = sub.add_parser("widgets"); p.add_argument("--window", required=True)
    p = sub.add_parser("open"); p.add_argument("--project", required=True)
    p = sub.add_parser("save-as"); p.add_argument("--path", required=True)
    p = sub.add_parser("shoot"); add_common_shoot(p)
    p = sub.add_parser("morph-get"); p.add_argument("--id", required=True)
    p = sub.add_parser("morph-set"); p.add_argument("--id", required=True); p.add_argument("--value", type=float, required=True)
    p = sub.add_parser("morphs-set"); p.add_argument("--json", required=True)
    p = sub.add_parser("morph-search"); p.add_argument("--query", required=True)
    p = sub.add_parser("catalog"); p.add_argument("--out", required=True)
    p = sub.add_parser("jacobian"); add_common_shoot(p); p.add_argument("--ids", required=True); p.add_argument("--delta", type=float, default=0.2)
    p = sub.add_parser("export-obj"); p.add_argument("--item", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("light"); p.add_argument("--preset", required=True)
    for name in ("shader-get", "shader-set"):
        p = sub.add_parser(name); p.add_argument("--mesh", default="CC_Base_Body")
        p.add_argument("--material", required=True)
        if name == "shader-set":
            p.add_argument("--param", required=True)
            p.add_argument("--value", required=True, help="JSON number or array of numbers")
    args = parser.parse_args(argv)
    client = Client(args.port, args.host_header, args.timeout, args.dry_run)
    c = args.command
    if c == "shoot":
        result = shoot(client, args)
        print("SHOTS %d" % len(result["shots"]))
    elif c == "jacobian":
        jacobian(client, args); print("JACOBIAN " + str(Path(args.out) / "jacobian.json"))
    else:
        if c == "save-as" and Path(args.path).exists():
            raise FileExistsError("save-as refuses to overwrite an existing project: %s" % args.path)
        handlers = {
            "health": lambda: client.get("/health"),
            "windows": lambda: client.post("/ui/windows", {"target": "dialogs", "screenshot": False}),
            "avatars": lambda: client.get("/avatars"),
            "open": lambda: client.post("/workflow/open_project", {"file_path": args.project}),
            "save-as": lambda: client.post("/workflow/save", {"file_path": args.path}),
            "morph-get": lambda: client.post("/morph/get", {"morph_id": args.id}),
            "morph-set": lambda: client.post("/morph/set", {"morph_id": args.id, "value": args.value}),
            "morphs-set": lambda: client.post("/morphs/set", {"morphs": (lambda x: x.get("morphs") if isinstance(x, dict) else x)(read_json(args.json))}),
            "morph-search": lambda: client.post("/morphs/search", {"query": args.query}),
            "catalog": lambda: client.get("/morphs/catalog"),
            "export-obj": lambda: client.post("/workflow/export_obj", {"item_name": args.item, "file_path": args.out}),
            "light": lambda: client.post("/asset/load", {"file_path": args.preset}),
            "expression-reset": lambda: client.post("/expression/reset", {}),
            "shader-get": lambda: client.post("/material/shader/get", {"mesh_name": args.mesh, "material_name": args.material}),
            "shader-set": lambda: client.post("/material/shader/set", {"mesh_name": args.mesh, "material_name": args.material, "parameter_name": args.param,
                                                                      "values": (lambda x: x if isinstance(x, list) else [x])(json.loads(args.value))}),
        }
        if c == "widgets":
            result = {klass: client.post("/ui/widgets", {"class_name": klass, "ancestor": args.window, "limit": 200})
                      for klass in ("QWidget", "QPushButton", "QToolButton", "QLabel", "QComboBox", "QCheckBox", "QSlider")}
        else:
            result = handlers[c]()
        if c == "catalog":
            write_json(args.out, result)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("%s: %s" % (type(exc).__name__, exc), file=sys.stderr)
        sys.exit(1)



