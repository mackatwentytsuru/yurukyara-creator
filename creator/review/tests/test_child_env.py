"""絵を読む Claude(Bash つき)の子に、鍵・トークン・合言葉の環境変数を渡さない試験(SR2・SR3 の HIGH の小さな直し)。
- auto_next.child_env と stage_run.plan_env は、名前に KEY・TOKEN・SECRET・PASSWORD・CREDENTIAL を含む変数を外す。ふつうの変数は残る。
- --lan・--bind で開く時は、auto-next の既定が off になる(serve_review の既定の決め方)。
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "creator" / "review"))
sys.path.insert(0, str(ROOT / "creator" / "skilltest"))
sys.path.insert(0, str(ROOT / "creator" / "pipeline"))
import auto_next  # noqa: E402
import stage_run  # noqa: E402

SECRETS = {
    "ANTHROPIC_API_KEY": "fake-a",
    "ELEVENLABS_API_KEY": "fake-b",
    "GITHUB_TOKEN": "fake-c",
    "MY_SERVICE_SECRET": "fake-d",
    "DB_PASSWORD": "fake-e",
    "AWS_CREDENTIALS": "fake-f",
    "YC_REVIEW_TOKEN": "fake-g",
    "github_token": "fake-h",
}
PLAIN = {"PATH": "/bin", "HOME": "/home/x", "LANG": "ja_JP.UTF-8", "YC_REVIEW_WORK": "/tmp/w"}


class ChildEnvTest(unittest.TestCase):
    def check(self, env):
        for k in SECRETS:
            self.assertNotIn(k, env, f"{k} が子に渡る")
        for k, v in PLAIN.items():
            self.assertEqual(env.get(k), v, f"{k} は残る")
        self.assertFalse([v for v in env.values() if str(v).startswith("fake-")], "偽の値が 1 つも渡らない")

    def test_auto_next_child_env(self):
        with mock.patch.dict(os.environ, {**SECRETS, **PLAIN}, clear=True):
            self.check(auto_next.child_env())

    def test_stage_run_plan_env(self):
        with mock.patch.dict(os.environ, {**SECRETS, **PLAIN}, clear=True):
            self.check(stage_run.plan_env())
            self.assertEqual(stage_run.plan_env("tag").get(stage_run.RG.ENV_GATED), "tag")


class AutoNextDefaultTest(unittest.TestCase):
    def test_lan_or_bind_default_is_off(self):
        src = (ROOT / "creator" / "review" / "serve_review.py").read_text(encoding="utf-8")
        self.assertIn('or args.lan or args.bind) else "claude"', src)


if __name__ == "__main__":
    unittest.main()
