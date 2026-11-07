"""スマホだけで作る(PC は動かしたまま): 作る画面から頼みが届いたら、作る道のサーバーが /yuru-next を自分で流す(B4。11/8 第 12 波 b)。

本人「スマホから作れないの?」。今までは、スマホで押した後に PC で /yuru-next と打つ人が要った。
- 流すのは、使う人の Claude Code(claude -p で /yuru-next。リポジトリの頭で)。1 回に 1 本だけ。時間の上限つき。
- 起こすのは、合言葉の門を通った書き込み(serve_review.py の do_POST が成功した後)だけ。
- 止めるには serve_review.py に --auto-next off(既定は claude)。direct は yuru_make.py next を直に流す(中の絵は Claude Code)。
- 進み具合は state.json の activity(yuru_make.py が書く)と、ここの status()(busy・最後の結果)で画面に出る。
- claude や node を名前で止めない。時間切れは、自分で起こした子の PID だけを止める(Windows は taskkill /T /PID)。
"""
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MODES = ("claude", "direct", "off")
JOB_TIMEOUT = 660          # 1 本の上限(秒)。絵の Claude は 9 分で止まる + 受け取りの分
MAX_ROUNDS = 6             # 1 回の頼みで続けて流す上限(受け取り → 2D → 何も無い、で止まる)
DROP_ENV = ("CLAUDECODE",)


def child_env():
    """子の Claude Code に、この会話の印(CLAUDE_CODE_*)を渡さない(入れ子の会話と見なされないように)。鍵は読まない・足さない。"""
    return {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_CODE_") and k not in DROP_ENV}


def command(mode, model="claude-sonnet-5-5", extra=()):
    py = sys.executable
    if mode == "claude":
        claude = shutil.which("claude") or "claude"
        return [claude, "-p", "/yuru-next", "--model", model, "--output-format", "json"]
    if mode == "direct":
        return [py, str(HERE / "yuru_make.py"), "next", *extra]
    raise ValueError(mode)


def _kill_tree(p):
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
    else:
        p.kill()


class AutoNext:
    """1 本ずつ流す係。kick() は待たずに返る。流している間の kick は 1 回分だけ覚えて、終わった後にもう 1 回流す。"""

    def __init__(self, mode="claude", model="claude-sonnet-5-5", extra=(), timeout=JOB_TIMEOUT, has_work=None, log=None):
        if mode not in MODES:
            raise ValueError(f"--auto-next は {'・'.join(MODES)} のどれか")
        self.mode = mode
        self.cmd = command(mode, model, extra) if mode != "off" else None
        self.timeout = timeout
        self.has_work = has_work or (lambda: False)   # まだ進められる物があるか(yuru_make.candidates)
        self.log = log or (lambda *_: None)
        self.lock = threading.Lock()
        self.wanted = False
        self.busy = False
        self.runs = 0
        self.last = None          # {"code", "sec", "at"}

    @property
    def on(self):
        return self.mode != "off"

    def status(self):
        with self.lock:
            return {"on": self.on, "busy": self.busy, "runs": self.runs, "last": self.last}

    def kick(self):
        if not self.on:
            return False
        with self.lock:
            self.wanted = True
            if self.busy:
                return True
            self.busy = True
        threading.Thread(target=self._loop, name="auto-next", daemon=True).start()
        return True

    def _loop(self):
        try:
            rounds = 0
            while rounds < MAX_ROUNDS:
                with self.lock:
                    if not self.wanted:
                        break
                    self.wanted = False
                rounds += 1
                code = self._run_one()
                # 進めた(0)なら、まだ進められる物があるかを見て、もう 1 本(受け取り → 2D、変換の OK → 受け渡し)
                if code == 0 and self.has_work():
                    with self.lock:
                        self.wanted = True
        finally:
            with self.lock:
                self.busy = False

    def _run_one(self):
        t0 = time.monotonic()
        code = None
        try:
            p = subprocess.Popen(self.cmd, cwd=ROOT, env=child_env(), stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            try:
                out, _ = p.communicate(timeout=self.timeout)
                code = p.returncode
            except subprocess.TimeoutExpired:
                _kill_tree(p)
                out, _ = p.communicate()
                code = "timeout"
            self.log("auto-next", code, round(time.monotonic() - t0), (out or b"")[-400:].decode("utf-8", "replace"))
        except OSError as e:
            code = "not_found"
            self.log("auto-next", code, 0, str(e))
        with self.lock:
            self.runs += 1
            self.last = {"code": code, "sec": round(time.monotonic() - t0), "at": time.strftime("%H:%M:%S")}
        # claude -p は進めても何も無くても 0 を返す。direct は 0 = 進めた・4 = 何も無い
        return 0 if code == 0 else 1
