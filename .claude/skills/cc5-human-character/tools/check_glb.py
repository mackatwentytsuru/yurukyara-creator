"""Stage 8: read pack/model.glb (and the motion GLBs) back with plain Python and compare to the FBX inventory.

Run: python -I check_glb.py <base folder>
Writes pack_work/check_report.json and pack_work/check_report.md.
"""
import io
import json
import os
import struct
import sys
import time

import numpy as np
from PIL import Image

BASE = sys.argv[1]
PACK = os.path.join(BASE, "pack")
WORK = os.path.join(BASE, "pack_work")
T0 = time.time()

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(p):
    d = open(p, "rb").read()
    assert d[:4] == b"glTF", "not a GLB"
    jl = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack("<I", d[off:off + 4])[0]
    b = d[off + 8:off + 8 + bl]
    return j, b


def view_bytes(j, b, vi):
    v = j["bufferViews"][vi]
    o = v.get("byteOffset", 0)
    return b[o:o + v["byteLength"]], v.get("byteStride")


def accessor(j, b, ai):
    a = j["accessors"][ai]
    n, c, dt = a["count"], NC[a["type"]], CT[a["componentType"]]
    if "bufferView" in a:
        raw, stride = view_bytes(j, b, a["bufferView"])
        o = a.get("byteOffset", 0)
        isz = np.dtype(dt).itemsize
        if stride and stride != c * isz:
            arr = np.ndarray((n, c), dtype=dt, buffer=raw, offset=o, strides=(stride, isz)).copy()
        else:
            arr = np.frombuffer(raw, dtype=dt, count=n * c, offset=o).reshape(n, c).copy()
    else:
        arr = np.zeros((n, c), dtype=dt)
    sp = a.get("sparse")
    if sp:
        ir, _ = view_bytes(j, b, sp["indices"]["bufferView"])
        idx = np.frombuffer(ir, dtype=CT[sp["indices"]["componentType"]], count=sp["count"], offset=sp["indices"].get("byteOffset", 0))
        vr, _ = view_bytes(j, b, sp["values"]["bufferView"])
        vals = np.frombuffer(vr, dtype=dt, count=sp["count"] * c, offset=sp["values"].get("byteOffset", 0)).reshape(-1, c)
        arr = arr.astype(dt).copy()
        arr[idx.astype(np.int64)] = vals
    if a.get("normalized") and dt != np.float32:
        arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def node_world(j):
    parent = {}
    for i, n in enumerate(j["nodes"]):
        for c in n.get("children", []):
            parent[c] = i
    local = []
    for n in j["nodes"]:
        m = np.eye(4)
        if "matrix" in n:
            m = np.array(n["matrix"]).reshape(4, 4).T
        else:
            r = quat_to_mat(n.get("rotation", [0, 0, 0, 1]))
            s = np.diag(n.get("scale", [1, 1, 1]))
            m[:3, :3] = r @ s
            m[:3, 3] = n.get("translation", [0, 0, 0])
        local.append(m)
    world = {}

    def w(i):
        if i not in world:
            world[i] = (w(parent[i]) @ local[i]) if i in parent else local[i]
        return world[i]

    for i in range(len(j["nodes"])):
        w(i)
    return world


res = {"made": time.strftime("%Y-%m-%d %H:%M:%S"), "items": [], "known_gaps": [], "not_checked": []}


def item(name, ok, value, expect=None):
    res["items"].append({"check": name, "ok": bool(ok), "value": value, "expect": expect})


inv = json.load(open(os.path.join(WORK, "inventory_blender.json"), encoding="utf-8"))
s3 = json.load(open(os.path.join(WORK, "s3_report.json"), encoding="utf-8"))
cj = json.load(open(os.path.join(PACK, "character.json"), encoding="utf-8"))
mp = os.path.join(PACK, "model.glb")
j, b = read_glb(mp)
size_mb = os.path.getsize(mp) / 1e6
item("model.glb size (MB, aim < 60)", size_mb < 60, round(size_mb, 2), "< 60")

