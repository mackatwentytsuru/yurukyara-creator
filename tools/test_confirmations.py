"""ちょうどよい確認の決まりを、設定とスキルから点検する試験(標準ライブラリのみ)。

実行: python -I tools/test_confirmations.py (リポジトリの直下から)
"""
import glob
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_bytes(rel):
    with open(os.path.join(ROOT, *rel.split("/")), "rb") as f:
        return f.read()


def read_text(rel):
    return read_bytes(rel).decode("utf-8-sig")


SETTINGS = json.loads(read_text(".claude/settings.json"))
PERM = SETTINGS["permissions"]
ALLOW, ASK, DENY = PERM["allow"], PERM["ask"], PERM["deny"]


# ---- 小さな規則の模擬(deny > ask > allow、どれにも当たらなければ既定の確認) ----
def _parse(rule):
    m = re.match(r"^(\w+)\((.*)\)$", rule, re.S)
    return (m.group(1), m.group(2)) if m else (None, None)


def _glob_to_regex(pat):
    pat = pat.lstrip("/")
    out, i = [], 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pat.startswith("**", i):
            out.append(".*")
            i += 2
        elif pat[i] == "*":
            out.append("[^/]*")
            i += 1
        else:
            out.append(re.escape(pat[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def _matches(tool, arg, rule):
    rtool, body = _parse(rule)
    if rtool != tool:
        return False
    if tool == "Bash":
        if body.endswith(" *"):
            base = body[:-2]
            return arg == base or arg.startswith(base + " ")
        return arg == body
    return bool(_glob_to_regex(body).match(arg.lstrip("/")))


def decide(tool, arg):
    for name, rules in (("deny", DENY), ("ask", ASK), ("allow", ALLOW)):
        if any(_matches(tool, arg, r) for r in rules):
            return name
    return "ask(default)"


class SettingsShape(unittest.TestCase):
    def test_modes(self):
        self.assertEqual(PERM["defaultMode"], "default")
        self.assertEqual(PERM["disableAutoMode"], "disable")

    def test_hooks_exact(self):
        hooks = SETTINGS["hooks"]
        pre = hooks["PreToolUse"]
        self.assertEqual(len(pre), 1)
        self.assertEqual(pre[0]["matcher"], "Bash|Write|Edit|MultiEdit")
        self.assertEqual(pre[0]["hooks"], [{
            "type": "command",
            "command": 'node "$CLAUDE_PROJECT_DIR/tools/hooks/check-secrets.mjs"',
            "timeout": 30}])
        ups = hooks["UserPromptSubmit"]
        self.assertEqual(len(ups), 1)
        self.assertEqual(ups[0]["hooks"], [{
            "type": "command",
            "command": 'node "$CLAUDE_PROJECT_DIR/tools/hooks/stage-gate.mjs"',
            "timeout": 10}])
        post = hooks["PostToolUse"]
        self.assertEqual(len(post), 1)
        self.assertEqual(post[0]["matcher"], "Edit|Write")
        self.assertEqual(post[0]["hooks"], [{
            "type": "command",
            "command": 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/run-web-tests.mjs"',
            "timeout": 90}])


class AllowList(unittest.TestCase):
    def test_no_wildcard_test_or_date(self):
        for e in ALLOW:
            if "*" in e:
                for word in ("node --test", "unittest", "npm test"):
                    self.assertNotIn(word, e, e)
                # date は単語として(update などの一部ではなく)
                self.assertIsNone(re.search(r"\bdate\b", e), e)

    def test_exact_forms_present(self):
        for e in ("Bash(npm --prefix web test)",
                  "Bash(python -I -m unittest discover -s creator/learn)",
                  "Bash(date +%F)"):
            self.assertIn(e, ALLOW)

    def test_bash_star_only_trailing(self):
        for e in ALLOW:
            tool, body = _parse(e)
            if tool != "Bash":
                continue
            core = body[:-2] if body.endswith(" *") else body
            self.assertNotIn("*", core, e)

    def test_never_in_allow(self):
        bad = ("learn_check.py apply", "yuru_update.py apply", "yuru_update.py undo",
               "run_built", "run_groups", "serve_review", "WebFetch", "git push", "rm ")
        for e in ALLOW:
            for b in bad:
                self.assertNotIn(b, e, e)


class AskAndDeny(unittest.TestCase):
    def test_ask_required(self):
        need = [
            "Edit(/creator/work/*/learn/persona.*)",
            "Edit(/creator/work/*/review/**)",
            "Edit(/characters/*/persona.md)",
            "Edit(/characters/*/character.json)",
            "Bash(python creator/learn/learn_check.py apply *)",
            "Bash(python -I creator/learn/learn_check.py apply *)",
            "Bash(python3 creator/learn/learn_check.py apply *)",
            "Bash(python tools/yuru_update.py undo *)",
            "Bash(python tools/yuru_update.py undo)",
            "Bash(python tools/yuru_update.py apply *)",
        ]
        for n in need:
            self.assertIn(n, ASK)

    def test_deny_required(self):
        need = ["Read(**/.env)", "Read(**/.env.*)", "Bash(curl *)", "Bash(wget *)",
                "Bash(scp *)", "Bash(ssh *)", "Bash(rm -rf *)", "Bash(git push --force *)"]
        for n in need:
            self.assertIn(n, DENY)


class Attacks(unittest.TestCase):
    def test_bash_not_allowed(self):
        for cmd in ("node --test creator/work/x/a.test.mjs",
                    "python -m unittest discover -s creator/work/x",
                    "npm test -- creator/work/x/a.test.mjs",
                    "date -f web/.env"):
            self.assertNotEqual(decide("Bash", cmd), "allow", cmd)

    def test_bash_expected(self):
        cases = {
            "python tools/yuru_update.py undo": "ask",
            "python creator/learn/learn_check.py apply kono p.md --yes": "ask",
            "python creator/learn/learn_check.py check creator/work/kono/learn/proposal.md --proposal": "allow",
            "python -I creator/learn/learn_check.py undo kono": "allow",
            "npm --prefix web test": "allow",
            "date +%F": "allow",
            "curl https://example.com": "deny",
            "rm -rf creator/work/x": "deny",
            "rm creator/work/x/a.txt": "ask",
        }
        for cmd, want in cases.items():
            self.assertEqual(decide("Bash", cmd), want, cmd)

    def test_edit_expected(self):
        cases = {
            "creator/work/x/learn/persona.99999999-999999.bak.md": "ask",
            "creator/work/x/review/request.json": "ask",
            "creator/work/x/review/3.json": "ask",
            "creator/work/x/learn/proposal.md": "allow",
            "characters/kono/persona.md": "ask",
            "web/src/conversation/safety.js": "ask",
            "web/.env": "deny",
        }
        for path, want in cases.items():
            self.assertEqual(decide("Edit", path), want, path)

    def test_second_review_holes(self):
        # 2 回目の見直し(Opus): 出力先を選べる道具・cd・前の版の戻し・会話の画面へ入れる
        not_allowed = (
            "python creator/setup/doctor.py --blender creator/work/x/b.bat",
            "python creator/setup/doctor.py --write",
            "python creator/pipeline/t07_talk.py creator/work/a/b norrie --persona creator/work/x/evil.md",
            "python creator/pipeline/d02_check_svg.py x.svg --json characters/norrie/persona.md",
            "python creator/review/redo_check.py --json characters/norrie/persona.md",
            "sh creator/pipeline/check_all.sh a b c characters/norrie/persona.md",
            "python creator/pipeline/d01_svg_to_png.py creator/work/x/a.svg characters/norrie/a.png",
            "python creator/review/upgrade_offers.py --restore norrie",
            "python creator/review/upgrade_offers.py --text --restore norrie",
            "python creator/review/review_state.py init norrie",
            "python creator/review/review_state.py init norrie --words x",
            "python -m pip install pillow numpy scipy",
            "python -m unittest discover -s creator/learn",
            "npm test",
            "npm start",
        )
        for cmd in not_allowed:
            self.assertNotEqual(decide("Bash", cmd), "allow", cmd)
        for cmd in ("python creator/pipeline/t07_talk.py a b",
                    "python creator/review/upgrade_offers.py --restore norrie"):
            self.assertEqual(decide("Bash", cmd), "ask", cmd)
        for cmd in ("python creator/review/yuru_make.py next norrie", "python creator/review/upgrade_offers.py --json",
                    "python creator/setup/doctor.py", "python creator/review/review_state.py can-start norrie 0",
                    "python -I -m unittest discover -s creator/learn"):
            self.assertEqual(decide("Bash", cmd), "allow", cmd)
        for path in ("creator/work/x/creator/review/yuru_make.py", "creator/work/x/package.json",
                     "creator/work/x/tools/test_confirmations.py", "creator/work/x/web/package.json",
                     "creator/work/x/creator/learn/test_evil.py", "creator/builders/x/creator/review/yuru_make.py",
                     "characters/kono/2d/creator/review/yuru_make.py", "characters/kono/2d/web/package.json"):
            self.assertEqual(decide("Edit", path), "ask", path)
        self.assertNotEqual(decide("Edit", "creator/draw/gen_x.py"), "allow")


class Skills(unittest.TestCase):
    def test_copies_equal(self):
        pairs = (("yuru-learn", "creator/learn/skill/SKILL.md"),
                 ("yuru-next", "creator/review/skill/yuru-next/SKILL.md"))
        for name, other in pairs:
            self.assertEqual(read_bytes(".claude/skills/%s/SKILL.md" % name),
                             read_bytes(other), name)

    def test_allowed_tools_safe(self):
        paths = glob.glob(os.path.join(ROOT, ".claude", "skills", "*", "SKILL.md"))
        self.assertTrue(paths)
        for p in paths:
            with open(p, "rb") as f:
                text = f.read().decode("utf-8-sig")
            m = re.search(r"^allowed-tools:[ \t]*(.*)$", text, re.M)
            if not m:
                continue
            for ent in re.split(r",\s*(?=[A-Z])", m.group(1).strip()):
                ent = ent.strip()
                for pre in ("WebFetch", "Write", "Edit"):
                    self.assertFalse(ent.startswith(pre), (p, ent))
                for bad in ("apply", "yuru_update.py undo", "run_built",
                            "date *", "node --test", "unittest"):
                    self.assertNotIn(bad, ent, (p, ent))

    def test_confirmation_phrase(self):
        phrase = "次に出る画面が、その確認です"
        names = ("yuru-learn", "make-character", "yuru-update", "yuru-check",
                 "yc-0-draw", "yc-2d", "yc-7-talk", "talking-character",
                 "hand-built-character", "yuruchara-creator")
        for n in names:
            self.assertIn(phrase, read_text(".claude/skills/%s/SKILL.md" % n), n)

    def test_learn_phrases(self):
        text = read_text(".claude/skills/yuru-learn/SKILL.md")
        self.assertIn("変わる所", text)
        self.assertIn("前の版", text)


class Doc(unittest.TestCase):
    def test_confirmations_doc(self):
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "docs", "confirmations.md")))
        lines = read_text("docs/confirmations.md").splitlines()
        heads = [(i, l) for i, l in enumerate(lines) if l.lstrip().startswith("#")]
        self.assertTrue(heads)
        first = heads[0][1]
        self.assertTrue(re.search(r"[぀-ヿ一-鿿]", first), first)
        when = [i for i, l in heads if "When" in l]
        self.assertTrue(when, "English 'When' heading missing")
        jp_last = max(i for i, l in enumerate(lines)
                      if re.search(r"[぀-ヿ一-鿿]", l) and i < when[0])
        self.assertLess(jp_last, when[0])


if __name__ == "__main__":
    unittest.main()
