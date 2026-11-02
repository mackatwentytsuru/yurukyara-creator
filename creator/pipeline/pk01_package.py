"""段 10: 作った物を characters/<id>/ に並べて、character.json を書く。

使い方: python pk01_package.py <作業フォルダ(rig と face がある)> <characters/<id> の出力先> --id f_led --name パネルくん [--persona persona.md]
- model.glb / motions/*.glb / face_atlas.png を写し、character.json(type: rig)を作る。
- 表情と動きの名前は、顔の表(face_atlas.json)と motions フォルダの中身から決める(手で書かない)。
"""
import argparse
import json
import os
import shutil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("out")
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--height", type=float, default=0.9)
    ap.add_argument("--persona", default=None)
    ap.add_argument("--look-bone", default="body")
    a = ap.parse_args()
    rig, face = os.path.join(a.work, "rig"), os.path.join(a.work, "face")
    atlas = json.load(open(os.path.join(face, "face_atlas.json"), encoding="utf-8"))
    os.makedirs(os.path.join(a.out, "motions"), exist_ok=True)
    shutil.copy(os.path.join(rig, "model.glb"), os.path.join(a.out, "model.glb"))
    shutil.copy(os.path.join(face, "face_atlas.png"), os.path.join(a.out, "face_atlas.png"))
    motions = {}
    for f in sorted(os.listdir(os.path.join(rig, "motions"))):
        if f.endswith(".glb"):
            shutil.copy(os.path.join(rig, "motions", f), os.path.join(a.out, "motions", f))
            motions[f[:-4]] = "motions/" + f
    if a.persona:
        shutil.copy(a.persona, os.path.join(a.out, "persona.md"))
    exprs = [r for r in atlas["rows"] if r != atlas["blink_row"]]
    cj = {
        "id": a.id, "name": a.name, "model": "model.glb", "type": "rig", "height_m": a.height,
        "expressions": exprs, "motions": motions,
        "look": {"bone": a.look_bone, "max_deg": [22, 14], "face_shift": [0.03, 0.025]},
        "mouth": {"kind": "atlas", "mesh": "Face", "cols": atlas["cols"], "levels": [0.08, 0.3, 0.6]},
        "face": {"mesh": "Face", "atlas": "face_atlas.png", "cols": atlas["cols"], "rows": atlas["rows"],
                 "blink_row": atlas["blink_row"]},
    }
    if a.persona:
        cj["persona"] = "persona.md"
    with open(os.path.join(a.out, "character.json"), "w", encoding="utf-8") as f:
        json.dump(cj, f, ensure_ascii=False, indent=2)
    print("packaged", a.out, "expressions", exprs, "motions", list(motions))


if __name__ == "__main__":
    main()