# --- bones ---
fbx_bones = set(inv["armatures"][0]["bones"])
skin = j["skins"][0] if j.get("skins") else None
joints = {j["nodes"][i]["name"] for i in skin["joints"]} if skin else set()
item("skins present", bool(skin), len(j.get("skins", [])), ">= 1")
item("bone count = FBX", len(joints) == len(fbx_bones), len(joints), len(fbx_bones))
item("bone names = FBX", joints == fbx_bones, sorted(joints ^ fbx_bones)[:10], "[] difference")
roots = [n for n in skin["joints"] if not any(n in j["nodes"][p].get("children", []) for p in skin["joints"])]
item("one root bone", len(roots) == 1, [j["nodes"][r]["name"] for r in roots], 1)

# --- meshes, vertices, triangles ---
fbx_mesh = {m["name"]: m for m in inv["meshes"]}
world = node_world(j)
mesh_nodes = {n["mesh"]: i for i, n in enumerate(j["nodes"]) if "mesh" in n}
glb_names = {m["name"] for m in j["meshes"]}
item("mesh count = FBX", len(j["meshes"]) == len(fbx_mesh), len(j["meshes"]), len(fbx_mesh))
item("mesh names = FBX", glb_names == set(fbx_mesh), sorted(glb_names ^ set(fbx_mesh)), "[] difference")
tri_total = 0
allpos = []
vcounts = {}
morph_report = {}
weights_bad = 0
weights_n = 0
nonid_nodes = []
for mi, m in enumerate(j["meshes"]):
    ni = mesh_nodes.get(mi)
    wm = world[ni] if ni is not None else np.eye(4)
    if ni is not None and not np.allclose(wm, np.eye(4), atol=1e-6):
        nonid_nodes.append(m["name"])
    names = m.get("extras", {}).get("targetNames", [])
    uniq = []
    tri = 0
    for p in m["primitives"]:
        pos = accessor(j, b, p["attributes"]["POSITION"]).astype(np.float64)
        allpos.append((wm[:3, :3] @ pos.T).T + wm[:3, 3])
        uniq.append(pos)
        if "indices" in p:
            tri += j["accessors"][p["indices"]]["count"] // 3
        else:
            tri += len(pos) // 3
        if "WEIGHTS_0" in p.get("attributes", {}):
            wts = accessor(j, b, p["attributes"]["WEIGHTS_0"]).astype(np.float64)
            weights_n += len(wts)
            weights_bad += int((np.abs(wts.sum(1) - 1) > 1e-3).sum())
        for ti, t in enumerate(p.get("targets", [])):
            nm = names[ti] if ti < len(names) else f"#{ti}"
            dpos = accessor(j, b, t["POSITION"]).astype(np.float64)
            mag = float(np.linalg.norm(dpos, axis=1).max()) if len(dpos) else 0.0
            r = morph_report.setdefault(m["name"], {}).setdefault(nm, 0.0)
            morph_report[m["name"]][nm] = max(r, mag)
    tri_total += tri
    allv = np.vstack(uniq)
    nuniq = len(np.unique(np.round(allv, 6), axis=0))
    vcounts[m["name"]] = {"glb_vertices": int(len(allv)), "glb_unique_positions": int(nuniq),
                          "fbx_vertices": fbx_mesh.get(m["name"], {}).get("verts"),
                          "glb_tris": tri, "fbx_tris": fbx_mesh.get(m["name"], {}).get("tris")}
item("mesh nodes have identity transforms", not nonid_nodes, nonid_nodes, "[]")
tri_ok = all(v["glb_tris"] == v["fbx_tris"] for v in vcounts.values())
item("triangles per mesh = FBX", tri_ok, tri_total, inv["total_tris"])
uv_ok = all(v["glb_vertices"] >= v["fbx_vertices"] >= v["glb_unique_positions"] for v in vcounts.values())
item("vertices per mesh: GLB (split at UV/material seams) >= FBX >= unique positions", uv_ok,
     {k: [v["glb_vertices"], v["fbx_vertices"], v["glb_unique_positions"]] for k, v in vcounts.items()}, "glb >= fbx >= unique")
res["known_gaps"].append("bob_haircut: 34300 vertices kept, but only 33131 distinct positions (coincident hair-card vertices in the CC source; not a loss).")
item("skin weights sum to 1 (+-0.001)", weights_bad == 0, f"{weights_bad} of {weights_n}", 0)

