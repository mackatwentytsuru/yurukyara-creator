"""character.json を、契約 K1 の形(creator/specs/character.schema.json)で確かめる。部品を足さずに動く小さな検証。

使い方: python creator/specs/validate_character.py <character.json>… [--no-files]
  --no-files: 書いてあるファイル(persona・model・motions・looks.2d.svg)があるかを見ない
終わりの番号: 0 = 全部合う、1 = 合わない物がある。
見る物: 型・要る項目・決まった値(enum)・形(pattern)・数の範囲・文字の長さ。スキーマの $ref や oneOf は使っていない(使ったら足す)。
"""
import json
import re
import sys
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent / "character.schema.json"
TYPES = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float), "boolean": bool}


def check(v, s, where, errs):
    t = s.get("type")
    if t:
        ts = t if isinstance(t, list) else [t]
        ok = any(isinstance(v, TYPES[x]) and not (x in ("integer", "number") and isinstance(v, bool)) for x in ts)
        if not ok:
            errs.append(f"{where}: 型が {t} でない({type(v).__name__})")
            return
    if "enum" in s and v not in s["enum"]:
        errs.append(f"{where}: {v!r} は決まった値 {s['enum']} にない")
    if isinstance(v, str):
        if "pattern" in s and not re.search(s["pattern"], v):
            errs.append(f"{where}: {v!r} が形 {s['pattern']} に合わない")
        if len(v) < s.get("minLength", 0) or len(v) > s.get("maxLength", 10 ** 9):
            errs.append(f"{where}: 長さ {len(v)} が範囲の外")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if "minimum" in s and v < s["minimum"] or "maximum" in s and v > s["maximum"]:
            errs.append(f"{where}: {v} が範囲の外")
        if "exclusiveMinimum" in s and v <= s["exclusiveMinimum"]:
            errs.append(f"{where}: {v} が {s['exclusiveMinimum']} 以下")
    if isinstance(v, dict):
        for k in s.get("required", []):
            if k not in v:
                errs.append(f"{where}: 要る項目 {k} が無い")
        props = s.get("properties", {})
        extra = s.get("additionalProperties", True)
        for k, x in v.items():
            if k in props:
                check(x, props[k], f"{where}.{k}", errs)
            elif isinstance(extra, dict):
                check(x, extra, f"{where}.{k}", errs)
            elif extra is False:
                errs.append(f"{where}: 知らない項目 {k}")
    if isinstance(v, list) and "items" in s:
        for i, x in enumerate(v):
            check(x, s["items"], f"{where}[{i}]", errs)


def file_refs(d):
    refs = [d.get("persona"), d.get("model")] + list((d.get("motions") or {}).values())
    two = (d.get("looks") or {}).get("2d") or {}
    refs.append(two.get("svg"))
    if isinstance(two.get("parts"), str):
        refs.append(two["parts"])
    for parts in (two.get("expressions") or {}).values():
        refs += list(parts.values())
    return [r for r in refs if isinstance(r, str)]


def validate(path, files=True):
    errs = []
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return [f"読めない: {e}"]
    check(d, json.loads(SCHEMA.read_text(encoding="utf-8")), "character", errs)
    if isinstance(d, dict):
        folder = Path(path).resolve().parent
        if d.get("id") and d["id"] != folder.name and folder.parent.name == "characters":
            errs.append(f"id {d['id']!r} がフォルダ名 {folder.name!r} と違う")
        if d.get("type") and not d.get("model"):
            errs.append("type があるのに model が無い")
        if files:
            for r in file_refs(d):
                if not (folder / r.split("#")[0]).exists():
                    errs.append(f"書いてあるファイルが無い: {r}")
    return errs


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    bad = 0
    for p in args:
        errs = validate(p, files="--no-files" not in sys.argv)
        print(("OK  " if not errs else "NG  ") + p)
        for e in errs:
            print("    " + e)
        bad += bool(errs)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
