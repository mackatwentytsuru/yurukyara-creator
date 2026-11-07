"""あとから新しい表現を入れる案内。作る道の表(creator/capabilities.json)と、使う人のキャラのフォルダを見くらべる。

使い方:
  python creator/review/upgrade_offers.py --text            やさしい日本語で、入れられる表現を出す(既定。人に見せる文だけ)
  python creator/review/upgrade_offers.py --json            同じ中身を JSON で出す(Claude 向けの kind・steps・preview_steps・undo_steps も)
  python creator/review/upgrade_offers.py --migrate         古い形の character.json を今の形にそろえる(何度流しても同じ。変える前に控えを取る。
                                                            人には、やさしい言葉だけを出す。変えた項目は控えの backup.json の changes)
  python creator/review/upgrade_offers.py --character <id>  そのキャラだけ(見本のキャラでも見られる)
  python creator/review/upgrade_offers.py --backup <id>     キャラのフォルダの控えを取る(入れる前に)
  python creator/review/upgrade_offers.py --restore <id> [--from <控えの名前>]  控えに戻す(性格の文と知識のファイルは変えない)
  --characters <フォルダ>  キャラのフォルダの場所(既定は characters/。試験用)
  --backups <フォルダ>     控えの場所(既定は creator/work/backups/。git に入らない)
見本のキャラ(プログラムと一緒に配る子)は、--character で名指しした時だけ出す。--migrate と --restore は見本を変えない。
版は、リポジトリの頭の VERSION(無ければ "dev")。キャラの版は character.json の origin.made_with(pk04_install.py が書く)。
終わりの番号: 0 = できた、1 = 直せない所があった、2 = 頼み方の誤り(知らない id など)。
"""
import argparse
import json
import re
import shutil
import struct
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CAPS_FILE = REPO / "creator" / "capabilities.json"
LOOK_3D = ("rig_morph", "rig_atlas", "vrm")


def read_version(repo=REPO):
    """プログラムの版。リポジトリの頭の VERSION(無い・空なら "dev")。"""
    try:
        return (Path(repo) / "VERSION").read_text(encoding="utf-8").strip() or "dev"
    except OSError:
        return "dev"


def version_key(v):
    """"1.2.3" → (1, 2, 3)。版の形でなければ None(dev や書いていない時)。"""
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", str(v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def load_caps(path=CAPS_FILE):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def get(d, dotted):
    for k in dotted.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def read_glb(path):
    """GLB の頭の JSON(形の鍵と骨の名前を読むだけ)。読めなければ空。"""
    try:
        b = Path(path).read_bytes()
        n = struct.unpack("<I", b[12:16])[0]
        return json.loads(b[20:20 + n])
    except (OSError, ValueError, struct.error):
        return {}


