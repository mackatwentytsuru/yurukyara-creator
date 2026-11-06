"""段 10: 作った物を characters/<id>/ に並べて、character.json を書く。

使い方: python pk01_package.py <作業フォルダ(rig と face がある)> <characters/<id> の出力先> --id f_led --name パネルくん [--persona persona.md]
- model.glb / motions/*.glb を写し、character.json(type: rig)を作る。口は model.glb に mouth_open があればシェイプキー(pk02 を通る形)。
  なければ face/face_atlas.json の atlas の口(pk02 は通らない)。既定で "fur": {}(使わないなら --no-fur)。
- 表情・動き・目の骨・まばたきは、model.glb と motions フォルダの中身から決める(手で書かない)。顔の表は無くてもよい。
"""
import argparse
import json
import os
import shutil
import struct
import sys


def read_glb(path):
    d = open(path, "rb").read()
    n = struct.unpack("<I", d[12:16])[0]
    return json.loads(d[20:20 + n])


def glb_names(g):
    """model.glb の骨(ノード)の名前とモーフターゲットの名前。"""
    nodes = {n.get("name") for n in g.get("nodes", [])} - {None}
    morphs = set()
    for m in g.get("meshes", []):
        morphs.update(m.get("extras", {}).get("targetNames", []))
        for p in m.get("primitives", []):
            morphs.update(p.get("extras", {}).get("targetNames", []))
    return nodes, morphs


EXPR_MORPHS = {"happy": {"mouth_wide": 0.9}, "surprised": {"mouth_o": 1.0},
               "sad": {"eye_blink": 0.3}, "think": {"mouth_o": 0.3}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("out")
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--height", type=float, default=0.9)
    ap.add_argument("--persona", default=None)
    ap.add_argument("--look-bone", default=None, help="体を向ける骨。省くと head があれば head、なければ body")
    ap.add_argument("--no-fur", action="store_true", help='毛の殻を使わない("fur": false)。既定は "fur": {}')
    ap.add_argument("--glow", default=None, help="材質名:R,G,B:強さ(内側から光らせる材質。例 Paper:1,0.84,0.58:0.45)")
    a = ap.parse_args()
    rig, face = os.path.join(a.work, "rig"), os.path.join(a.work, "face")
    g = read_glb(os.path.join(rig, "model.glb"))
    nodes, morphs = glb_names(g)
    atlas_json = os.path.join(face, "face_atlas.json")
    atlas = json.load(open(atlas_json, encoding="utf-8")) if os.path.exists(atlas_json) else None
    os.makedirs(os.path.join(a.out, "motions"), exist_ok=True)
    shutil.copy(os.path.join(rig, "model.glb"), os.path.join(a.out, "model.glb"))
    motions = {}
    for f in sorted(os.listdir(os.path.join(rig, "motions"))):
        if f.endswith(".glb"):
            shutil.copy(os.path.join(rig, "motions", f), os.path.join(a.out, "motions", f))
            motions[f[:-4]] = "motions/" + f
    if a.persona:
        shutil.copy(a.persona, os.path.join(a.out, "persona.md"))
    look_bone = a.look_bone or ("head" if "head" in nodes else "body")
    look = {"bone": look_bone, "max_deg": [22, 14]}
    eyes = [e for e in ("eye_L", "eye_R") if e in nodes]
    if eyes:
        look["eyes"] = eyes
    cj = {"id": a.id, "name": a.name, "model": "model.glb", "type": "rig", "height_m": a.height,
          "fur": False if a.no_fur else {}}
    if "mouth_open" in morphs:
        # シェイプキーの口(creator/viewer/rigRuntime.js と pk02 が見る形)。表情の名前は標準の 5 つ
        # (atlas があればその行の名前)。キーが model にある表情だけ morphs に書く。
        exprs = [r for r in atlas["rows"] if r != atlas["blink_row"]] if atlas else ["neutral", "happy", "surprised", "sad", "think"]
        cj.update({"expressions": exprs, "motions": motions, "look": look,
                   "mouth": {"kind": "morph", "morph": "mouth_open", "gain": 1.2}})
        if "eye_blink" in morphs:
            cj["blink"] = {"morph": "eye_blink"}
        mm = {ex: w for ex, w in EXPR_MORPHS.items() if ex in exprs and all(k in morphs for k in w)}
        if mm:
            cj["morphs"] = mm
    elif atlas:
        # 顔の表(atlas)の口。pk02 は mouth.kind=morph を要求するので、この形は ERROR になる(警告を出す)。
        shutil.copy(os.path.join(face, "face_atlas.png"), os.path.join(a.out, "face_atlas.png"))
        exprs = [r for r in atlas["rows"] if r != atlas["blink_row"]]
        look.update({"face_shift": [0.03, 0.025]})
        cj.update({"expressions": exprs, "motions": motions, "look": look,
                   "mouth": {"kind": "atlas", "mesh": "Face", "cols": atlas["cols"], "levels": [0.08, 0.3, 0.6]},
                   "face": {"mesh": "Face", "atlas": "face_atlas.png", "cols": atlas["cols"], "rows": atlas["rows"],
                            "blink_row": atlas["blink_row"]}})
        print("WARN model に mouth_open がなく atlas の口で書いた(pk02 は atlas の口も通す)")
    else:
        sys.exit("model.glb に mouth_open のモーフがなく、face/face_atlas.json もない。口の作りが決められない")
    if a.persona:
        cj["persona"] = "persona.md"
    if a.glow:
        name, rgb, k = a.glow.split(":")
        cj["glow"] = {"material": name, "color": [float(x) for x in rgb.split(",")], "intensity": float(k)}
    with open(os.path.join(a.out, "character.json"), "w", encoding="utf-8") as f:
        json.dump(cj, f, ensure_ascii=False, indent=2)
    print("packaged", a.out, "expressions", cj["expressions"], "motions", list(motions))


if __name__ == "__main__":
    main()
