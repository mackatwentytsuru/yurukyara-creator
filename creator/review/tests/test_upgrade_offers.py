"""あとから新しい表現を入れる案内(creator/review/upgrade_offers.py)と、取り付けの印(pk04_install.py)の試験。
Claude も GPU も使わない。キャラは試験の一時フォルダに写して使う(characters/ は変えない)。
使い方: python -m unittest discover creator/review/tests -p "test_upgrade_offers.py"
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REVIEW = HERE.parent
ROOT = REVIEW.parents[1]
sys.path.insert(0, str(REVIEW))
sys.path.append(str(ROOT / "creator" / "pipeline"))
import upgrade_offers as UO  # noqa: E402

CHARS = ROOT / "characters"
PY = sys.executable
OFFER_KEYS = {"cap", "title", "why", "how", "preview", "undo"}
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}


def run(*args):
    p = subprocess.run([PY, str(REVIEW / "upgrade_offers.py"), *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=120)
    return p.returncode, p.stdout, p.stderr


def validate(path, *extra):
    p = subprocess.run([PY, str(ROOT / "creator/specs/validate_character.py"), str(path), *extra], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV, timeout=60)
    return p.returncode, p.stdout


class Base(unittest.TestCase):
    def setUp(self):
        # リポジトリと同じドライブ(t07 が見本の絵への相対の場所を作る)。creator/work/ は git に入らない
        (ROOT / "creator" / "work").mkdir(parents=True, exist_ok=True)
        self.tmp = Path(tempfile.mkdtemp(prefix="test_upo_", dir=ROOT / "creator" / "work"))
        self.chars = self.tmp / "characters"
        self.chars.mkdir()
        self.backups = self.tmp / "backups"
        (self.tmp / "VERSION").write_text("1.0.0\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def copy(self, src, cid, edit=None):
        """作例のフォルダを、使う人のキャラ(別の id)として写す。edit で character.json を変える。"""
        dest = self.chars / cid
        shutil.copytree(CHARS / src, dest)
        cj = json.loads((dest / "character.json").read_text(encoding="utf-8"))
        cj["id"] = cid
        if edit:
            cj = edit(cj) or cj
        (dest / "character.json").write_text(json.dumps(cj, ensure_ascii=False, indent=2), encoding="utf-8")
        return dest

    def offers(self, *extra):
        rc, out, err = run("--json", "--characters", str(self.chars), "--backups", str(self.backups), *extra)
        self.assertEqual(rc, 0, err)
        return json.loads(out)

    def caps_of(self, data, cid):
        return [o["cap"] for c in data["characters"] if c["id"] == cid for o in c["offers"]]


class TestTable(unittest.TestCase):
    """capabilities.json の表そのもの"""

    def test_every_entry_is_complete_and_its_rules_are_known(self):
        caps = UO.load_caps()
        ids = [c["id"] for c in caps["capabilities"]]
        self.assertEqual(len(ids), len(set(ids)), "id が重なっている")
        for c in caps["capabilities"]:
            for k in ("id", "since", "title", "why", "kinds", "detect", "apply", "preview", "undo"):
                self.assertTrue(c.get(k), f"{c.get('id')} に {k} が無い")
            self.assertIsNotNone(UO.version_key(c["since"]), c["id"])
            self.assertIn(c["apply"].get("picture", "no"), ("no", "yes", "if_no_svg"))
            for k in c["kinds"]:
                self.assertIn(k, caps["kinds"], f"{c['id']} の知らない種類 {k}")
                self.assertTrue(k in c["detect"] or "*" in c["detect"], f"{c['id']} に {k} の見分け方が無い")
        for cid in ("norrie", "yokoso", "mikan", "robo", "f_led", "d_lantern", "_test"):
            f = UO.Folder(CHARS / cid, UO.read_char(CHARS / cid))
            for c in caps["capabilities"]:
                UO.assess(c, list(caps["kinds"]), f)      # 知らない決まりがあれば ValueError で落ちる

    def test_shipped_samples_are_listed_for_copies_without_git(self):
        tracked = UO.tracked_ids(ROOT)
        if tracked is None:
            self.skipTest("git が無い")
        self.assertTrue(tracked <= set(UO.load_caps()["samples"]), f"見本の一覧に無い: {tracked - set(UO.load_caps()['samples'])}")


class TestDetect(unittest.TestCase):
    """作例のキャラで、見分け方が本当の中身と合う"""

    def detected(self, cid):
        return UO.detected(UO.load_caps(), UO.Folder(CHARS / cid, UO.read_char(CHARS / cid)))

    def test_kinds(self):
        kinds = {cid: UO.kinds_of(UO.Folder(CHARS / cid, UO.read_char(CHARS / cid))) for cid in ("norrie", "mikan", "f_led", "_test")}
        self.assertEqual(kinds, {"norrie": ["rig_morph", "2d"], "mikan": ["rig_morph"], "f_led": ["rig_atlas"], "_test": ["vrm"]})

    def test_norrie_has_everything_it_can_take(self):
        self.assertEqual(self.detected("norrie"), ["blink", "mouth3", "expressions5", "wave_bow", "nod", "eyes_follow", "look_2d", "look_3d", "back_2d"])

    def test_face_atlas_and_svg_list_forms(self):
        self.assertIn("extra_moves", self.detected("f_led"))
        self.assertNotIn("look_2d", self.detected("mikan"), "部品の名前の並びだけ(parts.json が無い)は、画面で 2D を出せない")
        self.assertEqual(self.detected("_test"), [], "VRM には作る道から入れる物が無い")

    def test_samples_are_not_listed_unless_named(self):
        rc, out, err = run("--json")
        self.assertEqual(rc, 0, err)
        data = json.loads(out)
        self.assertEqual(data["version"], UO.read_version(ROOT))
        self.assertFalse({c["id"] for c in data["characters"]} & set(UO.load_caps()["samples"]))
        rc, out, _ = run("--json", "--character", "yokoso")
        self.assertEqual([o["cap"] for o in json.loads(out)["characters"][0]["offers"]], ["back_2d"])
        rc, out, _ = run("--json", "--character", "norrie")
        self.assertEqual(json.loads(out)["characters"][0]["offers"], [])
        self.assertEqual(run("--json", "--character", "nobody")[0], 2)


class TestOffers(Base):
    def test_json_shape_and_kind_fit(self):
        self.copy("robo", "my_robo")
        self.copy("_test", "my_vrm")
        data = self.offers()
        self.assertEqual(set(data), {"version", "characters"})
        self.assertEqual(data["version"], "1.0.0")
        by = {c["id"]: c for c in data["characters"]}
        self.assertEqual(set(by), {"my_robo", "my_vrm"})
        for c in by.values():
            self.assertEqual(set(c), {"id", "name", "offers"})
            for o in c["offers"]:
                self.assertEqual(set(o), OFFER_KEYS)
                self.assertNotIn("<id>", o["undo"] + o["preview"])
        self.assertEqual(self.caps_of(data, "my_robo"), ["look_2d"])
        self.assertEqual(self.caps_of(data, "my_vrm"), [], "VRM に合わない物を出さない")

    def test_missing_parts_are_offered_and_new_ones_first(self):
        def old(cj):
            cj.pop("blink")
            cj["motions"].pop("nod")
            cj["origin"] = {"made_with": "0.9.0"}
        self.copy("robo", "old_robo", old)
        self.copy("robo", "now_robo", lambda cj: cj.update(origin={"made_with": "1.0.0"}))
        data = self.offers()
        self.assertEqual(self.caps_of(data, "old_robo"), ["blink", "nod", "look_2d"])
        rc, out, _ = run("--text", "--characters", str(self.chars))
        self.assertEqual(rc, 0)
        self.assertIn("まばたき(新しくできるようになりました)", out)
        now = out.split("■ ロボくん(now_robo)")[1].split("■")[0]
        self.assertIn("2D の見た目: ", now, "同じ版で作った子は「新しく」と言わない")
        self.assertNotIn("新しくできるようになりました", now)

    def test_picture_needed_only_without_a_drawing(self):
        self.copy("robo", "my_robo")
        how = lambda: self.offers()["characters"][0]["offers"][0]["how"]  # noqa: E731
        self.assertIn("元の絵がもう一度いります", how())
        draw = self.tmp / "creator" / "work" / "my_robo" / "draw" / "r1"
        draw.mkdir(parents=True)
        (draw / "drawing.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        self.assertIn("絵はもう一度いりません", how())

    def test_2d_only_and_both_looks(self):
        def two_only(cj):
            for k in ("model", "type", "motions", "look", "mouth", "blink", "morphs", "fur", "height_m", "expressions"):
                cj.pop(k, None)
            cj["looks"] = {"default": "2d", "2d": {"parts": "2d/parts.json"}}
        d = self.copy("yokoso", "flat", two_only)
        (d / "model.glb").unlink()
        shutil.rmtree(d / "motions")
        self.copy("yokoso", "both")
        data = self.offers()
        self.assertEqual(self.caps_of(data, "flat"), ["look_3d", "back_2d"])
        both = [c for c in data["characters"] if c["id"] == "both"][0]["offers"]
        self.assertEqual([o["title"] for o in both], ["うしろ姿(2D)"])

    def test_user_or_sample(self):
        self.assertTrue(UO.is_sample("norrie", {}, None, {"norrie"}))
        self.assertTrue(UO.is_sample("x", {}, {"x"}, set()), "git が覚えている子は見本")
        self.assertFalse(UO.is_sample("x", {}, set(), set()))
        self.assertFalse(UO.is_sample("x", {"origin": {"sample": False}}, {"x"}, {"x"}), "origin.sample が先")
        self.assertTrue(UO.is_sample("y", {"origin": {"sample": True}}, None, set()))
        self.copy("robo", "robo")          # 見本と同じ id は、git が無くても見本の一覧で見本
        self.copy("robo", "mine")
        self.assertEqual([c["id"] for c in self.offers()["characters"]], ["mine"])

    def test_improvement_seen_only_by_version(self):
        """ファイルから見分けられない改良(made_with_min)は、その版より前に作った子にだけ出す"""
        caps = UO.load_caps()
        better = {"id": "better_blink", "since": "1.1.0", "title": "なめらかなまばたき", "why": "w", "kinds": ["rig_morph"],
                  "detect": {"rig_morph": [{"made_with_min": "1.1.0"}]}, "apply": {"picture": "no"}, "preview": "p", "undo": "u <id>"}
        caps = {**caps, "capabilities": caps["capabilities"] + [better]}
        for made, offered in (("1.0.0", True), ("1.1.0", False), ("1.2.0", False), ("dev", True), (None, True)):
            cj = {**UO.read_char(CHARS / "robo"), "origin": {"made_with": made} if made else {}}
            rep, news = UO.character_report("r", CHARS / "robo", cj, caps, self.tmp)
            self.assertEqual("better_blink" in [o["cap"] for o in rep["offers"]], offered, made)
            if made == "1.0.0":
                self.assertEqual(news[0], True, "新しい版の物を先に出す")
                self.assertEqual(rep["offers"][0]["cap"], "better_blink")

    def test_text_when_there_is_no_user_character(self):
        rc, out, _ = run("--text", "--characters", str(self.chars))
        self.assertEqual(rc, 0)
        self.assertIn("あなたのキャラは、まだいません", out)


class TestMigrate(Base):
    def old_form(self, cid="old_one"):
        def nest(cj):
            rig = {k: cj.pop(k) for k in ("look", "mouth", "blink", "morphs")}
            for k in ("type", "schema_version", "looks", "origin"):
                cj.pop(k, None)
            cj["rig"] = rig
        return self.copy("yokoso", cid, nest)

    def test_migrate_is_backed_up_idempotent_and_valid(self):
        d = self.old_form()
        before = (d / "character.json").read_bytes()
        self.assertEqual(validate(d / "character.json")[0], 0, "前の形も K1 の形として通る(知らない項目は止めない)")
        rc, out, err = run("--migrate", "--characters", str(self.chars), "--backups", str(self.backups))
        self.assertEqual(rc, 0, err)
        self.assertIn("入れ子の rig の中身", out)
        cj = json.loads((d / "character.json").read_text(encoding="utf-8"))
        self.assertNotIn("rig", cj)
        self.assertEqual((cj["type"], cj["schema_version"], cj["mouth"]["kind"]), ("rig", 1, "morph"))
        self.assertEqual(cj["looks"]["2d"], {"parts": "2d/parts.json"})
        saved = list(self.backups.glob("old_one/*/files/character.json"))
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0].read_bytes(), before, "変える前の物を控えた")
        self.assertEqual(validate(d / "character.json")[0], 0)
        after = (d / "character.json").read_bytes()
        rc, out, _ = run("--migrate", "--characters", str(self.chars), "--backups", str(self.backups))
        self.assertIn("そろえた: 0 体 / そのまま: 1 体", out)
        self.assertEqual((d / "character.json").read_bytes(), after, "2 回目は何も変えない")
        self.assertEqual(len(list(self.backups.glob("old_one/*"))), 1, "2 回目は控えも増えない")

    def test_samples_and_persona_are_not_touched(self):
        self.old_form("robo")             # 見本の id なので変えない
        persona = (self.chars / "robo" / "persona.md").read_bytes()
        rc, out, _ = run("--migrate", "--characters", str(self.chars), "--backups", str(self.backups), "--character", "robo")
        self.assertIn("見本のキャラは", out)
        self.assertIn("rig", json.loads((self.chars / "robo" / "character.json").read_text(encoding="utf-8")))
        self.assertEqual((self.chars / "robo" / "persona.md").read_bytes(), persona)


class TestBackupRestore(Base):
    def test_restore_undoes_an_apply_but_keeps_persona(self):
        d = self.copy("yokoso", "mine")
        original = (d / "character.json").read_bytes()
        rc, out, err = run("--backup", "mine", "--characters", str(self.chars), "--backups", str(self.backups))
        self.assertEqual(rc, 0, err)
        cj = json.loads(original)
        cj["new_thing"] = True                                     # 入れてみた(試しの変化)
        (d / "character.json").write_text(json.dumps(cj), encoding="utf-8")
        (d / "2d" / "extra.svg").write_text("<svg/>", encoding="utf-8")
        (d / "persona.md").write_text("使う人が書き直した性格\n", encoding="utf-8")
        rc, out, err = run("--restore", "mine", "--characters", str(self.chars), "--backups", str(self.backups))
        self.assertEqual(rc, 0, err)
        self.assertEqual((d / "character.json").read_bytes(), original)
        self.assertFalse((d / "2d" / "extra.svg").exists(), "控えの後に足した物は消す")
        self.assertEqual((d / "persona.md").read_text(encoding="utf-8"), "使う人が書き直した性格\n", "性格の文は戻さない")
        reasons = sorted(json.loads(p.read_text(encoding="utf-8"))["reason"] for p in self.backups.glob("mine/*/backup.json"))
        self.assertEqual(reasons, ["manual", "restore"], "戻す前の形も控えた")
        run("--restore", "mine", "--characters", str(self.chars), "--backups", str(self.backups))
        self.assertEqual((d / "character.json").read_bytes(), original, "もう一度戻しても同じ控えに戻る")

    def test_restore_refuses_samples_and_missing_backups(self):
        self.copy("robo", "robo")
        self.copy("robo", "mine")
        self.assertEqual(run("--restore", "robo", "--characters", str(self.chars), "--backups", str(self.backups))[0], 2)
        self.assertEqual(run("--restore", "mine", "--characters", str(self.chars), "--backups", str(self.backups))[0], 2)


class TestInstallStamp(Base):
    def install(self, pack, cid, *extra):
        p = subprocess.run([PY, str(ROOT / "creator/pipeline/pk04_install.py"), str(pack), cid, "--characters", str(self.chars), *extra],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV, timeout=120)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        return json.loads((self.chars / cid / "character.json").read_text(encoding="utf-8"))

    def pack(self):
        pack = self.tmp / "pack"
        shutil.rmtree(pack, ignore_errors=True)
        shutil.copytree(CHARS / "robo", pack, ignore=shutil.ignore_patterns("persona.md"))
        return pack

    def test_install_stamps_version_and_capabilities(self):
        cj = self.install(self.pack(), "zz_new", "--name", "テストくん")
        self.assertEqual(cj["origin"]["made_with"], UO.read_version(ROOT))
        self.assertEqual(cj["origin"]["capabilities"], ["blink", "mouth3", "expressions5", "wave_bow", "nod", "eyes_follow"])
        self.assertEqual(validate(self.chars / "zz_new" / "character.json")[0], 0)
        p = subprocess.run([PY, str(ROOT / "creator/pipeline/pk02_check_character.py"), str(self.chars / "zz_new")],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV, timeout=60)
        self.assertEqual(p.returncode, 0, p.stdout)

    def test_reinstall_keeps_the_users_own_parts(self):
        self.install(self.pack(), "zz_mine", "--name", "わたしの子")
        path = self.chars / "zz_mine" / "character.json"
        cj = json.loads(path.read_text(encoding="utf-8"))
        cj.update(voice={"provider": "none"}, looks={"default": "2d", "2d": {"parts": "2d/parts.json"}},
                  origin={**cj["origin"], "input": "words", "words": "青いまるい雲の子", "created": "2026-11-07T10:00:00+09:00", "made_with": "0.9.0"})
        path.write_text(json.dumps(cj, ensure_ascii=False), encoding="utf-8")
        (self.chars / "zz_mine" / "persona.md").write_text("# わたしの子\n- 話し方: のんびり\n", encoding="utf-8")
        again = self.install(self.pack(), "zz_mine", "--force")
        self.assertEqual(again["name"], "わたしの子")
        self.assertEqual(again["voice"], {"provider": "none"})
        self.assertEqual(again["looks"]["default"], "2d")
        self.assertEqual((again["origin"]["words"], again["origin"]["created"]), ("青いまるい雲の子", "2026-11-07T10:00:00+09:00"))
        self.assertEqual(again["origin"]["made_with"], UO.read_version(ROOT), "作り直した版を書く")
        self.assertIn("のんびり", (self.chars / "zz_mine" / "persona.md").read_text(encoding="utf-8"))

    def test_talk_step_keeps_2d_and_the_stamp(self):
        import t07_talk as T7
        d = self.copy("yokoso", "zz_talk", lambda cj: cj.update(origin={"input": "words", "words": "あ", "created": "x"}))
        old_origin = json.loads((d / "character.json").read_text(encoding="utf-8"))["origin"]
        T7.add_k1(d / "character.json", "zz_talk", "あ", old_origin)
        cj = json.loads((d / "character.json").read_text(encoding="utf-8"))
        self.assertEqual(cj["looks"]["2d"], {"parts": "2d/parts.json"}, "あとから入れた 2D を消さない")
        self.assertEqual(cj["origin"]["created"], "x")
        self.assertEqual(cj["origin"]["made_with"], UO.read_version(ROOT))
        self.assertIn("look_2d", cj["origin"]["capabilities"])
        # 見本の絵(creator/samples/mikan_元の絵.svg)がある id でも、画面で出せる parts.json の 2D と「2D を先に」を残す
        m = self.copy("yokoso", "mikan", lambda cj: cj.update(looks={"default": "2d", "2d": {"parts": "2d/parts.json"}}))
        T7.add_k1(m / "character.json", "mikan", None, None)
        looks = json.loads((m / "character.json").read_text(encoding="utf-8"))["looks"]
        self.assertEqual((looks["default"], looks["2d"]), ("2d", {"parts": "2d/parts.json"}))


class TestValidators(Base):
    def test_old_and_new_characters_pass(self):
        for cid in ("norrie", "yokoso", "mikan", "robo", "f_led", "d_lantern"):
            self.assertEqual(validate(CHARS / cid / "character.json")[0], 0, cid)
            d = self.copy(cid, cid + "_s", lambda cj: cj.setdefault("origin", {}).update(made_with="1.0.0", capabilities=["blink"], sample=False))
            rc, out = validate(d / "character.json", "--no-files")   # 写した先からは、見本の絵への相対の場所が届かない
            self.assertEqual(rc, 0, out)

    def test_wrong_stamp_is_caught(self):
        d = self.copy("robo", "bad", lambda cj: cj.update(origin={"made_with": "そのうち", "capabilities": [3]}))
        rc, out = validate(d / "character.json")
        self.assertEqual(rc, 1)
        self.assertIn("made_with", out)


if __name__ == "__main__":
    unittest.main()
