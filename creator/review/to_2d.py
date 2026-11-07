"""「この子にする」の直後に、段 0 の絵(K1 の部品つき SVG)を、動く 2D(まばたき・口・表情)にする(B4。11/8 第 12 波 b)。

使い方: python creator/review/to_2d.py <drawing.svg> <id> [--name 名前] [--out characters] [--role home] [--persona 人格の文.md]
出す物: <out>/<id>/2d/body.svg・2d/parts.json・character.json(looks.default = 2d)・persona.md(無い時だけ)
- 絵の部品(K1: body・head・eye_R/L・brow_R/L・mouth・arm_R/L・foot_R/L・ear_R/L・hat・cheek_R/L・back・shadow・accessory)を、
  2D の板の部品(creator/d2/README.md の決まり)へ並べ直す。色と形は元の絵のまま(よくしない・足さない)。
  足すのは、話す口(半分・開き)と、うれしい目(^^)と口だけ。
- 部品の箱は、ヘッドレスの Chrome で getBBox を測る(1 回の起動で全部。GPU は使わない)。
- 頭の無い絵(まるい 1 つの体に顔がある子)は、体を頭として使う(2D は頭に顔の枠が付く)。
終わりの番号: 0 = できた、1 = 絵が読めない・部品が足りない、2 = 箱を測れない。
"""
import argparse
import copy
import json
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "creator" / "pipeline"))
from d01_svg_to_png import find_chrome  # noqa: E402

SVGNS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVGNS)
JST = timezone(timedelta(hours=9))

# 2D の部品 ← 絵の部品(描く順 = 後ろ → 前)
BODY_PARTS = [
    ("shadow", ["shadow"]),
    ("behind", ["back"]),                 # 2D の back は「後ろ姿の板」の名前なので、体の後ろの物は behind にする
    ("feet", ["foot_R", "foot_L"]),
    ("arm_r", ["arm_R"]),
    ("arm_l", ["arm_L"]),
    ("body", ["body", "accessory"]),
    ("head", ["head", "ear_R", "ear_L", "hat"]),
]
Z = {"shadow": 0, "behind": 0.5, "feet": 1, "arm_r": 2, "arm_l": 2, "body": 3, "head": 5}
LOWER = {"shadow", "feet"}


def tag(e):
    return e.tag.split("}")[-1]


def load(svg_path):
    root = ET.parse(svg_path).getroot()
    vb = [float(v) for v in (root.get("viewBox") or "0 0 1254 1254").replace(",", " ").split()]
    defs = [e for e in root if tag(e) == "defs"]
    char = next((e for e in root.iter() if tag(e) == "g" and e.get("id") == "char"), root)
    xf = char.get("transform") if char is not root else None
    groups = {}
    for e in char:
        if tag(e) == "g" and e.get("id"):
            groups[e.get("id")] = e
    return root, vb, defs, xf, groups


def inner(e):
    """部品の <g> の中身(id を外した写し)。"""
    c = ET.Element(f"{{{SVGNS}}}g", {k: v for k, v in e.attrib.items() if k != "id"})
    for ch in e:
        c.append(copy.deepcopy(ch))
    return c


def wrap(new_id, elements, xf):
    """新しい部品の <g id>。元の <g id="char"> の transform を中に入れる(部品だけを切り出しても同じ所に描ける)。"""
    g = ET.Element(f"{{{SVGNS}}}g", {"id": new_id})
    host = g
    if xf:
        host = ET.SubElement(g, f"{{{SVGNS}}}g", {"transform": xf})
    for e in elements:
        host.append(e)
    return g


def measure(svg_text, ids):
    """ヘッドレスの Chrome で、部品ごとの箱(getBBox。transform を入れた後の座標)を測る。"""
    chrome = find_chrome()
    if not chrome:
        raise RuntimeError("Chrome が見つかりません(CHROME_PATH)")
    html = ("<!doctype html><html><body>" + svg_text + "<pre id='out'></pre><script>"
            "const r={};for(const id of " + json.dumps(ids) + "){const g=document.getElementById(id);"
            "if(!g)continue;const b=g.getBBox();r[id]=[b.x,b.y,b.width,b.height];}"
            "document.getElementById('out').textContent='BOX'+JSON.stringify(r)+'XOB';</script></body></html>")
    with tempfile.TemporaryDirectory(prefix="yc_2d_") as tmp:
        page = Path(tmp) / "m.html"
        page.write_text(html, encoding="utf-8")
        out = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={tmp}/u",
                              "--dump-dom", page.as_uri()], capture_output=True, text=True, encoding="utf-8", timeout=90)
    m = re.search(r"BOX(\{.*?\})XOB", out.stdout or "")
    if not m:
        raise RuntimeError("箱を測れませんでした")
    return json.loads(m.group(1))


