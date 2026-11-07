"""検査を通った pack を characters/<id>/ に置き、会話の画面(web/)から呼べるようにする。

使い方: python creator/pipeline/pk04_install.py <pack のフォルダ> <id> [--name 表示の名前] [--persona 性格の文.md] [--force]
置く物: model.glb、motions/、character.json、顔の表(face.atlas があれば)、persona.md(無ければ、書き足す前提のひな形)。作業用の .blend は置かない。
印: character.json の origin に made_with(作った時の版。VERSION、無ければ "dev")と capabilities(今もっている表現の id。
    creator/capabilities.json の見分け方)を書く(creator/review/upgrade_offers.py の stamp)。
置きかえ(--force)の時: pack に無い使う人の項目(声・記憶・知識・見た目の方式・生まれた時の記録など)は、前の character.json から残す。
    名前は --name が無ければ前のまま。persona.md は --persona が無ければ前のまま。
呼び方: http://localhost:8787/?character=<id>
"""
import argparse
import json
import os
import re
import shutil
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.append(os.path.join(REPO, "creator", "review"))
import upgrade_offers as UO  # noqa: E402

# 作り直して置きかえる時に、前の character.json から残す項目(pack が書かない、使う人の物)
KEEP_ON_REPLACE = ("voice", "memory", "knowledge", "looks", "origin", "expression_hints", "expression_fallback", "schema_version")
ID_FORM = re.compile(r"^[a-z0-9_]+$")
PERSONA_TEMPLATE = """# {name}

- 役目: 来た人を迎えて、案内する。
- 話し方: やさしく、短く。むずかしい言葉は使わない。
- 分からないことは推測せず、スタッフに聞いてもらう。
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("id")
    ap.add_argument("--name")
    ap.add_argument("--persona")
    ap.add_argument("--force", action="store_true", help="同じ id があれば置きかえる")
    ap.add_argument("--characters", default=os.path.join(REPO, "characters"), help="置く先のキャラのフォルダ(試験用)")
    args = ap.parse_args()
    if not ID_FORM.match(args.id):
        sys.exit(f"id は英小文字・数字・_ だけにしてください: {args.id}")
    with open(os.path.join(args.pack, "character.json"), encoding="utf-8") as f:
        char = json.load(f)
    dest = os.path.join(args.characters, args.id)
    if os.path.exists(dest) and not args.force:
        sys.exit(f"もうあります: {dest}(置きかえるなら --force)")
    old = UO.read_char(dest) or {}
    char = {**char, **{k: old[k] for k in KEEP_ON_REPLACE if k in old and k not in char}}
    if not args.name and old.get("name"):
        char["name"] = old["name"]
    os.makedirs(os.path.join(dest, "motions"), exist_ok=True)
    shutil.copyfile(os.path.join(args.pack, char["model"]), os.path.join(dest, char["model"]))
    for rel in char["motions"].values():
        shutil.copyfile(os.path.join(args.pack, rel), os.path.join(dest, rel))
    atlas = (char.get("face") or {}).get("atlas")   # 顔の表(光る点・紙の顔)。置かないと、顔の面が空になる
    if atlas and os.path.exists(os.path.join(args.pack, atlas)):
        shutil.copyfile(os.path.join(args.pack, atlas), os.path.join(dest, atlas))
    char["id"] = args.id
    if args.name:
        char["name"] = args.name
    char["persona"] = "persona.md"
    persona_path = os.path.join(dest, "persona.md")
    if args.persona:
        shutil.copyfile(args.persona, persona_path)
    elif not os.path.exists(persona_path):
        with open(persona_path, "w", encoding="utf-8") as f:
            f.write(PERSONA_TEMPLATE.format(name=char.get("name", args.id)))
    with open(os.path.join(dest, "character.json"), "w", encoding="utf-8") as f:
        json.dump(char, f, ensure_ascii=False, indent=2)
    origin = UO.stamp(dest)
    print(f"置いた: {dest}\n呼び方: /?character={args.id}\n印: 版 {origin['made_with']}・表現 {', '.join(origin['capabilities']) or 'なし'}")


if __name__ == "__main__":
    main()
