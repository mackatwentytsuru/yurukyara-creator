"""段 10c: pack の model.glb と動きの GLB を数字にする(予算の検査)。Tripo や別の版と並べるときの物差しにも使う。

使い方: python pk03_glb_report.py <pack のフォルダ または model.glb> [--json 出力.json]
出す物: ファイルの大きさ(model・動き 1 本あたりと合計)、三角形の数、頂点の数、材質の数、骨(スキンの関節)の数、モーフターゲットの数と名前、
        画像の数と大きさ、使っている拡張(KHR_*)、動きの長さと本数。
目安(Web で主役を動かす): 三角形 60,000 以下、model.glb 8MB 以下(上限 15MB)、材質 数個。外れたら WARN。
"""
import json
import os
import struct
import sys

TRIS_MAX, SIZE_GOAL, SIZE_MAX = 60000, 8 * 2 ** 20, 15 * 2 ** 20


def read_glb(path):
    d = open(path, "rb").read()
    n = struct.unpack("<I", d[12:16])[0]
    return json.loads(d[20:20 + n]), len(d)


def report_model(path):
    g, size = read_glb(path)
    acc = g.get("accessors", [])
    tris = verts = 0
    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            if "indices" in p:
                tris += acc[p["indices"]]["count"] // 3
            if "POSITION" in p.get("attributes", {}):
                verts += acc[p["attributes"]["POSITION"]]["count"]
    morph = sorted({t for m in g.get("meshes", []) for t in m.get("extras", {}).get("targetNames", [])})
    joints = sum(len(s.get("joints", [])) for s in g.get("skins", []))
    imgs = len(g.get("images", []))
    return {
        "file": os.path.basename(path), "bytes": size, "triangles": tris, "vertices": verts,
        "materials": len(g.get("materials", [])), "meshes": len(g.get("meshes", [])), "skins": len(g.get("skins", [])),
        "joints": joints, "morph_targets": morph, "images": imgs, "extensions": g.get("extensionsUsed", []),
    }


def main():
    a = sys.argv[1:]
    out_json = None
    if "--json" in a:
        i = a.index("--json")
        out_json = a[i + 1]
        del a[i:i + 2]
    target = a[0]
    pack = target if os.path.isdir(target) else os.path.dirname(target)
    model = os.path.join(pack, "model.glb") if os.path.isdir(target) else target
    r = {"model": report_model(model), "motions": []}
    mdir = os.path.join(pack, "motions")
    total = r["model"]["bytes"]
    if os.path.isdir(mdir):
        for f in sorted(os.listdir(mdir)):
            if f.endswith(".glb"):
                g, size = read_glb(os.path.join(mdir, f))
                acc = g.get("accessors", [])
                dur = 0.0
                for an in g.get("animations", []):
                    for s in an.get("samplers", []):
                        inp = acc[s["input"]]
                        if "max" in inp:
                            dur = max(dur, inp["max"][0])
                r["motions"].append({"name": f[:-4], "bytes": size, "seconds": round(dur, 2), "animations": len(g.get("animations", []))})
                total += size
    r["total_bytes"] = total
    m = r["model"]
    warns = []
    if m["triangles"] > TRIS_MAX:
        warns.append(f"三角形 {m['triangles']} が目安 {TRIS_MAX} を超える")
    if m["bytes"] > SIZE_MAX:
        warns.append(f"model.glb {m['bytes'] / 2**20:.1f}MB が上限 15MB を超える")
    elif m["bytes"] > SIZE_GOAL:
        warns.append(f"model.glb {m['bytes'] / 2**20:.1f}MB が目標 8MB を超える")
    if m["materials"] > 12:
        warns.append(f"材質 {m['materials']} 個は多い(描画が増える)。同じ見た目の物は 1 つにまとめる")
    r["warnings"] = warns
    print(f"model.glb {m['bytes'] / 1024:.0f}KB / 三角形 {m['triangles']} / 頂点 {m['vertices']} / 材質 {m['materials']} / 骨 {m['joints']} / モーフ {len(m['morph_targets'])}({', '.join(m['morph_targets'][:6])}) / 画像 {m['images']}")
    print(f"動き {len(r['motions'])} 本({', '.join(x['name'] + ' ' + str(x['seconds']) + '秒' for x in r['motions'])})、全部で {total / 1024:.0f}KB")
    print("拡張:", ", ".join(m["extensions"]) or "なし")
    for w in warns:
        print("WARN", w)
    if out_json:
        json.dump(r, open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
