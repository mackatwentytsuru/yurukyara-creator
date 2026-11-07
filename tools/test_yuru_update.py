#!/usr/bin/env python3
"""tools/yuru_update.py の試験(ネットを使わない)。

手元に仮の取り先(bare のリポジトリ)と、使う人の写し(clone)を作る。写しには、その人のキャラ・記憶・
鍵のファイル・直した見本の性格の文を置く。取り先を新しい版(1.1.0)に進めて、check・apply・undo を流し、
その人の物が sha256 で同じか、直した性格の文が残るか(両方で直された時は一覧に出るか)、版の文字、
新しい表現の案内(upgrade_offers.py)が呼ばれたか、元に戻すと全部戻るかを確かめる。
見本と同じ id のキャラ・ネットに届かない時・git clone でないフォルダ・合わせの途中も確かめる。
upgrade_offers.py は、仮の小さな物を試験の中で作る(本物は別の流れが作る)。

流し方: python tools/test_yuru_update.py
"""
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL_FILES = ("yuru_update.py", "yuru_update_core.py", "yuru_update_hook.mjs")   # 道具・部品・起動役(写しの tools/ に置く)
NODE = shutil.which("node")


def tool_files():
    out = {}
    for name in TOOL_FILES:
        with open(os.path.join(HERE, name), "rb") as f:
            out[f"tools/{name}"] = f.read()
    return out
KEY_VALUE = "dummy-value-for-update-test"
NEWS = "docs/できるようになったこと.md"

FAKE_OFFERS_V1 = 'import sys\nprint("OFFERS-TEXT-CALLED" if "--text" in sys.argv else "MIGRATE-CALLED")\n'
# 1.1.0 の仮の upgrade_offers.py: --migrate で、全部のキャラの character.json に made_with を足す(見本も)
FAKE_OFFERS_V2 = '''import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if "--migrate" in sys.argv:
    print("MIGRATE-CALLED")
    base = os.path.join(ROOT, "characters")
    for cid in sorted(os.listdir(base)):
        p = os.path.join(base, cid, "character.json")
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            if "made_with" not in d:
                d["made_with"] = "1.1.0"
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(d, f, ensure_ascii=False)
else:
    print("OFFERS-TEXT-CALLED: やさしい手のふり方を、マイくんに入れられます")
'''

V1 = {
    "VERSION": "1.0.0\n",
    ".gitignore": "backups/\n.yuru_update.json\nweb/logs/\nweb/.env\ncreator/work/\n",
    NEWS: "# できるようになったこと\n\n## 1.0.0(2026-11-08)\n- ノリーと話せる\n",
    "characters/norrie/character.json": '{"id": "norrie", "name": "ノリー"}\n',
    "characters/norrie/persona.md": "# ノリー\n- 話し方: ていねい\n",
    "characters/mikan/character.json": '{"id": "mikan"}\n',
    "characters/mikan/persona.md": "# みかん\n",
    "creator/review/upgrade_offers.py": FAKE_OFFERS_V1,
}
V2 = {
    "VERSION": "1.1.0\n",
    NEWS: "# できるようになったこと\n\n## 1.1.0(2026-11-20)\n- 新しい手のふり方ができる\n\n## 1.0.0(2026-11-08)\n- ノリーと話せる\n",
    "characters/mikan/persona.md": "# みかん\n- 新しい話し方\n",
    "characters/newbie/character.json": '{"id": "newbie"}\n',
    "characters/newbie/persona.md": "# 新しい見本\n",
    "creator/review/upgrade_offers.py": FAKE_OFFERS_V2,
}
EDITED_NORRIE = "# ノリー\n- 話し方: ていねい\n- 好きな物: 紅茶(使う人が書き足した)\n"
# apply を 1 段の後で、いきなり止める(窓を閉じた時)か、Ctrl+C を起こす
KILL_DRIVER = '''import os, sys
user, point = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(user, "tools"))
os.chdir(user)
import yuru_update as Y
real = Y.git
def patched(*a, **k):
    out = real(*a, **k)
    if point == "after_checkout" and a[:2] == ("checkout", "-q"):
        os._exit(9)
    if point == "after_merge" and a[:1] == ("merge",):
        os._exit(9)
    if point == "ctrlc_after_merge" and a[:1] == ("merge",):
        raise KeyboardInterrupt
    return out
Y.git = patched
if point == "after_applied":
    Y.tell_tool = lambda *a, **k: os._exit(9)
sys.exit(Y.main(["apply"]))
'''
MINE = {
    "characters/my_kun/character.json": '{"id": "my_kun", "name": "マイくん"}\n',
    "characters/my_kun/persona.md": "# マイくん\n- 元気\n",
    "characters/my_kun/model.glb": b"glTF\x02\x00\x00\x00" + bytes(range(256)) * 4,
    "web/logs/memory/abc.json": '{"items": ["りんごが好き"]}',
    "creator/work/my_kun/review/state.json": '{"stage": "C0"}',
}