class Folder:
    """1 体のキャラのフォルダ。中身は要る時に 1 回だけ読む。"""

    def __init__(self, path, cj):
        self.path = Path(path)
        self.cj = cj
        self._glb = self._parts = self._ids = None

    def file(self, rel):
        return isinstance(rel, str) and (self.path / rel.split("#")[0]).is_file()

    @property
    def glb(self):
        if self._glb is None:
            model = self.cj.get("model") or ""
            g = read_glb(self.path / model) if str(model).lower().endswith(".glb") else {}
            morphs = set()
            for m in g.get("meshes", []):
                morphs.update(m.get("extras", {}).get("targetNames", []))
                for p in m.get("primitives", []):
                    morphs.update(p.get("extras", {}).get("targetNames", []))
            self._glb = (morphs, {n.get("name") for n in g.get("nodes", [])} - {None})
        return self._glb

    def parts_rel(self):
        """2D の parts.json の場所(web/src/character/looks.js の twoDHint と同じ決まり)。無ければ None。"""
        looks = self.cj.get("looks")
        two = looks.get("2d") if isinstance(looks, dict) else None
        if isinstance(two, dict) and isinstance(two.get("parts"), str):
            rel = two["parts"]
        elif isinstance(looks, dict) and two is None:
            rel = "2d/parts.json"
        else:
            return None
        return rel if self.file(rel) else None

    @property
    def parts(self):
        if self._parts is None:
            rel = self.parts_rel()
            try:
                self._parts = json.loads((self.path / rel).read_text(encoding="utf-8")) if rel else {}
            except (OSError, ValueError):
                self._parts = {}
        return self._parts

    @property
    def svg_ids(self):
        if self._ids is None:
            svg = None
            rel = self.parts_rel()
            if rel and isinstance(self.parts.get("svg"), str):
                svg = (self.path / rel).parent / self.parts["svg"]
            elif isinstance(get(self.cj, "looks.2d.svg"), str):
                svg = self.path / get(self.cj, "looks.2d.svg")
            try:
                text = svg.read_text(encoding="utf-8") if svg else ""
            except OSError:
                text = ""
            self._ids = set(re.findall(r'\bid="([^"]+)"', text))
        return self._ids

    def svg_source(self, cid, repo):
        """2D を作るのに使える元の SVG の場所(リポジトリからの相対)。looks.2d.svg → 段 0 のいちばん新しい絵 → 見本の絵。無ければ None。"""
        own = get(self.cj, "looks.2d.svg")
        if self.file(own):
            return f"characters/{cid}/{own}"
        draws = Path(repo) / "creator" / "work" / cid / "draw"
        rounds = [p for p in draws.glob("r*/drawing.svg") if p.parent.name[1:].isdigit()]
        if rounds:
            last = max(rounds, key=lambda p: int(p.parent.name[1:]))
            return last.relative_to(repo).as_posix()
        sample = f"creator/samples/{cid}_元の絵.svg"
        return sample if (Path(repo) / sample).is_file() else None

    def svg_2d(self, cid):
        """今の 2D の SVG の場所(parts.json の svg)。2D が無ければ None。"""
        rel = self.parts_rel()
        svg = self.parts.get("svg") if rel else None
        return f"characters/{cid}/{(Path(rel).parent / svg).as_posix()}" if isinstance(svg, str) else None

    def has_svg_drawing(self, cid, repo):
        """2D を作るのに使える元の SVG があるか(段 0 の絵・looks.2d.svg・見本の絵)。"""
        return self.svg_source(cid, repo) is not None


def kinds_of(f):
    """キャラの種類(capabilities.json の kinds)。2D と 3D の両方を持つ子もいる。"""
    out = []
    model = str(f.cj.get("model") or "")
    if f.cj.get("type") == "vrm" or model.lower().endswith(".vrm"):
        out.append("vrm")
    elif f.cj.get("type") == "rig":
        out.append("rig_atlas" if get(f.cj, "mouth.kind") == "atlas" else "rig_morph")
    if f.parts_rel():
        out.append("2d")
    return out


def _count(v):
    if isinstance(v, list):
        return len(v)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else -1