P = np.vstack(allpos)
h = float(P[:, 1].max() - P[:, 1].min())
fbx_posed_h = s3_h = None
for st in s3["steps"]:
    if st["msg"] == "metres and floor":
        fbx_posed_h = st["bbox_max"][2] - st["bbox_min"][2]
fbx_bind_h = inv["world_bbox_all"]["max"][2] - inv["world_bbox_all"]["min"][2]
item("height = FBX (posed, after scaling) within 1 mm", abs(h - fbx_posed_h) <= 0.001, round(h, 5), round(fbx_posed_h, 5))
item("feet at y = 0 (+-1 cm)", abs(P[:, 1].min()) <= 0.01, round(float(P[:, 1].min()), 5), 0)
res["info_heights"] = {"glb_m": round(h, 5), "fbx_posed_m": round(fbx_posed_h, 5), "fbx_bind_pose_m": round(fbx_bind_h, 5),
                       "character_json_height_m": cj.get("height_m"), "runtime_scale": round(cj.get("height_m", h) / h, 4)}

# facing +Z: eye bones in front of the head bone
name_idx = {n.get("name"): i for i, n in enumerate(j["nodes"])}
head = world[name_idx["CC_Base_Head"]][:3, 3]
le = world[name_idx["CC_Base_L_Eye"]][:3, 3]
re_ = world[name_idx["CC_Base_R_Eye"]][:3, 3]
item("front is +Z (eyes ahead of head bone)", le[2] > head[2] and re_[2] > head[2], [round(float(le[2] - head[2]), 4), round(float(re_[2] - head[2]), 4)], "> 0")
item("her left eye at +X", le[0] > 0 > re_[0], [round(float(le[0]), 4), round(float(re_[0]), 4)], "L > 0 > R")

# --- shape keys ---
need = {cj["mouth"]["morph"], cj["blink"]["morph"]} | {k for d in cj.get("morphs", {}).values() for k in d}
have = {n for d in morph_report.values() for n in d}
item("contract keys present", need <= have, sorted(need), sorted(have))
zero = [f"{m}:{k}" for m, d in morph_report.items() for k, v in d.items() if v < 1e-5]
item("no key with all-zero displacement", not zero, zero, "[]")
face = ["CC_Base_Body", "Lash_Up_Wavy", "Lash_Low_Clustered", "CC_Base_EyeOcclusion", "CC_Base_TearLine"]
blink_all = [m for m in face if "blink" not in morph_report.get(m, {})]
item("blink on every eye-area mesh", not blink_all, blink_all, "[]")
mo = [m for m in ["CC_Base_Body", "CC_Base_Teeth", "CC_Base_Tongue"] if "mouth_open" not in morph_report.get(m, {})]
item("mouth_open on body, teeth, tongue", not mo, mo, "[]")
mins = {"blink": 0.004, "mouth_open": 0.005}
small = {k: round(morph_report["CC_Base_Body"].get(k, 0) * 1000, 2) for k in mins if morph_report["CC_Base_Body"].get(k, 0) < mins[k]}
item("body blink >= 4 mm, mouth_open >= 5 mm", not small, {k: round(v * 1000, 2) for k, v in morph_report["CC_Base_Body"].items()}, "mm")
res["morph_max_mm"] = {m: {k: round(v * 1000, 2) for k, v in d.items()} for m, d in morph_report.items()}
res["fbx_shape_key_counts"] = {m["name"]: m["shape_key_count"] for m in inv["meshes"] if m["shape_key_count"]}
res["known_gaps"].append("Only 7 derived keys are exported (blink, mouth_open, happy, sad, surprised, think, relaxed). "
                         "The 350-396 raw CC keys per mesh are dropped on purpose (file size); the name sets differ from the FBX by design.")

# --- look bones ---
nodes = {n.get("name") for n in j["nodes"]}
lk = cj["look"]
item("look.bone, look.head_bone and look.eyes exist", all(n in nodes for n in [lk["bone"], lk.get("head_bone", lk["bone"])] + lk["eyes"]), [lk["bone"], lk.get("head_bone")] + lk["eyes"], "in nodes")