def pad(b, p=10):
    return [round(b[0] - p, 1), round(b[1] - p, 1), round(b[2] + 2 * p, 1), round(b[3] + 2 * p, 1)]


def union(boxes):
    boxes = [b for b in boxes if b and b[2] > 0 and b[3] > 0]
    if not boxes:
        return None
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    return [x0, y0, x1 - x0, y1 - y0]


def mouth_shapes(box, xf):
    """話す口(半分・開き)と、うれしい口。閉じた口の箱の中に、こい色の口を描く(元の絵の口の線は使わない)。"""
    x, y, w, h = box
    cx, cy = x + w / 2, y + h / 2
    rw = max(w * 0.42, 14)
    dark, tongue = "#5a2a2a", "#ff8fa3"

    def mouth(ry):
        return (f'<ellipse cx="{cx:.1f}" cy="{cy + ry * 0.2:.1f}" rx="{rw:.1f}" ry="{ry:.1f}" fill="{dark}"/>'
                f'<ellipse cx="{cx:.1f}" cy="{cy + ry * 0.75:.1f}" rx="{rw * 0.55:.1f}" ry="{ry * 0.35:.1f}" fill="{tongue}"/>')

    half = max(h * 0.45, rw * 0.35)
    full = max(h * 0.85, rw * 0.7)
    smile = (f'<path d="M{cx - rw:.1f} {cy - full * 0.2:.1f} Q{cx:.1f} {cy + full * 1.1:.1f} {cx + rw:.1f} {cy - full * 0.2:.1f} Z" fill="{dark}"/>'
             f'<ellipse cx="{cx:.1f}" cy="{cy + full * 0.5:.1f}" rx="{rw * 0.5:.1f}" ry="{full * 0.22:.1f}" fill="{tongue}"/>')
    return {k: ET.fromstring(f'<g xmlns="{SVGNS}">' + (f'<g transform="{xf}">' if xf else "") + v + ("</g>" if xf else "") + "</g>")
            for k, v in (("half", mouth(half)), ("open", mouth(full)), ("smile", smile))}


def happy_eyes(boxes, color):
    """うれしい目(^^)。目の箱ごとに、上へふくらむ弧を 1 本(目の色で)。座標は測った箱(transform の後)のまま。"""
    parts = []
    for b in boxes:
        x, y, w, h = b
        cx, cy = x + w / 2, y + h * 0.6
        rw = w * 0.45
        sw = max(w * 0.16, 6)
        parts.append(f'<path d="M{cx - rw:.1f} {cy:.1f} Q{cx:.1f} {cy - h * 0.55:.1f} {cx + rw:.1f} {cy:.1f}" stroke="{color}" '
                     f'stroke-width="{sw:.1f}" fill="none" stroke-linecap="round"/>')
    return ET.fromstring(f'<g xmlns="{SVGNS}">' + "".join(parts) + "</g>")


def eye_color(groups):
    for gid in ("eye_R", "eye_L"):
        e = groups.get(gid)
        if e is None:
            continue
        for ch in e.iter():
            f = ch.get("fill")
            if f and f.startswith("#") and f.lower() not in ("#fff", "#ffffff"):
                return f
    return "#2b2b2b"


