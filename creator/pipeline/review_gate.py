"""段の道具が、人の確認(契約 K3)を読んで、前の段に OK が無ければ止めるための小さな部品。

K3 の正: creator/review/schema/README.md(持ち主 S4)。ここは K3 の CLI(creator/review/review_state.py)だけを呼ぶ。
state.json・<N>.json を自分では書かない。

- 確認の状態(creator/work/<id>/review/state.json)があるキャラは、段 N を始める前に `can-start <id> <N>` を呼び、
  0 でなければ止める(前の段が ok か auto でない = 人がまだ見ていない・やり直し中)。
- 1 回で数段まとめて作るとき(段 N〜M)は、途中に門(人が見る段)があれば止める。門を人の確認なしに越えないため。
- 済んだら `stage <id> <段> done`。門の無い段は道具が <段>.json を auto で書く。門のある段は publish(スマホに出す)を待つ。
- 確認の状態が無いキャラ(人の確認を使わない作り方・夜の無人の試し)は、見ないで進む(mode="auto" のとき)。
  mode="on" は状態が無ければ止める。mode="off" は見ない(記録に「確認を見ずに」と残す)。
"""
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOOL = os.path.join(REPO, "creator", "review", "review_state.py")
GATED = {0: "C0", 2: "C2", 3: "C3", 4: "C3", 7: "C5"}     # K3 の段と門(review_state.py の GATES と同じ)
EXIT_CLOSED = 2
ENV_GATED = "YC_REVIEW_GATED"     # 外側の道具(stage_run.py)が確認を済ませた印。中の道具は二重に見ない


class GateClosed(Exception):
    """前の段の OK が無いので、始めない。"""


def _cli(*args):
    p = subprocess.run([sys.executable, TOOL, *[str(a) for a in args]], cwd=REPO, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout + p.stderr).strip()


def has_state(cid):
    rc, _ = _cli("show", cid)
    return rc == 0


def decide(cid, mode="auto"):
    """確認を見るか。戻り値 True(見る)/ False(見ない)。mode=on で状態が無ければ GateClosed。"""
    if mode == "off":
        return False
    if has_state(cid):
        return True
    if mode == "on":
        raise GateClosed(f"{cid} の確認の状態がありません(先に review_state.py init)")
    return False


def check_range(first, last):
    """段 first〜last を 1 回で作ってよいか。途中(last より前)に門があれば GateClosed。"""
    if last < first:
        raise GateClosed(f"段の範囲が逆です({first}〜{last})")
    inner = [n for n in range(first, last) if n in GATED]
    if inner:
        n = inner[0]
        raise GateClosed(f"段 {n} は門 {GATED[n]}(人が見る段)です。段 {first}〜{n} で止めて、スマホで確かめてから次へ進みます")


def outer_checked():
    """外側の道具が、もう確認を見て段を running にしたか(stage_run.py の中で呼ばれた段の道具)。"""
    return bool(os.environ.get(ENV_GATED))


def begin(cid, first, last=None, mode="auto", note=None):
    """始める前の確かめ。見るなら can-start と範囲を確かめ、段 first を running にする。戻り値 見たか(True/False)。"""
    last = first if last is None else last
    if not decide(cid, mode):
        return False
    check_range(first, last)
    rc, out = _cli("can-start", cid, first)
    if rc != 0:
        raise GateClosed(out or f"段 {first} はまだ始められません")
    args = ["stage", cid, first, "running"] + (["--note", note[:80]] if note else [])
    rc, out = _cli(*args)
    if rc != 0:
        raise GateClosed(out)
    return True


def finish(cid, first, last=None, ok=True, note=None):
    """済んだ後の記録。ok なら段 first〜last を done(門の無い段は auto の <段>.json ができる)、だめなら first を failed。
    戻り値 (門のある最後の段なら、その門の名前 / 無ければ None)。"""
    last = first if last is None else last
    if not ok:
        _cli("stage", cid, first, "failed", *(["--note", note[:80]] if note else []))
        return None
    for n in range(first, last + 1):
        rc, out = _cli("stage", cid, n, "done")
        if rc != 0:
            raise GateClosed(out)
    return GATED.get(last)


def publish(cid, gate, right, png=None, left=None, views=None, sheet=None):
    """門のある段が済んだら、スマホに出す(C0 は描いた SVG、C2 は正面の絵と 8 方向)。"""
    args = ["publish", cid, gate, "--right", right]
    for k, v in (("--png", png), ("--left", left), ("--views", views), ("--sheet", sheet)):
        if v:
            args += [k, v]
    return _cli(*args)
