#!/usr/bin/env python
"""VRM の形に、描画ページから書き出した骨の数字を動きとして足し、UE で読める GLB にする。
絵の動き(揺れ物と顔の形まで)をそのまま持っていくので、LED の絵と UE のキャラが同じ動きになる。
使い方: make_motion_glb.py <.vrm> <骨の数字の頭> <出力.glb> [--step 2]
"""
import argparse
import json
import pathlib
import re
import struct

import numpy as np

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
FLOAT = 5126
HEAD_FLOATS = 7  # 1 コマの頭: 体全体の位置 xyz と回転 xyzw
VRM_EXTENSIONS = {"VRMC_vrm", "VRMC_springBone", "VRMC_materials_mtoon"}


def read_glb(path):
    data = pathlib.Path(path).read_bytes()
    magic, _, _ = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"GLB ではない: {path}")
    json_len, _ = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + json_len])
    at = 20 + json_len
    bin_len, _ = struct.unpack_from("<II", data, at)
    return gltf, bytearray(data[at + 8:at + 8 + bin_len])


def write_glb(path, gltf, binary):
    body = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    body += b" " * (-len(body) % 4)
    binary = bytes(binary) + b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(body) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", GLB_MAGIC, 2, total))
        f.write(struct.pack("<II", len(body), CHUNK_JSON))
        f.write(body)
        f.write(struct.pack("<II", len(binary), CHUNK_BIN))
        f.write(binary)


def sanitize(name):
    """three の読み込みが直す名前(空白は _、[ ] . : / は消える)に合わせる"""
    return re.sub(r"[\[\].:/]", "", name.replace(" ", "_"))


def merge_meshes(gltf, binary):
    """全部の形を 1 つのメッシュにする(UE で 1 体として扱うため)。顔の形を持たない部分には、空の形を足して数をそろえる。"""
    nodes = [(i, n) for i, n in enumerate(gltf["nodes"]) if "mesh" in n]
    keep_index, keep = next((i, n) for i, n in nodes if gltf["meshes"][n["mesh"]]["primitives"][0].get("targets"))
    head = gltf["meshes"][keep["mesh"]]
    count = len(head["primitives"][0]["targets"])
    writer = Writer(gltf, binary)
    zeros = {}
    for i, node in nodes:
        if i == keep_index:
            continue
        for prim in gltf["meshes"][node.pop("mesh")]["primitives"]:
            size = gltf["accessors"][prim["attributes"]["POSITION"]]["count"]
            if size not in zeros:
                zeros[size] = writer.accessor(np.zeros((size, 3)), "VEC3", position_bounds=True)
            prim["targets"] = [{"POSITION": zeros[size]} for _ in range(count)]
            head["primitives"].append(prim)
        node.pop("skin", None)
    head["name"] = "Character"


def strip_vrm(gltf):
    gltf.pop("extensions", None)
    gltf["extensionsUsed"] = [e for e in gltf.get("extensionsUsed", []) if e not in VRM_EXTENSIONS]
    for material in gltf.get("materials", []):
        material.get("extensions", {}).pop("VRMC_materials_mtoon", None)


class Writer:
    def __init__(self, gltf, binary):
        self.gltf, self.binary = gltf, binary

    def accessor(self, array, kind, with_bounds=False, position_bounds=False):
        array = np.asarray(array, dtype=np.float32)
        self.binary.extend(b"\0" * (-len(self.binary) % 4))
        offset = len(self.binary)
        self.binary.extend(array.tobytes())
        self.gltf["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": array.size * 4})
        accessor = {"bufferView": len(self.gltf["bufferViews"]) - 1, "componentType": FLOAT, "count": len(array), "type": kind}
        if with_bounds:
            accessor["min"], accessor["max"] = [float(array.min())], [float(array.max())]
        if position_bounds:
            accessor["min"], accessor["max"] = array.min(axis=0).tolist(), array.max(axis=0).tolist()
        self.gltf["accessors"].append(accessor)
        return len(self.gltf["accessors"]) - 1


def q_mul(a, b):
    ax, ay, az, aw = a.T
    bx, by, bz, bw = b.T
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], axis=1)


def q_rotate(q, v):
    u, w = q[:, :3], q[:, 3:]
    return v + 2.0 * np.cross(u, np.cross(u, v) + w * v)


def apply_body(body_pos, body_rot, position, rotation):
    return body_pos + q_rotate(body_rot, position), q_mul(body_rot, rotation)


def add_animation(gltf, binary, head, pose, step):
    fps = head["fps"]
    frames = pose[::step]
    times = np.arange(len(frames), dtype=np.float32) * step / fps
    writer = Writer(gltf, binary)
    time_acc = writer.accessor(times, "SCALAR", with_bounds=True)
    samplers, channels = [], []

    def channel(node, path, values, kind):
        samplers.append({"input": time_acc, "output": writer.accessor(values, kind), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})

    index_of = {sanitize(n.get("name", "")): i for i, n in enumerate(gltf["nodes"])}
    missing = []
    children = {c for n in gltf["nodes"] for c in n.get("children", [])}
    for b, name in enumerate(head["bones"]):
        node = index_of.get(name)
        if node is None:
            missing.append(name)
            continue
        at = HEAD_FLOATS + b * 7
        position, rotation = frames[:, at:at + 3], frames[:, at + 3:at + 7]
        if node not in children:
            # 体全体の位置と向き(上がってくる・聞くときに向く)は、いちばん根の骨に持たせる
            position, rotation = apply_body(frames[:, :3], frames[:, 3:7], position, rotation)
        channel(node, "translation", position, "VEC3")
        channel(node, "rotation", rotation, "VEC4")
    if missing:
        raise ValueError(f"VRM に無い骨: {missing[:8]}")
    morph_from = HEAD_FLOATS + len(head["bones"]) * 7
    weights = frames[:, morph_from:].reshape(-1)
    for i, node in enumerate(gltf["nodes"]):
        if "mesh" in node and gltf["meshes"][node["mesh"]]["primitives"][0].get("targets"):
            names = gltf["meshes"][node["mesh"]]["extras"]["targetNames"]
            if names != head["morphs"]:
                raise ValueError("顔の形の並びが VRM と違う")
            channel(i, "weights", weights, "SCALAR")
    gltf["animations"] = [{"name": "show", "samplers": samplers, "channels": channels}]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vrm")
    ap.add_argument("pose")
    ap.add_argument("out")
    ap.add_argument("--step", type=int, default=1, help="何コマに 1 回残すか")
    a = ap.parse_args()
    head = json.loads(pathlib.Path(a.pose + ".json").read_text(encoding="utf-8"))
    pose = np.fromfile(a.pose + ".bin", dtype=np.float32).reshape(-1, head["floats_per_frame"])
    if len(pose) != head["frames"]:
        raise ValueError(f"コマ数が違う: {len(pose)} / {head['frames']}")
    if not np.isfinite(pose).all():
        raise ValueError("骨の数字に NaN がある")
    gltf, binary = read_glb(a.vrm)
    strip_vrm(gltf)
    merge_meshes(gltf, binary)
    add_animation(gltf, binary, head, pose, a.step)
    gltf["buffers"][0]["byteLength"] = len(binary)
    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    write_glb(a.out, gltf, binary)
    print(f"{a.out}: {len(pose) // a.step} コマ、動きの線 {len(gltf['animations'][0]['channels'])} 本、{len(binary) / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