def write(root, rel, data):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))


def sha(root, rel):
    path = os.path.join(root, *rel.split("/"))
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def text(root, rel):
    with open(os.path.join(root, *rel.split("/")), encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


class UpdateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp.name
        cfg = os.path.join(t, "gitconfig")
        with open(cfg, "w", encoding="utf-8") as f:   # 使う人の git の設定を読まない(Windows は改行を CRLF にする設定)
            f.write("[user]\n\tname = test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n"
                    "[init]\n\tdefaultBranch = main\n")
            if os.name == "nt":
                f.write("[core]\n\tautocrlf = true\n")
        self.env = dict(os.environ, GIT_CONFIG_GLOBAL=cfg, GIT_CONFIG_NOSYSTEM="1", PYTHONIOENCODING="utf-8")
        self.author = os.path.join(t, "author")
        self.origin = os.path.join(t, "origin.git")
        self.user = os.path.join(t, "user")
        os.makedirs(self.author)
        self.git(self.author, "init", "-q", "-b", "main")
        self.commit(dict(V1, **tool_files()), "1.0.0")
        self.git(t, "clone", "-q", "--bare", self.author, self.origin)
        self.git(t, "clone", "-q", self.origin, self.user)
        self.head0 = self.git(self.user, "rev-parse", "HEAD").strip()

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, cwd, *args):
        p = subprocess.run(["git", *args], cwd=cwd, env=self.env, capture_output=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8", "replace"))
        return p.stdout.decode("utf-8", "replace")

    def commit(self, files, msg):
        for rel, data in files.items():
            write(self.author, rel, data)
        self.git(self.author, "add", "-A")
        self.git(self.author, "commit", "-q", "-m", msg)

    def advance(self, extra=None):
        """取り先を 1.1.0 に進める"""
        self.commit(dict(V2, **(extra or {})), "1.1.0")
        self.git(self.author, "push", "-q", self.origin, "main")

    def tool(self, *args, cwd=None):
        cwd = cwd or self.user
        p = subprocess.run([sys.executable, os.path.join(cwd, "tools", "yuru_update.py"), *args], cwd=cwd,
                           env=self.env, capture_output=True, timeout=180)
        out = p.stdout.decode("utf-8", "replace") + p.stderr.decode("utf-8", "replace")
        self.assertNotIn("Traceback", out)
        self.assertNotIn(KEY_VALUE, out)
        return p.returncode, out

    def put_mine(self):
        for rel, data in MINE.items():
            write(self.user, rel, data)
        write(self.user, "web/.env", "ANTHROPIC_API_KEY=" + KEY_VALUE + "\n")
        write(self.user, "characters/norrie/persona.md", EDITED_NORRIE)
        return {rel: sha(self.user, rel) for rel in list(MINE) + ["characters/norrie/persona.md", "web/.env"]}

    def backup_dirs(self):
        base = os.path.join(self.user, "backups")
        return sorted(os.listdir(base)) if os.path.isdir(base) else []

    def test_check_apply_undo_keeps_everything(self):
        before = self.put_mine()
        old_mikan = sha(self.user, "characters/mikan/persona.md")
        self.advance()
        self.step_check()
        name = self.step_apply(before)
        code, out = self.tool("status")
        self.assertIn("版: 1.1.0", out)
        self.assertIn(f"backups/{name}", out)
        self.step_undo(before, old_mikan)

    def step_check(self):
        code, out = self.tool("check")
        self.assertEqual(code, 0)
        self.assertIn("今の版: 1.0.0", out)
        self.assertIn("新しい版 1.1.0 があります", out)
        self.assertIn("新しい手のふり方ができる", out)
        self.assertNotIn("ノリーと話せる", out)              # 前からできた事は出さない
        self.assertTrue(os.path.isfile(os.path.join(self.user, ".yuru_update.json")))
        code, out = self.tool("check", "--quiet")
        self.assertEqual(out.strip().count("\n"), 0)
        self.assertIn("1.1.0", out)
        self.tool("check", "--quiet", "--once-a-day")
        code, out = self.tool("check", "--quiet", "--once-a-day")  # 今日は 2 回目なので、何も出さない
        self.assertEqual(out.strip(), "")

    def step_apply(self, before):
        code, out = self.tool("apply")
        self.assertEqual(code, 0, out)
        self.assertIn("新しい版 1.1.0 になりました(前は 1.0.0)", out)
        self.assertIn("新しい手のふり方ができる", out)
        self.assertIn("MIGRATE-CALLED", out)
        self.assertIn("OFFERS-TEXT-CALLED", out)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.1.0")
        for rel in ("characters/my_kun/persona.md", "characters/my_kun/model.glb", "web/logs/memory/abc.json",
                    "creator/work/my_kun/review/state.json", "web/.env"):
            self.assertEqual(sha(self.user, rel), before[rel], rel)
        self.assertEqual(text(self.user, "characters/norrie/persona.md"), EDITED_NORRIE)   # 直した見本は残る
        self.assertEqual(text(self.user, "characters/mikan/persona.md"), V2["characters/mikan/persona.md"])
        self.assertTrue(os.path.isfile(os.path.join(self.user, "characters", "newbie", "character.json")))
        self.assertIn('"made_with"', text(self.user, "characters/my_kun/character.json"))  # 書き方をそろえた
        (name,) = self.backup_dirs()
        man = json.loads(text(self.user, f"backups/{name}/manifest.json"))
        self.assertEqual(man["from_commit"], self.head0)
        self.assertEqual(man["status"], "applied")
        self.assertEqual(man["keys_left_in_place"], ["web/.env"])
        saved = {it["path"]: it["sha256"] for it in man["user_files"]}
        self.assertEqual(saved["characters/my_kun/model.glb"], before["characters/my_kun/model.glb"])
        self.assertEqual(saved["web/logs/memory/abc.json"], before["web/logs/memory/abc.json"])
        self.assertNotIn("web/.env", saved)
        self.assertFalse(os.path.exists(os.path.join(self.user, "backups", name, "files", "web", ".env")))
        self.assertEqual(self.git(self.user, "status", "--porcelain", "--", "backups", ".yuru_update.json"), "")
        return name

    def step_undo(self, before, old_mikan):
        code, out = self.tool("undo")
        self.assertEqual(code, 0, out)
        self.assertIn("前の版 1.0.0 に戻しました", out)
        self.assertEqual(self.git(self.user, "rev-parse", "HEAD").strip(), self.head0)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.0.0")
        for rel, h in before.items():
            self.assertEqual(sha(self.user, rel), h, rel)
        self.assertEqual(sha(self.user, "characters/my_kun/character.json"), before["characters/my_kun/character.json"])
        self.assertEqual(sha(self.user, "characters/mikan/persona.md"), old_mikan)
        self.assertFalse(os.path.exists(os.path.join(self.user, "characters", "newbie")))
        changed = self.git(self.user, "status", "--porcelain", "--untracked-files=no").splitlines()
        self.assertEqual([c[3:] for c in changed], ["characters/norrie/persona.md"])
        code, out = self.tool("undo")                     # 2 回目は、戻せる控えが無い
        self.assertEqual(code, 1)

    def test_new_memories_after_update_are_kept_by_undo(self):
        self.put_mine()
        self.advance()
        self.assertEqual(self.tool("apply")[0], 0)
        write(self.user, "web/logs/memory/abc.json", '{"items": ["りんごが好き", "新しく覚えた事"]}')
        new_mem = sha(self.user, "web/logs/memory/abc.json")
        code, out = self.tool("undo")
        self.assertEqual(code, 0, out)
        self.assertEqual(sha(self.user, "web/logs/memory/abc.json"), new_mem)

    def test_undo_stops_when_user_changed_a_file_after_update(self):
        self.put_mine()
        self.advance()
        self.assertEqual(self.tool("apply")[0], 0)
        write(self.user, "characters/mikan/persona.md", "# みかん\n- 新しくした後に直した\n")
        code, out = self.tool("undo")
        self.assertEqual(code, 1)
        self.assertIn("characters/mikan/persona.md", out)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.1.0")

    def test_persona_changed_on_both_sides_is_listed_and_kept_in_backup(self):
        self.put_mine()
        self.advance({"characters/norrie/persona.md": "# ノリー\n- 話し方: ていねい(新しい版)\n"})
        code, out = self.tool("apply")
        self.assertEqual(code, 0, out)
        self.assertIn("新しい版でも直されていました", out)
        self.assertIn("characters/norrie/persona.md", out)
        self.assertIn("(新しい版)", text(self.user, "characters/norrie/persona.md"))
        (name,) = self.backup_dirs()
        self.assertEqual(text(self.user, f"backups/{name}/tracked/characters/norrie/persona.md"), EDITED_NORRIE)
        man = json.loads(text(self.user, f"backups/{name}/manifest.json"))
        self.assertEqual(man["kept_new_version"], ["characters/norrie/persona.md"])
        self.assertEqual(self.tool("undo")[0], 0)
        self.assertEqual(text(self.user, "characters/norrie/persona.md"), EDITED_NORRIE)

    def test_same_id_as_a_new_sample_stops_before_pulling(self):
        write(self.user, "characters/newbie/character.json", '{"id": "newbie", "name": "わたしの子"}\n')
        write(self.user, "characters/newbie/persona.md", "# わたしの子\n")
        mine = sha(self.user, "characters/newbie/character.json")
        self.advance()
        code, out = self.tool("apply")
        self.assertEqual(code, 1)
        self.assertIn("newbie", out)
        self.assertIn("--rename newbie=newbie_mine", out)
        self.assertEqual(self.git(self.user, "rev-parse", "HEAD").strip(), self.head0)
        self.assertEqual(sha(self.user, "characters/newbie/character.json"), mine)
        self.assertEqual(self.backup_dirs(), [])

        code, out = self.tool("apply", "--rename", "newbie=newbie_mine")
        self.assertEqual(code, 0, out)
        moved = json.loads(text(self.user, "characters/newbie_mine/character.json"))
        self.assertEqual((moved["id"], moved["name"]), ("newbie_mine", "わたしの子"))
        self.assertEqual(json.loads(text(self.user, "characters/newbie/character.json"))["id"], "newbie")
        code, out = self.tool("undo")
        self.assertEqual(code, 0, out)
        self.assertEqual(sha(self.user, "characters/newbie/character.json"), mine)
        self.assertFalse(os.path.exists(os.path.join(self.user, "characters", "newbie_mine")))

    def test_offline_is_a_kind_message(self):
        self.advance()
        shutil.move(self.origin, self.origin + ".away")
        code, out = self.tool("check")
        self.assertEqual(code, 0)
        self.assertIn("確かめられませんでした", out)
        self.assertEqual(self.tool("check", "--quiet")[1].strip(), "")
        code, out = self.tool("apply")
        self.assertEqual(code, 1)
        self.assertIn("届きませんでした", out)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.0.0")

    def test_not_a_git_clone(self):
        plain = os.path.join(self.tmp.name, "plain")
        for rel_path, data in tool_files().items():
            write(plain, rel_path, data)
        code, out = self.tool("check", cwd=plain)
        self.assertEqual(code, 0)
        self.assertIn("git clone で取ってきた物ではない", out)
        self.assertEqual(self.tool("check", "--quiet", cwd=plain)[1].strip(), "")
        self.assertEqual(self.tool("apply", cwd=plain)[0], 1)
        code, out = self.tool("status", cwd=plain)
        self.assertEqual(code, 0)
        self.assertIn("版: dev", out)

    def test_refuses_during_a_merge(self):
        self.advance()
        git_dir = self.git(self.user, "rev-parse", "--git-dir").strip()
        write(os.path.join(self.user, git_dir) if not os.path.isabs(git_dir) else git_dir, "MERGE_HEAD", self.head0 + "\n")
        code, out = self.tool("apply")
        self.assertEqual(code, 1)
        self.assertIn("途中", out)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.0.0")

    def test_small_fix_without_a_new_version(self):
        self.commit({"characters/mikan/persona.md": "# みかん\n- 小さな直し\n"}, "fix")
        self.git(self.author, "push", "-q", self.origin, "main")
        code, out = self.tool("check")
        self.assertIn("小さな直しが 1 個あります", out)
        self.assertEqual(self.tool("check", "--quiet")[1].strip(), "")   # 版が同じなら、起動のおしらせは出さない
        code, out = self.tool("apply")
        self.assertEqual(code, 0, out)
        self.assertIn("小さな直しを入れました(版は 1.0.0)", out)

    def test_own_commits_stop_the_update(self):
        self.advance()
        write(self.user, "characters/norrie/persona.md", EDITED_NORRIE)
        self.git(self.user, "commit", "-q", "-am", "mine")
        code, out = self.tool("apply")
        self.assertEqual(code, 1)
        self.assertIn("自分で記録した変更", out)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.0.0")
        self.assertEqual(self.backup_dirs(), [])

    def hook(self, cwd=None, **env):
        p = subprocess.run([NODE, os.path.join(cwd or self.user, "tools", "yuru_update_hook.mjs")], cwd=cwd or self.user,
                           env=dict(self.env, **env), capture_output=True, timeout=30)
        self.assertEqual(p.returncode, 0)   # 起動のおしらせは、何があっても止めない
        return p.stdout.decode("utf-8", "replace").strip()

    @unittest.skipUnless(NODE, "node が無い")
    def test_start_hook_tells_once_a_day_and_never_stops(self):
        self.advance()
        self.assertEqual(self.hook(YURU_UPDATE_CHECK="0"), "")          # 止めてある時は何もしない
        line = self.hook()
        self.assertIn("新しい版 1.1.0 があります", line)
        self.assertEqual(line.count("\n"), 0)
        self.assertEqual(self.hook(), "")                               # 今日はもう見た
        plain = os.path.join(self.tmp.name, "plain")
        for rel_path, data in tool_files().items():
            write(plain, rel_path, data)
        self.assertEqual(self.hook(cwd=plain), "")                     # git clone でない
        self.assertEqual(sorted(os.listdir(plain)), ["tools"])          # 何も書かない
        shutil.move(self.origin, self.origin + ".away")
        os.remove(os.path.join(self.user, ".yuru_update.json"))
        self.assertEqual(self.hook(), "")                               # ネットに届かない

    @unittest.skipUnless(NODE, "node が無い")
    def test_start_hook_skips_the_store_python(self):
        hook_url = "file:///" + os.path.join(HERE, "yuru_update_hook.mjs").replace(os.sep, "/").lstrip("/")
        js = (f"const m = await import({json.dumps(hook_url)});"
              "console.log(JSON.stringify(["
              "m.findPython('C:\\\\Users\\\\a\\\\AppData\\\\Local\\\\Microsoft\\\\WindowsApps', 'win32', () => true),"
              "m.findPython('C:\\\\Py310;C:\\\\Users\\\\a\\\\AppData\\\\Local\\\\Microsoft\\\\WindowsApps', 'win32', (f) => f.endsWith('python.exe'))[0],"
              "m.findPython('', 'linux', () => true)]));")
        p = subprocess.run([NODE, "--input-type=module", "-e", js], capture_output=True, timeout=30)
        got = json.loads(p.stdout.decode("utf-8"))
        self.assertIsNone(got[0])                       # ストアの入口だけなら、Python は無いとみなす
        self.assertTrue(got[1].lower().startswith("c:\\py310"))
        self.assertIsNone(got[2])

    # ---------- 途中で止まった時(UPV 1) ----------

    def stop_midway(self, point):
        driver = os.path.join(self.tmp.name, "kill_driver.py")
        with open(driver, "w", encoding="utf-8") as f:
            f.write(KILL_DRIVER)
        p = subprocess.run([sys.executable, driver, self.user, point], cwd=self.user, env=self.env,
                           capture_output=True, timeout=180)
        return p.returncode, p.stdout.decode("utf-8", "replace") + p.stderr.decode("utf-8", "replace")

    def test_stopped_midway_then_apply_again_keeps_the_edited_sample(self):
        for point in ("after_checkout", "after_merge"):
            with self.subTest(point=point):
                self.tmp.cleanup()
                self.setUp()
                before = self.put_mine()
                self.advance()
                code, _ = self.stop_midway(point)
                self.assertEqual(code, 9)
                code, out = self.tool("check")
                self.assertIn("途中で止まっています", out)
                code, out = self.tool("apply")
                self.assertEqual(code, 0, out)
                self.assertIn("先に前のままに戻しました", out)
                self.assertIn("新しい版 1.1.0 になりました", out)
                self.assertEqual(text(self.user, "characters/norrie/persona.md"), EDITED_NORRIE)
                code, out = self.tool("undo")
                self.assertEqual(code, 0, out)
                self.assertEqual(self.git(self.user, "rev-parse", "HEAD").strip(), self.head0)
                for rel, h in before.items():
                    self.assertEqual(sha(self.user, rel), h, rel)

    def test_stopped_midway_then_undo_goes_back(self):
        before = self.put_mine()
        self.advance()
        self.assertEqual(self.stop_midway("after_merge")[0], 9)
        code, out = self.tool("undo")
        self.assertEqual(code, 0, out)
        self.assertIn("先に前のままに戻しました", out)
        self.assertEqual(self.git(self.user, "rev-parse", "HEAD").strip(), self.head0)
        for rel, h in before.items():
            self.assertEqual(sha(self.user, rel), h, rel)

    def test_ctrl_c_is_a_kind_message_and_goes_back(self):
        self.put_mine()
        self.advance()
        code, out = self.stop_midway("ctrlc_after_merge")
        self.assertEqual(code, 3, out)
        self.assertNotIn("Traceback", out)
        self.assertIn("前のままに戻しました", out)
        self.assertEqual(self.git(self.user, "rev-parse", "HEAD").strip(), self.head0)
        self.assertEqual(text(self.user, "characters/norrie/persona.md"), EDITED_NORRIE)

    def test_stopped_after_switching_then_apply_finishes_the_rest(self):
        self.put_mine()
        self.advance()
        self.assertEqual(self.stop_midway("after_applied")[0], 9)
        code, out = self.tool("apply")
        self.assertEqual(code, 0, out)
        self.assertIn("続きをします", out)
        self.assertIn("MIGRATE-CALLED", out)
        self.assertIn("OFFERS-TEXT-CALLED", out)
        self.assertIn("もう、いちばん新しい版です", self.tool("apply")[1])
        self.assertEqual(self.tool("undo")[0], 0)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.0.0")

    # ---------- 答えない取り先(UPV 2) ----------

    def test_silent_remote_does_not_hang(self):
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(16)
        held = []

        def hold():
            while True:
                try:
                    held.append(srv.accept()[0])
                except OSError:
                    return
        threading.Thread(target=hold, daemon=True).start()
        port = srv.getsockname()[1]
        try:
            self.git(self.user, "remote", "set-url", "origin", f"http://127.0.0.1:{port}/repo.git")
            t0 = time.time()
            code, out = self.tool("check", "--quiet")
            self.assertEqual((code, out.strip()), (0, ""))
            self.assertLess(time.time() - t0, 20)
            if NODE:
                t0 = time.time()
                self.assertEqual(self.hook(), "")
                self.assertLess(time.time() - t0, 12)
            if os.name == "nt":
                time.sleep(1)
                q = subprocess.run(["powershell", "-NoProfile", "-Command",
                                    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'git*' -and "
                                    "$_.CommandLine -like '*127.0.0.1:%d*' }).Count" % port],
                                   capture_output=True, text=True, timeout=60)
                self.assertEqual(q.stdout.strip(), "0")   # git の子や孫が残っていない
        finally:
            srv.close()
            for c in held:
                c.close()

    # ---------- 元に戻す時(UPV 3) ----------

    def test_undo_keeps_a_later_edit_of_a_file_the_update_did_not_touch(self):
        self.put_mine()
        self.advance()
        self.assertEqual(self.tool("apply")[0], 0)
        later = EDITED_NORRIE + "- もう一行(新しくした後に書き足した)\n"
        write(self.user, "characters/norrie/persona.md", later)
        code, out = self.tool("undo")
        self.assertEqual(code, 0, out)
        self.assertIn("いまの中身のまま残しました", out)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.0.0")
        self.assertEqual(text(self.user, "characters/norrie/persona.md"), later)

    def test_undo_save_mine_copies_then_goes_back(self):
        self.put_mine()
        old_mikan = sha(self.user, "characters/mikan/persona.md")
        self.advance()
        self.assertEqual(self.tool("apply")[0], 0)
        write(self.user, "characters/mikan/persona.md", "# みかん\n- 新しくした後に直した\n")
        code, out = self.tool("undo")
        self.assertEqual(code, 1)
        self.assertIn("undo --save-mine", out)
        code, out = self.tool("undo", "--save-mine")
        self.assertEqual(code, 0, out)
        self.assertEqual(text(self.user, "VERSION").strip(), "1.0.0")
        self.assertEqual(sha(self.user, "characters/mikan/persona.md"), old_mikan)
        (name,) = self.backup_dirs()
        self.assertEqual(text(self.user, f"backups/{name}/at_undo/characters/mikan/persona.md"), "# みかん\n- 新しくした後に直した\n")
        self.assertIn(f"backups/{name}/at_undo/characters/mikan/persona.md", out)

    # ---------- 名前替えと作り方のファイル(UPV 4) ----------

    def test_rename_also_moves_the_builder_and_spec_files(self):
        write(self.user, "characters/newbie/character.json", '{"id": "newbie", "name": "わたしの子"}\n')
        write(self.user, "creator/builders/newbie.py", "# わたしの子の組み立て\n")
        write(self.user, "creator/specs/newbie_built.json", '{"id": "newbie", "mine": true}\n')
        self.advance({"creator/builders/newbie.py": "# 見本の組み立て\n",
                      "creator/specs/newbie_built.json": '{"id": "newbie"}\n'})
        self.assertEqual(self.tool("apply")[0], 1)
        code, out = self.tool("apply", "--rename", "newbie=newbie_mine")
        self.assertEqual(code, 0, out)
        self.assertEqual(text(self.user, "creator/builders/newbie_mine.py"), "# わたしの子の組み立て\n")
        self.assertEqual(text(self.user, "creator/builders/newbie.py"), "# 見本の組み立て\n")
        self.assertEqual(json.loads(text(self.user, "creator/specs/newbie_mine_built.json")), {"id": "newbie_mine", "mine": True})
        code, out = self.tool("undo")
        self.assertEqual(code, 0, out)
        self.assertEqual(text(self.user, "creator/builders/newbie.py"), "# わたしの子の組み立て\n")
        self.assertEqual(json.loads(text(self.user, "creator/specs/newbie_built.json")), {"id": "newbie", "mine": True})
        self.assertFalse(os.path.exists(os.path.join(self.user, "creator", "builders", "newbie_mine.py")))

    # ---------- 改行・消した見本・add だけの物(UPV 7) ----------

    def test_deleted_sample_file_added_file_and_line_ends(self):
        self.put_mine()
        os.remove(os.path.join(self.user, "characters", "mikan", "persona.md"))
        write(self.user, "characters/norrie/extra.md", "# 足した\n")
        self.git(self.user, "add", "characters/norrie/extra.md")
        self.advance()
        p = subprocess.run([sys.executable, os.path.join("tools", "yuru_update.py"), "apply"], cwd=self.user,
                           env=self.env, capture_output=True, timeout=180)
        self.assertEqual(p.returncode, 0)
        self.assertNotIn(b"\r\r\n", p.stdout)
        out = p.stdout.decode("utf-8", "replace")
        self.assertIn("消していた", out)
        self.assertNotIn("tracked/characters/mikan/persona.md", out)
        self.assertIn("characters/norrie/extra.md", self.git(self.user, "diff", "--cached", "--name-only"))
        self.assertEqual(self.tool("undo")[0], 0)
        self.assertFalse(os.path.exists(os.path.join(self.user, "characters", "mikan", "persona.md")))
        self.assertIn("characters/norrie/extra.md", self.git(self.user, "diff", "--cached", "--name-only"))

    def test_already_newest(self):
        code, out = self.tool("check")
        self.assertIn("いちばん新しい版です", out)
        code, out = self.tool("apply")
        self.assertEqual(code, 0)
        self.assertIn("もう、いちばん新しい版です", out)
        self.assertEqual(self.backup_dirs(), [])


if __name__ == "__main__":
    unittest.main()