def check_rule(rule, f):
    """見分け方の決まり 1 つ(capabilities.json の rules)。知らない決まりは止める(表の書き誤りを見逃さない)。"""
    cj = f.cj
    if "json" in rule:
        v = get(cj, rule["json"])
        return not (v is None or v is False or (isinstance(v, (str, list, dict)) and not v))
    if "json_has" in rule:
        lst = get(cj, rule["json_has"])
        vals = rule["values"] if "values" in rule else [get(cj, rule["values_of"])]
        return isinstance(lst, list) and None not in vals and all(v in lst for v in vals)
    if "json_keys" in rule:
        d = get(cj, rule["json_keys"])
        return isinstance(d, dict) and all(k in d for k in rule["values"])
    if "num_min" in rule:
        return _count(get(cj, rule["num_min"])) >= rule["min"]
    if "glb_morph_of" in rule:
        return get(cj, rule["glb_morph_of"]) in f.glb[0]
    if "glb_morphs" in rule:
        return all(m in f.glb[0] for m in rule["glb_morphs"])
    if "glb_nodes_of" in rule:
        names = get(cj, rule["glb_nodes_of"])
        return isinstance(names, list) and bool(names) and all(n in f.glb[1] for n in names)
    if "motion_files" in rule:
        mo = cj.get("motions") if isinstance(cj.get("motions"), dict) else {}
        return all(f.file(mo.get(n)) for n in rule["motion_files"])
    if "svg_ids" in rule:
        return all(i in f.svg_ids for i in rule["svg_ids"])
    if "svg_faces" in rule:
        return all(any(i.startswith(f"face.{e}.") for i in f.svg_ids) for e in rule["svg_faces"])
    if "parts_json" in rule:
        return rule["parts_json"] in f.parts
    if "parts_ids" in rule:
        p = f.parts.get("parts")
        names = set(p) if isinstance(p, (dict, list)) else set()
        return all(n in names for n in rule["parts_ids"])
    if "look" in rule:
        return bool(f.parts_rel()) if rule["look"] == "2d" else f.file(cj.get("model"))
    if "made_with_min" in rule:       # ファイルから見分けられない直し(作り方の改良)は、作った時の版で見る
        made, want = version_key(get(cj, "origin.made_with")), version_key(rule["made_with_min"])
        return bool(made and want and made >= want)
    raise ValueError(f"capabilities.json に知らない見分け方があります: {rule}")


def assess(cap, kinds, f):
    """そのキャラに合う種類のうち、まだ無い種類の並び。合わない(入れられない)なら None、全部あれば []。"""
    fit = [k for k in kinds if k in cap["kinds"]]
    if not fit:
        return None
    missing = []
    for k in fit:
        rules = cap["detect"].get(k, cap["detect"].get("*"))
        if rules is None or not all(check_rule(r, f) for r in rules):
            missing.append(k)
    return missing


def detected(caps, f):
    """そのキャラが今もっている表現の id(合う種類で全部そろっている物)。"""
    kinds = kinds_of(f)
    return [c["id"] for c in caps["capabilities"] if assess(c, kinds, f) == []]


