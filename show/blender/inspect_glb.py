"""GLB の中身(メッシュ・骨・動きの長さ)を表示する。  使い方: python inspect_glb.py <file.glb>"""
import json
import struct
import sys


def read_header(path):
    with open(path, "rb") as f:
        data = f.read()
    length = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + length])


def main():
    doc = read_header(sys.argv[1])
    print("meshes", [(m.get("name"), len(m["primitives"]), list(m["primitives"][0]["attributes"]))
                     for m in doc.get("meshes", [])])
    print("materials", [m.get("name") for m in doc.get("materials", [])])
    print("skins", [(s.get("name"), [doc["nodes"][j]["name"] for j in s["joints"]]) for s in doc.get("skins", [])])
    for anim in doc.get("animations", []):
        ends = [doc["accessors"][s["input"]]["max"][0] for s in anim["samplers"]]
        print("animation", anim.get("name"), "seconds", round(max(ends), 3), "channels", len(anim["channels"]))


main()
