"""四角い面(壁・床など)を、PNG を貼った 1 枚ずつの四角として並べた GLB(glTF 2.0)を書く。

標準ライブラリ + numpy だけ。
  write_textured_quads_glb(path, quads)  quads: [{name, corners(4x3: 左下,右下,右上,左上), png(bytes), double_sided=True}]
  read_back_check(path)                  書いた GLB を読み戻して、数と accessor の min/max を確かめる
テクスチャの向き: 画像の左上 = corners[3]、右下 = corners[1]。glTF の UV は左上が原点なので
UV は 左下=(0,1) 右下=(1,1) 右上=(1,0) 左上=(0,0)。
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

_UV = np.array([[0, 1], [1, 1], [1, 0], [0, 0]], dtype="<f4")
_INDICES = np.array([0, 1, 2, 0, 2, 3], dtype="<u2")
_GLB_MAGIC = 0x46546C67
_JSON_TYPE = 0x4E4F534A
_BIN_TYPE = 0x004E4942
_FLOAT, _USHORT = 5126, 5123
_ARRAY_BUFFER, _ELEMENT_ARRAY_BUFFER = 34962, 34963


def _pad4(data: bytes, fill: bytes = b"\x00") -> bytes:
    return data + fill * (-len(data) % 4)


def _quad_normal(c: np.ndarray) -> np.ndarray:
    n = np.cross(c[1] - c[0], c[3] - c[0])
    length = float(np.linalg.norm(n))
    if length < 1e-12:
        raise ValueError("corners が一直線か 1 点につぶれていて、法線が出せない")
    return (n / length).astype("<f4")


def write_textured_quads_glb(path, quads) -> None:
    if not quads:
        raise ValueError("quads が空")
    blob = bytearray()
    views, accessors, images, textures, materials, meshes, nodes = [], [], [], [], [], [], []

    def add_view(data: bytes, target=None) -> int:
        while len(blob) % 4:
            blob.append(0)
        view = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
        if target:
            view["target"] = target
        blob.extend(data)
        views.append(view)
        return len(views) - 1

    def add_accessor(data: bytes, target, comp, count, typ, **extra) -> int:
        acc = {"bufferView": add_view(data, target), "componentType": comp, "count": count, "type": typ}
        acc.update(extra)
        accessors.append(acc)
        return len(accessors) - 1

    for i, q in enumerate(quads):
        c = np.asarray(q["corners"], dtype=np.float64)
        if c.shape != (4, 3):
            raise ValueError(f"quad {i}: corners は 4x3 にする(今は {c.shape})")
        png = bytes(q["png"])
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError(f"quad {i}: png が PNG のバイト列ではない")
        name = str(q.get("name", f"quad{i}"))
        pos = c.astype("<f4")
        nrm = np.tile(_quad_normal(c), (4, 1))
        a_pos = add_accessor(pos.tobytes(), _ARRAY_BUFFER, _FLOAT, 4, "VEC3",
                             min=pos.min(axis=0).tolist(), max=pos.max(axis=0).tolist())
        a_nrm = add_accessor(nrm.tobytes(), _ARRAY_BUFFER, _FLOAT, 4, "VEC3",
                             min=nrm.min(axis=0).tolist(), max=nrm.max(axis=0).tolist())
        a_uv = add_accessor(_UV.tobytes(), _ARRAY_BUFFER, _FLOAT, 4, "VEC2",
                            min=_UV.min(axis=0).tolist(), max=_UV.max(axis=0).tolist())
        a_idx = add_accessor(_INDICES.tobytes(), _ELEMENT_ARRAY_BUFFER, _USHORT, 6, "SCALAR",
                             min=[0], max=[3])
        images.append({"name": name, "mimeType": "image/png", "bufferView": add_view(png)})
        textures.append({"sampler": 0, "source": i})
        materials.append({
            "name": name,
            "pbrMetallicRoughness": {"baseColorTexture": {"index": i}, "metallicFactor": 0.0, "roughnessFactor": 1.0},
            "doubleSided": bool(q.get("double_sided", True)),
        })
        meshes.append({"name": name, "primitives": [{
            "attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "TEXCOORD_0": a_uv},
            "indices": a_idx, "material": i, "mode": 4}]})
        nodes.append({"name": name, "mesh": i})

    while len(blob) % 4:
        blob.append(0)
    gltf = {
        "asset": {"version": "2.0", "generator": "shootlog/glb_quads.py"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes, "materials": materials,
        "textures": textures, "images": images,
        "samplers": [{"magFilter": 9729, "minFilter": 9729, "wrapS": 33071, "wrapT": 33071}],
        "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = _pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = (struct.pack("<III", _GLB_MAGIC, 2, total)
           + struct.pack("<II", len(js), _JSON_TYPE) + js
           + struct.pack("<II", len(blob), _BIN_TYPE) + bytes(blob))
    Path(path).write_bytes(out)


def read_back_check(path) -> dict:
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != _GLB_MAGIC or version != 2 or length != len(data):
        raise ValueError("GLB ヘッダが不正")
    jlen, jtype = struct.unpack_from("<II", data, 12)
    if jtype != _JSON_TYPE:
        raise ValueError("最初のチャンクが JSON ではない")
    gltf = json.loads(data[20:20 + jlen].decode("utf-8"))
    boff = 20 + jlen
    blen, btype = struct.unpack_from("<II", data, boff)
    if btype != _BIN_TYPE:
        raise ValueError("2 つ目のチャンクが BIN ではない")
    binary = data[boff + 8:boff + 8 + blen]
    problems = []
    for ai, a in enumerate(gltf["accessors"]):
        v = gltf["bufferViews"][a["bufferView"]]
        ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
        dt = {_FLOAT: "<f4", _USHORT: "<u2"}[a["componentType"]]
        arr = np.frombuffer(binary, dtype=dt, count=a["count"] * ncomp, offset=v["byteOffset"]).reshape(a["count"], ncomp)
        if not (np.allclose(arr.min(axis=0), a["min"], atol=1e-6) and np.allclose(arr.max(axis=0), a["max"], atol=1e-6)):
            problems.append(f"accessor {ai}: min/max が実データと合わない")
        if v["byteOffset"] % 4:
            problems.append(f"bufferView {a['bufferView']}: 4 バイト境界でない")
    for ii, im in enumerate(gltf["images"]):
        v = gltf["bufferViews"][im["bufferView"]]
        if not binary[v["byteOffset"]:v["byteOffset"] + 8] == b"\x89PNG\r\n\x1a\n":
            problems.append(f"image {ii}: PNG の先頭ではない")
    if len(binary) != gltf["buffers"][0]["byteLength"]:
        problems.append("buffer の byteLength が BIN チャンクと違う")
    return {
        "nodes": len(gltf["nodes"]), "meshes": len(gltf["meshes"]), "images": len(gltf["images"]),
        "accessors": len(gltf["accessors"]), "triangles": sum(
            gltf["accessors"][p["indices"]]["count"] // 3 for m in gltf["meshes"] for p in m["primitives"]),
        "names": [n.get("name") for n in gltf["nodes"]],
        "problems": problems, "ok": not problems,
    }