def build(svg_path, cid, name, out_root, role="home", persona=None):
    root, vb, defs, xf, groups = load(svg_path)
    for need in ("eye_R", "eye_L", "mouth"):
        if need not in groups:
            raise ValueError(f"顔の部品 {need} がありません")
    if "body" not in groups and "head" not in groups:
        raise ValueError("体の部品(body か head)がありません")
    has_head = "head" in groups
    layout = [(n, list(src)) for n, src in BODY_PARTS]
    if not has_head:   # まるい 1 つの体に顔: 体を頭として使う
        layout = [(n, src) for n, src in layout if n != "head"]
        layout = [("head" if n == "body" else n, src + (["ear_R", "ear_L", "hat"] if n == "body" else [])) for n, src in layout]

    eye_col = eye_color(groups)
    out = ET.Element(f"{{{SVGNS}}}svg", {"viewBox": " ".join(str(v) for v in vb)})
    for d in defs:
        out.append(d)
    used = []
    for new_id, src in layout:
        els = [inner(groups[s]) for s in src if s in groups]
        if els:
            out.append(wrap(new_id, els, xf))
            used.append(new_id)
    cheeks = [inner(groups[s]) for s in ("cheek_R", "cheek_L") if s in groups]
    if cheeks:
        out.append(wrap("cheeks", cheeks, xf))
    out.append(wrap("face.neutral.eyes", [inner(groups["eye_R"]), inner(groups["eye_L"])], xf))
    brows = [inner(groups[s]) for s in ("brow_R", "brow_L") if s in groups]
    if brows:
        out.append(wrap("face.neutral.brows", brows, xf))
    out.append(wrap("face.neutral.mouth_closed", [inner(groups["mouth"])], xf))
    # まず測る(口と目の位置から、足す口と目を描く)
    first = ET.tostring(out, encoding="unicode")
    ids = used + (["cheeks"] if cheeks else []) + ["face.neutral.eyes", "face.neutral.mouth_closed"] + (["face.neutral.brows"] if brows else [])
    probe = first.replace("</svg>", "".join(
        f'<g id="probe_{g}">' + ET.tostring(wrap("x", [inner(groups[g])], xf), encoding="unicode").replace(' id="x"', "") + "</g>"
        for g in ("eye_R", "eye_L", "mouth")) + "</svg>")
    boxes = measure(probe, ids + ["probe_eye_R", "probe_eye_L", "probe_mouth"])
    mbox = boxes["probe_mouth"]
    # 足す口は、測った箱(transform の後の座標)で描くので、transform を入れない
    shapes = mouth_shapes(mbox, None)
    for key, gid in (("half", "face.neutral.mouth_half"), ("open", "face.neutral.mouth_open")):
        g = ET.Element(f"{{{SVGNS}}}g", {"id": gid})
        g.append(shapes[key])
        out.append(g)
    hm = ET.Element(f"{{{SVGNS}}}g", {"id": "face.happy.mouth_closed"})
    hm.append(shapes["smile"])
    out.append(hm)
    he = ET.Element(f"{{{SVGNS}}}g", {"id": "face.happy.eyes"})
    he.append(happy_eyes([boxes["probe_eye_R"], boxes["probe_eye_L"]], eye_col))
    out.append(he)
    svg_text = ET.tostring(out, encoding="unicode")
    if 'xmlns="' not in svg_text[:200]:
        svg_text = svg_text.replace("<svg ", f'<svg xmlns="{SVGNS}" ', 1)
    head = (f'<!-- {cid} の 2D。段 0 の絵(Claude が描いた SVG)の部品を、板の部品に並べ直した(色と形は元の絵のまま)。'
            "足したのは、話す口(半分・開き)と、うれしい目と口だけ。creator/review/to_2d.py が作った -->\n")

    allbox = union([boxes.get(i) for i in used])
    if not allbox:
        raise RuntimeError("部品の箱が空です")
    view = pad(allbox, 24)
    parts = {}
    for n in used:
        b = boxes.get(n)
        if not b or b[2] <= 0:
            continue
        bb = pad(b, 12)
        p = {"box": bb, "z": Z[n]}
        if n in LOWER:
            p["upper"] = False
        x, y, w, h = b
        if n == "head":
            p["pivot"] = [round(x + w / 2, 1), round(y + h * 0.92, 1)]
        elif n == "body":
            p["pivot"] = [round(x + w / 2, 1), round(y + h, 1)]
        elif n == "arm_r":
            p["pivot"] = [round(x + w * 0.8, 1), round(y + h * 0.18, 1)]
        elif n == "arm_l":
            p["pivot"] = [round(x + w * 0.2, 1), round(y + h * 0.18, 1)]
        parts[n] = p
    eye_box = union([boxes["probe_eye_R"], boxes["probe_eye_L"]])
    mouth_box = union([mbox, [mbox[0] + mbox[2] / 2 - max(mbox[2] * 0.42, 14), mbox[1] + mbox[3] / 2 - max(mbox[3] * 0.85, 10),
                              2 * max(mbox[2] * 0.42, 14), 2.6 * max(mbox[3] * 0.85, 10)]])
    face = {"eyes": {"box": pad(eye_box, 16)}, "mouth": {"box": pad(mouth_box, 14)}}
    if brows and boxes.get("face.neutral.brows"):
        face["brows"] = {"box": pad(boxes["face.neutral.brows"], 10)}
    spec = {
        "version": 1, "id": cid, "svg": "body.svg", "viewBox": view, "heightM": 1.0, "pxPerUnit": 1,
        "waist": parts.get("body", parts["head"])["pivot"], "parts": parts, "face": face,
        "blink": {"noBlink": ["happy"]}, "expressionFallback": {},
    }
    if cheeks and boxes.get("cheeks"):
        spec["faceLayers"] = [{"id": "cheeks", "box": pad(boxes["cheeks"], 6)}]

    # SVG の viewBox も、部品の表と同じ範囲にする(紙の余白で小さく写らないように)。説明の文は <svg> の頭の後ろに置く
    svg_text = re.sub(r'viewBox="[^"]*"', 'viewBox="' + " ".join(f"{v:g}" for v in view) + '"', svg_text, count=1)
    i = svg_text.index(">") + 1
    svg_text = svg_text[:i] + "\n" + head + svg_text[i:]
    cdir = Path(out_root) / cid
    (cdir / "2d").mkdir(parents=True, exist_ok=True)
    (cdir / "2d" / "body.svg").write_text(svg_text + "\n", encoding="utf-8", newline="\n")
    (cdir / "2d" / "parts.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    cj = cdir / "character.json"
    old = json.loads(cj.read_text(encoding="utf-8")) if cj.exists() else {}
    looks = dict(old.get("looks") or {})
    looks["2d"] = {"parts": "2d/parts.json"}
    if not old.get("model"):
        looks["default"] = "2d"
    rec = {**old, "id": cid, "name": name or old.get("name") or cid, "schema_version": old.get("schema_version", 1),
           "persona": "persona.md", "looks": looks, "role": role if role in ("home", "shop", "station", "facility") else "home"}
    rec.setdefault("origin", {"drawn_by": "claude", "created": datetime.now(JST).isoformat(timespec="seconds")})
    cj.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    pm = cdir / "persona.md"
    if not pm.exists():
        pm.write_text(persona or default_persona(rec["name"], rec["role"]), encoding="utf-8", newline="\n")
    return {"dir": str(cdir), "parts": list(parts), "face": list(face), "viewBox": view}


ROLE_LINE = {"home": "おうち", "shop": "お店の案内", "station": "駅や町の案内", "facility": "学校や施設"}
ROLE_SCENE = {"home": "おうちで、家族と話す", "shop": "お店で、来た人に お店の ことを 案内する",
              "station": "駅や町で、来た人に 道や 町の ことを 案内する", "facility": "学校や施設で、来た人と 話して 案内する"}


def default_persona(name, role="home"):
    """最初の人格の文(性格は画面で選ぶ。ここは名前と役目と、正直さの決まりだけ)。"""
    return (f"# {name}\n\n- 生まれ: 使う人の言葉か絵から、Claude が描いた絵で生まれたゆるキャラ。\n"
            f"- 役目: {ROLE_LINE.get(role, 'おうち')}({ROLE_SCENE.get(role, ROLE_SCENE['home'])})\n"
            "- 話し方: やさしく、短く。むずかしい言葉は使わない。相手は名前で呼ぶ(名前を覚えていないときは「きみ」)。\n"
            "- 分からない時は、推測で答えず、正直に「わからない」と言う。\n"
            "- 自分の体でできないことを、しているふりはしない。\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description="段 0 の絵を、動く 2D にする")
    ap.add_argument("svg")
    ap.add_argument("id")
    ap.add_argument("--name")
    ap.add_argument("--out", default=str(ROOT / "characters"))
    ap.add_argument("--role", default="home")
    a = ap.parse_args(argv)
    if not re.match(r"^[a-z0-9_]{1,32}$", a.id):
        print(json.dumps({"ok": False, "error": "id の形が違います"}, ensure_ascii=False))
        return 1
    try:
        r = build(a.svg, a.id, a.name, a.out, a.role)
    except (ValueError, ET.ParseError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    except (RuntimeError, subprocess.SubprocessError, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **r}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