def read_char(folder):
    try:
        d = json.loads((Path(folder) / "character.json").read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def tracked_ids(repo):
    """git が覚えているキャラの id。git が無い・リポジトリでなければ None。"""
    try:
        p = subprocess.run(["git", "-C", str(repo), "ls-files", "-z", "--", "characters"], capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    ids = set()
    for rel in p.stdout.decode("utf-8", "replace").split("\0"):
        bits = rel.split("/")
        if len(bits) == 3 and bits[0] == "characters" and bits[2] == "character.json":
            ids.add(bits[1])
    return ids


def is_sample(cid, cj, tracked, shipped):
    """見本のキャラか。origin.sample が書いてあればそれ。無ければ、見本の一覧にあるか、git が覚えているか。"""
    flag = get(cj, "origin.sample")
    if isinstance(flag, bool):
        return flag
    return cid in shipped or (tracked is not None and cid in tracked)


# ---- 入れ方の手順(Claude 向け)。表の <…> を、そのキャラの本当の場所に替える ----

HOLDER = re.compile(r"<(?:id|名前|作業フォルダ|pack|出力|元の絵\.png|元の絵\.svg|2D の SVG)>")
DEFAULT_UNDO_STEPS = ["python creator/review/upgrade_offers.py --restore <id>"]


def expand(caps, items):
    """手順の並び。"@名前" は表の step_sets のその並びに替える(知らない名前は表の書き誤りなので止める)。"""
    if isinstance(items, str):        # 前の形(「→」でつないだ 1 行)も読む
        items = [s.strip() for s in items.split("→") if s.strip()]
    out = []
    for s in items or []:
        if isinstance(s, str) and s.startswith("@"):
            sets = caps.get("step_sets") or {}
            if s[1:] not in sets:
                raise ValueError(f"capabilities.json に知らない手順の組があります: {s}")
            out += expand(caps, sets[s[1:]])
        elif isinstance(s, str):
            out.append(s)
    return out


def fill(text, values):
    return HOLDER.sub(lambda m: values.get(m.group(0), m.group(0)), text)


def place_values(cap, f, cid, name, repo):
    """<…> の中身と、見つからなかった絵(png・svg)。"""
    work = f"creator/work/{cid}/upgrade/{cap['id']}"
    png = next((r for r in (f"creator/samples/{cid}_元の絵_noshadow.png", f"creator/samples/{cid}_元の絵.png")
                if (Path(repo) / r).is_file()), None)
    svg = f.svg_source(cid, repo)
    values = {"<id>": cid, "<名前>": str(name).replace('"', ""), "<作業フォルダ>": work, "<pack>": f"{work}/pack",
              "<出力>": f"{work}/talk", "<元の絵.png>": png or f"{work}/元の絵.png",
              "<元の絵.svg>": svg or f"{work}/drawing.svg", "<2D の SVG>": f.svg_2d(cid) or f"characters/{cid}/2d/body.svg"}
    return values, png, svg


def plan_steps(cap, missing, f, cid, name, repo, caps):
    """足りない種類ごとの手順(場所は埋めた形)と、先に使う人に聞くこと・足りない物。"""
    values, png, svg = place_values(cap, f, cid, name, repo)
    targets, need_png, need_svg, builder = [], False, False, False
    for k in missing:
        items = expand(caps, cap["apply"].get(k))
        need_png |= png is None and any("<元の絵.png>" in s for s in items)
        need_svg |= svg is None and any("<元の絵.svg>" in s for s in items)
        builder |= any("run_groups.sh" in s or "run_built.sh" in s for s in items)
        look = cap.get("adds_look") or ("2d" if k == "2d" else "3d")    # 手を入れる見た目(2D の見た目・3D の形は、足す方)
        targets.append({"kind": k, "look": look, "steps": [fill(s, values) for s in items]})
    ask, missing_notes = [], []
    if need_png:
        ask.append(f"元の絵(PNG)が見つかりません。使う人に元の絵をもらい、{values['<元の絵.png>']} に置く")
    if need_svg:
        ask.append(f"元の絵の SVG が見つかりません。使う人に元の絵をもらい、yc-0-draw の「絵から作るとき」で SVG にして {values['<元の絵.svg>']} に置く")
    if builder and not (Path(repo) / "creator" / "builders" / f"{cid}.py").is_file():
        missing_notes.append(f"creator/builders/{cid}.py がありません(作る道の外で作った子)。make-character の段 ① 見る〜⑤ で builder を作ってから入れる")
    return values, targets, ask, missing_notes


def picture_words(cap, needs_picture):
    if needs_picture:
        return cap["apply"].get("picture_note") or "元の絵がもう一度いります"
    return "絵はもう一度いりません"


def make_offer(cap, missing, kinds, f, cid, name, repo, caps=None, new=False):
    caps = caps or {}
    title = cap["title"]
    both_looks = any(k in LOOK_3D for k in kinds) and "2d" in kinds
    both_fit = "2d" in cap["kinds"] and any(k in LOOK_3D for k in cap["kinds"])
    if both_looks and both_fit:      # 3D と 2D の両方を持つ子で、片方だけに足りない時は、どちらの見た目かを書く
        if missing == ["2d"]:
            title += "(2D)"
        elif "2d" not in missing:
            title += "(3D)"
    values, targets, ask, missing_notes = plan_steps(cap, missing, f, cid, name, repo, caps)
    needs_picture = cap["apply"].get("picture", "no") == "yes" or bool(ask)
    how = (f"Claude Code で「{name}に、{cap['title']}を入れて」と頼みます。"
           f"{picture_words(cap, needs_picture)}。入れる前に控えを取り、性格の文と思い出は変えません。")
    before = [fill(s, values) for s in expand(caps, caps.get("before_steps") or [])]
    steps = before + ask + [s for t in targets for s in t["steps"]]
    return {"cap": cap["id"], "title": title, "why": cap["why"], "how": how,
            "preview": fill(cap["preview"], values), "undo": fill(cap["undo"], values),
            "new": new, "kind": missing[0], "kinds": list(missing), "look": targets[0]["look"],
            "picture": "yes" if needs_picture else "no", "ready": not missing_notes, "missing": missing_notes,
            "skill": cap["apply"].get("skill", ""), "work": values["<作業フォルダ>"],
            "steps": steps, "targets": targets,
            "preview_steps": [fill(s, values) for s in expand(caps, cap.get("preview_steps") or [])],
            "undo_steps": [fill(s, values) for s in expand(caps, cap.get("undo_steps") or caps.get("undo_steps") or DEFAULT_UNDO_STEPS)]}


def character_report(cid, folder, cj, caps, repo):
    """1 体の「入れられる表現」。新しい版で増えた物を先に、表の順で。"""
    f = Folder(folder, cj)
    kinds = kinds_of(f)
    made = version_key(get(cj, "origin.made_with"))
    offers = []
    for i, cap in enumerate(caps["capabilities"]):
        missing = assess(cap, kinds, f)
        if missing:
            since = version_key(cap.get("since"))
            new = bool(made and since and since > made)
            offer = make_offer(cap, missing, kinds, f, cid, cj.get("name") or cid, repo, caps, new)
            offers.append((0 if new else 1, i, new, offer))
    offers.sort(key=lambda t: t[:2])
    return {"id": cid, "name": cj.get("name") or cid, "offers": [o[3] for o in offers]}, [o[2] for o in offers]


def list_characters(chars_dir, only=None):
    for folder in sorted(Path(chars_dir).iterdir()) if Path(chars_dir).is_dir() else []:
        if folder.is_dir() and (only is None or folder.name == only) and (folder / "character.json").is_file():
            yield folder.name, folder


# ---- 古い形を今の形にそろえる(--migrate)。何度流しても同じ。変える時だけ、先に控えを取る ----

MIGRATE_PLAIN = {   # 人に見せる言葉。ここに無い直し(中の書き方だけの直し)は、1 行のまとめにだけ入る
    "looks": "2D のすがたでも出られるようにしました(3D と 2D は、画面のボタンで切りかえられます)。",
}


def migrate_dict(cj, folder):
    """今の形にそろえた写しと、変えた事の一覧 [(項目, くわしい中身)]。元の dict は変えない。"""
    d = json.loads(json.dumps(cj))
    changes = []
    rig = d.get("rig")
    if isinstance(rig, dict):
        moved = [k for k in rig if k not in d]
        d.update({k: rig[k] for k in moved})
        del d["rig"]
        changes.append(("rig", "入れ子の rig の中身(" + "・".join(moved or ["なし"]) + ")を上の段に出した"))
    model = d.get("model")
    if "type" not in d and isinstance(model, str) and model:
        d["type"] = "vrm" if model.lower().endswith(".vrm") else "rig"
        changes.append(("type", f'type を "{d["type"]}" にした'))
    if "id" not in d:
        d["id"] = folder.name
        changes.append(("id", f"id を {folder.name} にした"))
    if "persona" not in d and (folder / "persona.md").is_file():
        d["persona"] = "persona.md"
        changes.append(("persona", "persona を persona.md にした(中身は変えない)"))
    if "schema_version" not in d:
        d["schema_version"] = 1
        changes.append(("schema_version", "schema_version を 1 にした"))
    if "looks" not in d and (folder / "2d" / "parts.json").is_file():
        has3d = isinstance(model, str) and (folder / model).is_file()
        looks = {"default": "3d" if has3d else "2d"}
        if has3d:
            looks["3d"] = {"at": "top"}
        looks["2d"] = {"parts": "2d/parts.json"}
        d["looks"] = looks
        changes.append(("looks", "looks を足した(2d/parts.json があるので、画面で 2D も出せる)"))
    return d, changes


def shown_path(p, repo):
    """人に見せる場所。リポジトリの中ならリポジトリからの相対(/ でつなぐ)。"""
    try:
        return Path(p).resolve().relative_to(Path(repo).resolve()).as_posix()
    except ValueError:
        return str(p)


def write_char(folder, d):
    (Path(folder) / "character.json").write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


# ---- 控え(--backup・--restore)。控えは creator/work/backups/<id>/<時刻>/ に置く(git に入らない) ----

def _new_backup_dir(backups, cid):
    d = Path(backups) / cid / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    d.mkdir(parents=True)
    return d


def _save_manifest(d, cid, kind, files, reason, changes=None):
    man = {"id": cid, "kind": kind, "reason": reason, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "version": read_version(), "files": files}
    if changes:
        man["changes"] = changes      # --migrate が変えた項目(くわしい中身。人には見せない)
    (d / "backup.json").write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")


def backup(folder, cid, backups, reason="manual", only=None, changes=None):
    """キャラのフォルダ(only を渡せばそのファイルだけ)を写す。性格の文も写す(戻す時は使わない)。"""
    folder = Path(folder)
    d = _new_backup_dir(backups, cid)
    files = []
    srcs = [folder / r for r in only] if only else sorted(p for p in folder.rglob("*") if p.is_file())
    for p in srcs:
        rel = p.relative_to(folder).as_posix()
        (d / "files" / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, d / "files" / rel)
        files.append(rel)
    _save_manifest(d, cid, "file" if only else "folder", files, reason, changes)
    return d


def protected(folder):
    """戻す時に変えないファイル: 性格の文と、知識のファイル(使う人が書く物)。"""
    cj = read_char(folder) or {}
    keep = {"persona.md"}
    if isinstance(cj.get("persona"), str):
        keep.add(cj["persona"])
    keep.update(k for k in cj.get("knowledge") or [] if isinstance(k, str))
    return keep


def _safe_rel(rel):
    p = Path(rel)
    return rel.strip() != "" and not p.is_absolute() and ".." not in p.parts


def find_backup(backups, cid, name=None):
    """名指しの控え。無ければ、戻す前の自動の控え(reason: restore)を除いた、いちばん新しい控え。"""
    base = Path(backups) / cid
    if name:
        d = base / name
        return d if (d / "backup.json").is_file() else None
    found = []
    for d in sorted(base.iterdir()) if base.is_dir() else []:
        try:
            man = json.loads((d / "backup.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if man.get("reason") != "restore":
            found.append(d)
    return found[-1] if found else None


def restore(folder, cid, backups, name=None):
    """控えに戻す。戻す前の今の形も控えに取る(--from でそこへ戻せる)。性格の文と知識のファイルは変えない。"""
    folder = Path(folder)
    src = find_backup(backups, cid, name)
    if src is None:
        raise LookupError(f"{cid} の控えが見つかりません")
    man = json.loads((src / "backup.json").read_text(encoding="utf-8"))
    files = [r for r in man.get("files", []) if isinstance(r, str) and _safe_rel(r)]
    keep = protected(folder)
    safety = backup(folder, cid, backups, reason="restore")
    done = []
    if man.get("kind") == "folder":
        for p in sorted((p for p in folder.rglob("*") if p.is_file()), reverse=True):
            rel = p.relative_to(folder).as_posix()
            if rel not in files and rel not in keep:
                p.unlink()
                done.append(f"消した: {rel}(控えの後に足された物)")
        for p in sorted((p for p in folder.rglob("*") if p.is_dir()), reverse=True):
            if not any(p.iterdir()):
                p.rmdir()
    for rel in files:
        if rel in keep or not (src / "files" / rel).is_file():
            continue
        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / "files" / rel, folder / rel)
        done.append(f"戻した: {rel}")
    return src, safety, done


# ---- 取り付けの印(pk04_install.py・t07_talk.py が呼ぶ) ----

def stamp(folder, repo=REPO, caps=None):
    """character.json の origin に made_with(作った時の版)と capabilities(今もっている表現の id)を書く。"""
    folder = Path(folder)
    cj = read_char(folder)
    if cj is None:
        raise ValueError(f"character.json を読めません: {folder}")
    origin = dict(cj["origin"]) if isinstance(cj.get("origin"), dict) else {}
    origin["made_with"] = read_version(repo)
    origin["capabilities"] = detected(caps or load_caps(), Folder(folder, cj))
    write_char(folder, {**cj, "origin": origin})
    return origin


# ---- 出し方 ----

def gather(chars_dir, repo, caps, only=None):
    """見る子の一覧: (id, フォルダ, character.json, 見本か)。only が無ければ、使う人のキャラだけ。"""
    tracked = tracked_ids(repo)
    shipped = set(caps.get("samples", []))
    out, bad = [], []
    for cid, folder in list_characters(chars_dir, only):
        cj = read_char(folder)
        if cj is None:
            bad.append(cid)
            continue
        sample = is_sample(cid, cj, tracked, shipped)
        if only is not None or not sample:
            out.append((cid, folder, cj, sample))
    return out, bad


def text_report(version, rows):
    lines = [f"ゆるキャラクリエイター(版 {version})", ""]
    if not rows:
        return "\n".join(lines + ["あなたのキャラは、まだいません。",
                                  "作ったキャラが characters/ に入ると、ここに「入れられる新しい表現」が出ます。"])
    for rep, news, sample in rows:
        lines.append(f"■ {rep['name']}({rep['id']})" + ("  ※見本のキャラ" if sample else ""))
        if not rep["offers"]:
            lines += ["  いま入れられる表現は、ぜんぶ入っています。", ""]
            continue
        lines.append("  この子に入れられる表現があります。")
        for o, new in zip(rep["offers"], news):
            lines.append(f"  ・{o['title']}" + ("(新しくできるようになりました)" if new else "") + f": {o['why']}")
            lines += [f"    入れ方: {o['how']}", f"    前と後を見くらべる: {o['preview']}", f"    やめたい時: {o['undo']}"]
        lines.append("")
    lines.append("入れるかどうかは、あなたが決めます。入れなくても、今までどおり話せます。")
    return "\n".join(lines)


def run_migrate(chars_dir, repo, caps, backups, only):
    tracked, shipped = tracked_ids(repo), set(caps.get("samples", []))
    lines = [f"キャラの書き方を、今の版の形にそろえます(版 {read_version(repo)})"]
    changed = same = skipped = rc = 0
    for cid, folder in list_characters(chars_dir, only):
        cj = read_char(folder)
        if cj is None:
            lines.append(f"■ {cid}: character.json を読めません(変えていません)")
            rc = 1
            continue
        if is_sample(cid, cj, tracked, shipped):
            skipped += 1
            if only is not None:
                lines.append(f"■ {cid}: 見本のキャラは、プログラムと一緒に新しくなるので、ここでは変えません")
            continue
        new, changes = migrate_dict(cj, folder)
        if not changes:
            same += 1
            continue
        b = backup(folder, cid, backups, reason="migrate", only=["character.json"], changes=[c for _, c in changes])
        write_char(folder, new)
        changed += 1
        lines.append(f"■ {cj.get('name') or cid}({cid}): 新しい版でも読めるように、キャラの書き方を少しそろえました(性格・声・思い出は変わりません)。")
        lines += [f"  ・{MIGRATE_PLAIN[k]}" for k, _ in changes if k in MIGRATE_PLAIN]
        if new.get("id") != folder.name:
            lines.append(f"  ・気をつけること: キャラの中に書いてある名前の印({new.get('id')})が、フォルダの名前({folder.name})とちがいます。そのままにしてあります。")
        lines.append(f"  先に控えを取りました(元に戻すときに使います): {shown_path(b, repo)}")
    if changed:
        lines.append(f"そろえた: {changed} 体 / そのまま: {same} 体 / 見本なので変えない: {skipped} 体")
    else:
        mine = f"あなたのキャラ {same} 体はそのまま" if same else "あなたのキャラは、まだいません"
        lines.append(f"そろえる物はありませんでした({mine}。見本 {skipped} 体は変えません)")
    return "\n".join(lines), rc


def _one(chars_dir, cid):
    folder = Path(chars_dir) / str(cid)
    ok = re.fullmatch(r"[a-z0-9_][a-z0-9_-]{0,39}", str(cid)) and (folder / "character.json").is_file()
    return folder if ok else None


def backup_or_restore(a, chars, repo, caps):
    cid = a.backup or a.restore
    folder = _one(chars, cid)
    if folder is None:
        print(f"キャラ {cid} が見つかりません({chars})", file=sys.stderr)
        return 2
    if a.backup:
        print(f"控えを取りました: {shown_path(backup(folder, cid, a.backups), repo)}")
        return 0
    if is_sample(cid, read_char(folder) or {}, tracked_ids(repo), set(caps.get("samples", []))):
        print(f"{cid} は見本のキャラなので、ここでは戻しません(git で戻します)", file=sys.stderr)
        return 2
    try:
        src, safety, done = restore(folder, cid, a.backups, a.from_name)
    except LookupError as e:
        print(str(e), file=sys.stderr)
        return 2
    print(f"控え {src.name} に戻しました。戻す前の形も控えに取りました(--from {safety.name} で、そこへ戻せます)")
    print("\n".join(f"  ・{x}" for x in done) or "  ・変わった所はありませんでした")
    print("性格の文と知識のファイルは変えていません。")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="あとから新しい表現を入れる案内(creator/capabilities.json とキャラのフォルダを見くらべる)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--json", action="store_true", help="JSON で出す")
    mode.add_argument("--text", action="store_true", help="やさしい日本語で出す(既定)")
    mode.add_argument("--migrate", action="store_true", help="古い形の character.json を今の形にそろえる")
    mode.add_argument("--backup", metavar="ID", help="キャラのフォルダの控えを取る")
    mode.add_argument("--restore", metavar="ID", help="控えに戻す")
    ap.add_argument("--character", metavar="ID", help="このキャラだけ")
    ap.add_argument("--from", dest="from_name", metavar="NAME", help="--restore で戻す控えの名前")
    ap.add_argument("--characters", default=str(REPO / "characters"), help="キャラのフォルダの場所(試験用)")
    ap.add_argument("--backups", default=str(REPO / "creator" / "work" / "backups"), help="控えの場所")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass
    chars = Path(a.characters).resolve()
    repo, caps = chars.parent, load_caps()
    if a.character and not _one(chars, a.character):
        print(f"キャラ {a.character} が見つかりません({chars})", file=sys.stderr)
        return 2
    if a.backup or a.restore:
        return backup_or_restore(a, chars, repo, caps)
    if a.migrate:
        text, rc = run_migrate(chars, repo, caps, a.backups, a.character)
        print(text)
        return rc
    rows, bad = gather(chars, repo, caps, a.character)
    reports = [(*character_report(cid, folder, cj, caps, repo), sample) for cid, folder, cj, sample in rows]
    for cid in bad:
        print(f"読めない character.json があります: {cid}", file=sys.stderr)
    if a.json:
        print(json.dumps({"version": read_version(repo), "characters": [r[0] for r in reports]}, ensure_ascii=True, indent=2))
    else:
        print(text_report(read_version(repo), reports))
    return 0


if __name__ == "__main__":
    sys.exit(main())