# --- textures ---
tex = []
for im in j.get("images", []):
    raw, _ = view_bytes(j, b, im["bufferView"])
    with Image.open(io.BytesIO(raw)) as pi:
        tex.append({"name": im.get("name"), "mime": im.get("mimeType"), "size": list(pi.size), "kb": round(len(raw) / 1024)})
item("textures <= 2048 px", all(max(t["size"]) <= 2048 for t in tex), max(max(t["size"]) for t in tex), "<= 2048")
used = set()
for mat in j["materials"]:
    for k in ("baseColorTexture", "metallicRoughnessTexture"):
        if k in mat.get("pbrMetallicRoughness", {}):
            used.add(mat["pbrMetallicRoughness"][k]["index"])
    if "normalTexture" in mat:
        used.add(mat["normalTexture"]["index"])
missing_src = [i for i in used if "source" not in j["textures"][i]]
item("every material texture has an image", not missing_src, missing_src, "[]")
res["textures"] = {"count": len(tex), "total_mb": round(sum(t["kb"] for t in tex) / 1024, 2), "list": tex}
res["materials"] = [{"name": m["name"], "alphaMode": m.get("alphaMode", "OPAQUE"), "doubleSided": m.get("doubleSided", False)} for m in j["materials"]]
sss = [m["name"] for m in j["materials"] if any("volume" in e or "transmission" in e for e in m.get("extensions", {}))]
item("no SSS/transmission extensions", not sss, sss, "[]")

# --- motions ---
for name, rel in cj["motions"].items():
    mj, mb = read_glb(os.path.join(PACK, rel))
    anims = mj.get("animations", [])
    mn = {n.get("name") for n in mj["nodes"]}
    extra = sorted(mn - nodes - {None})
    dur = 0.0
    nkeys = 0
    if anims:
        for s in anims[0]["samplers"]:
            a = mj["accessors"][s["input"]]
            dur = max(dur, a["max"][0])
            nkeys = max(nkeys, a["count"])
    item(f"motion {name}: one animation named '{name}'", len(anims) == 1 and anims[0].get("name") == name, [a.get("name") for a in anims], name)
    item(f"motion {name}: node names subset of model", not extra, extra, "[]")
    item(f"motion {name}: 4 s at 30 fps", abs(dur - 4.0) < 1e-3 and nkeys == 121, [round(dur, 4), nkeys], [4.0, 121])

res["vertex_counts"] = vcounts
res["triangles_total"] = tri_total
res["not_checked"] = [
    "How the skin looks in a browser (this script reads numbers only; see web_check).",
    "Skin weights beyond 4 influences were cut by the exporter (Blender warned); faces not compared before/after the cut.",
    "Normal flips at key weight 1.0 (T15) and collar poke-through when the head turns (T13/T14).",
]
res["seconds"] = round(time.time() - T0, 1)
res["pass"] = all(i["ok"] for i in res["items"])
json.dump(res, open(os.path.join(WORK, "check_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

L = [f"# check_report (model.glb re-read) {res['made']}", "", f"Result: {'ALL OK' if res['pass'] else 'SOME NG'}  ({res['seconds']} s)", "",
     "| check | ok | value | expect |", "|---|---|---|---|"]
for i in res["items"]:
    v = json.dumps(i["value"], ensure_ascii=False)
    L.append(f"| {i['check']} | {'OK' if i['ok'] else 'NG'} | {v[:160]} | {json.dumps(i['expect'], ensure_ascii=False)[:60]} |")
L += ["", f"Heights: {res['info_heights']}", "", f"Textures: {res['textures']['count']} images, {res['textures']['total_mb']} MB inside the GLB", "",
      "Morph max displacement (mm): " + json.dumps(res["morph_max_mm"]), "", "Known gaps:"] + [f"- {g}" for g in res["known_gaps"]] + ["", "Not checked:"] + [f"- {n}" for n in res["not_checked"]]
open(os.path.join(WORK, "check_report.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("CHECK", "PASS" if res["pass"] else "FAIL", [i["check"] for i in res["items"] if not i["ok"]])
