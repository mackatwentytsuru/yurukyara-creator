"""段 10b: pack の character.json が、ビューア(creator/viewer/rigRuntime.js)で動く形かを調べる。

使い方: python pk02_check_character.py <pack のフォルダ>
調べること(外れたら ERROR を出して終了コード 1):
- type が "rig"、model・motions のファイルがある、expressions が 1 つ以上ある、キーは最上位にある(rig の中に入れない)
- mouth.kind が "morph" で、mouth.morph が model.glb のモーフターゲットにある
- blink.morph、morphs の中のキー、look.eyes の骨、look.bone が、model.glb にある
- 動きの GLB の骨の名前が、model.glb の骨と合う
正しい形の例は、スキルの「character.json の正しい形」を見る。
"""
import json
import os
import struct
import sys


def read_glb(path):
    d = open(path, "rb").read()
    n = struct.unpack("<I", d[12:16])[0]
    return json.loads(d[20:20 + n])


def has_fur_material(g):
    """creator/viewer/furShell.js が毛の殻を重ねる材質(色の絵・法線の絵・sheen を持ち、抜きでない物)があるか。"""
    for m in g.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        sheen = "KHR_materials_sheen" in m.get("extensions", {})
        if sheen and "baseColorTexture" in pbr and "normalTexture" in m and m.get("alphaMode") != "MASK":
            return True
    return False


def main():
    pack = sys.argv[1]
    errs, warns = [], []
    cj = json.load(open(os.path.join(pack, "character.json"), encoding="utf-8"))
    for k in ("id", "name", "model", "type", "height_m", "expressions", "motions", "look", "mouth"):
        if k not in cj:
            errs.append(f"最上位に '{k}' がない" + ("(rig の中に入れていませんか)" if "rig" in cj else ""))
    if "rig" in cj:
        errs.append("'rig' の入れ子は使わない。look・mouth・blink・morphs は最上位に置く")
    if cj.get("type") != "rig":
        errs.append('type は "rig"')
    if not cj.get("expressions"):
        errs.append("expressions が空(表情ボタンが出ない)")
    mp = os.path.join(pack, cj.get("model", "model.glb"))
    if not os.path.exists(mp):
        errs.append(f"model がない: {mp}")
        print("\n".join("ERROR " + e for e in errs)); sys.exit(1)
    g = read_glb(mp)
    nodes = {n.get("name") for n in g.get("nodes", [])}
    morphs = set()
    for m in g.get("meshes", []):
        for t in m.get("extras", {}).get("targetNames", []):
            morphs.add(t)
        for p in m.get("primitives", []):
            for t in p.get("extras", {}).get("targetNames", []):
                morphs.add(t)
    for name, rel in cj.get("motions", {}).items():
        p = os.path.join(pack, rel)
        if not os.path.exists(p):
            errs.append(f"動き {name} のファイルがない: {rel}")
            continue
        an = read_glb(p)
        if not an.get("animations"):
            errs.append(f"動き {name} に animation がない")
        else:
            chn = {nd.get("name") for nd in an.get("nodes", [])}
            miss = chn - nodes - {None}
            if miss:
                warns.append(f"動き {name} の骨名が model に無い: {sorted(miss)[:4]}")
    mo = cj.get("mouth", {})
    if mo.get("kind") != "morph":
        errs.append('mouth.kind は "morph"(口をシェイプキーで動かすとき)。ないと口の開きが動かない')
    elif mo.get("morph") not in morphs:
        errs.append(f"mouth.morph '{mo.get('morph')}' が model のモーフターゲットにない(あるもの: {sorted(morphs)})")
    bl = cj.get("blink", {})
    if bl and bl.get("morph") not in morphs:
        errs.append(f"blink.morph '{bl.get('morph')}' が model のモーフターゲットにない")
    if not bl:
        warns.append("blink がない(まばたきが動かない)")
    for ex, d in (cj.get("morphs") or {}).items():
        for key in d:
            if key not in morphs:
                errs.append(f"morphs.{ex} の '{key}' が model のモーフターゲットにない")
    lk = cj.get("look", {})
    if lk.get("bone") and lk["bone"] not in nodes:
        errs.append(f"look.bone '{lk['bone']}' が model の骨にない(あるもの: {sorted(n for n in nodes if n)[:12]})")
    for e in lk.get("eyes", []) or []:
        if e not in nodes:
            errs.append(f"look.eyes の '{e}' が model の骨にない")
    if "fur" not in cj and has_fur_material(g):
        errs.append('毛足の材質があるのに fur がない。最上位に "fur": {} を書く(ブラウザの毛の殻。使わない理由があれば "fur": false)')
    for w in warns:
        print("WARN ", w)
    for e in errs:
        print("ERROR", e)
    print("OK" if not errs else f"NG {len(errs)} 件")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
