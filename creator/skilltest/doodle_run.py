"""落書きの試しの道: 人が 1〜2 分で描いた落書き 1 枚を、ゆるキャラチェック → ⓪ 描き直し → ①〜⑥ 作る → ⑦ 話す まで通し、
結果を正直に記録する。「落書きからでも作れた」と言ってよいのは result.json の passed が true のときだけ。

使い方:
  python creator/skilltest/doodle_run.py <絵 か フォルダ> --work <作業フォルダ> [--id <id>] [--name <表示の名前>]
         [--dry-run] [--watch --until HH:MM] [--model claude-sonnet-5-5]
  - フォルダを渡すと、まだ流していない一番新しい絵(png・jpg)を 1 枚選ぶ(流した絵は <作業>/_done.json に書く)。
  - --watch は、絵が来るまで 30 秒おきに見る(--until の時刻まで)。来たら 1 枚だけ流して終わる。
  - GPU を使う命令(Blender の作り直し・機械の検査・話す確かめ)は、環境変数 YC_GPU_WRAP(JSON の配列。機械の札の道具で
    包む命令の頭)を前に付けて流す。無ければ GPU の段の前で止まる(--no-gpu-wrap は札の要らない機械だけで使う)。
  - 段は stage_run.py で流す(run.jsonl に 1 段 1 行、契約 K6)。描く役・作る役・判定役は新しい文脈の Claude(定額のプラン)。
  - 人の確認(K3)は使わない(夜の無人の試し)。記録の review は none。
出力: <作業>/<id>/ に input.<拡張子>(落書きの写し)・yuru_check/・0_draw/・1_look_to_motion/・build/・7_talk/・run.jsonl・
      result.json・result.md。落書きの元の絵はリポジトリに入れない(描いた人の許可と表記が要る)。
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PY = sys.executable
PICS = (".png", ".jpg", ".jpeg")
STAGE_RUN = os.path.join(HERE, "stage_run.py")
SPLIT = {"first": 1,
         "1": r"getpixel|l01_measure|python -c .*Image\.open|s03_compare|s04_overlay",
         "2": r"builders/[a-z0-9_]+\.py|run_groups\.sh|run_built\.sh",
         "4": r"f01_face_atlas|t01_band_texture",
         "5": r"b07_rig_groups|b03_rig|pk01_package|pk02_check",
         "6": r"b04_motions|b06_posecheck|s02_posesheet|check_all\.sh|j01_judge"}

DRAW_BRIEF = """このリポジトリ(今の作業フォルダ)で、人が描いた落書き 1 枚を、ゆるキャラの元の絵として SVG で描き直してください。
これは「絵 1 枚から 3D の話すキャラを作る」7 段の 0 段目です。

- 落書き: {pic}(Read で開いて見る。描いた人の絵なので、形・色・部品・顔つきを保つ。きれいにしすぎない・足さない)
- ゆるキャラチェックの結果: {check}
- 手順: .claude/skills/yc-0-draw/SKILL.md を最初に全部読み、「2. 絵から作るとき」と 3〜7 のとおりに進める。部品は決まった名前の <g id> に入れる。
- id は {cid}。SVG を書く Python は creator/draw/gen_{cid}.py。途中の出力は {out}/0_draw/out/ に置く。
- d02_check_svg.py の「不可」が 0 になるまで直す。PNG を Read で開いて見て、落書きと並べて 3 回以上描き直す。
- 判定(creator/pipeline/d04_judge_draw.py、出力は {out}/0_draw/judge1/)は 1 回だけ。指摘が妥当なら 1 回だけ直し、judge2/ にもう 1 回だけ。合格を狙って繰り返さない。
- 最後に、できた物を creator/samples/{cid}_元の絵.svg・{cid}_元の絵.png・{cid}_元の絵_noshadow.png・{cid}_設定.md に置く。設定には「元は人の落書き(リポジトリに入れない)」・決めた色・部品の一覧・d02 と判定の結果をそのまま書く。
- 落書きの絵そのものは creator/ にも characters/ にも写さない。画像の取り込み(<image>)・ほかの AI は使わない。
- git のコミット・push・削除はしない。claude や node を名前で止めない。質問には答えられないので、足りない所は自分で決め、最後に 10 行以内で報告(決めた事・d02 の結果・判定の結果・落書きと違ってしまった所)。
"""

BUILD_BRIEF = """このリポジトリ(今の作業フォルダ)で、元の絵から 3D の話すキャラの体を作ってください。7 段の ① 見る 〜 ⑥ 動き までです(⑦ 話すは別の担当がします)。

- 元の絵: creator/samples/{cid}_元の絵.png(測る用の影なし版 {cid}_元の絵_noshadow.png、設定 {cid}_設定.md、座標 creator/draw/gen_{cid}.py)。もとは人の落書き({pic})を 0 段目で描き直した絵です。
- 手順: .claude/skills/make-character/SKILL.md、.claude/skills/talking-character/SKILL.md の 2〜4、.claude/skills/hand-built-character/SKILL.md を最初に全部読み、そのとおりに進める。目と口はシェイプキーの道(sh creator/pipeline/run_groups.sh)。見本は creator/builders/mikan.py と creator/specs/mikan_built.json。
- **部品の大きさは、元の SVG(<g id="char"> の変換を掛けた最終の画素)から測る**。設定の表の数字だけに頼らない(みかんでは表が古く、口が鼻に見えた)。
- id は {cid}。書いてよいのは creator/builders/{cid}.py・creator/specs/{cid}_*.json だけと、作業フォルダ {out}/build/ の中。characters/ には置かない。
- 道具の場所は creator/env.local.sh(Blender 5.2)。パスは J:/... の形で渡す。
- **GPU を使う命令は、必ず次の頭を付けて流す**(機械の札。順番待ちのあいだは待つ): {wrap}
  例: {wrap} sh creator/pipeline/run_groups.sh {cid} {out}/build creator/samples/{cid}_元の絵_noshadow.png
  例: {wrap} env CHECK_GPU=1 sh creator/pipeline/check_all.sh {out}/build/built/{cid}_built.blend {out}/build/pack creator/samples/{cid}_元の絵_noshadow.png {out}/build/check
  ブラウザの道具は CPU の描画なら止まる。止まったら CPU で流し直さない。
- できあがり: {out}/build/pack/(pk01_package.py の出力。pk02_check_character.py が OK)と、check_all.sh が「全部 OK」。判定 j01_judge.py(出力は {out}/build/judge1/)は 1 回だけ流し、指摘が妥当なら 1 回だけ直して judge2/ にもう 1 回だけ。合格を狙って判定を繰り返さない。
- 50 分を超えそうなら、そこまでの物で止めて報告する。git のコミット・push・削除はしない。claude や node を名前で止めない(サーバーは自分で起こした番号だけを止める)。ほかの AI は使わない。
- 質問には答えられないので、足りない所は自分で決めて進め、最後に 10 行以内で報告(できた物・check_all の結果・判定の結果・目で見て気になった所・道具の穴)。
"""


def now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def pick(src, work):
    if os.path.isfile(src):
        return src
    done = set(json.load(open(os.path.join(work, "_done.json"), encoding="utf-8"))) if os.path.exists(os.path.join(work, "_done.json")) else set()
    pics = [p for p in glob.glob(os.path.join(src, "*")) if p.lower().endswith(PICS) and os.path.abspath(p) not in done]
    return max(pics, key=os.path.getmtime) if pics else None


def mark_done(work, pic):
    path = os.path.join(work, "_done.json")
    done = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []
    done.append(os.path.abspath(pic))
    json.dump(done, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def gpu_wrap(allow_none):
    raw = os.environ.get("YC_GPU_WRAP", "").strip()
    if not raw:
        return [] if allow_none else None
    w = json.loads(raw)
    if not isinstance(w, list) or not all(isinstance(x, str) for x in w):
        raise SystemExit("YC_GPU_WRAP は文字の JSON 配列にしてください")
    return w


def shell_words(words):
    return " ".join('"%s"' % w if (" " in w or not w) else w for w in words)


def stage(run_dir, cid, n, name, cmd, upto=None, claude=None):
    """stage_run.py で 1 段流す。戻り値 (ok, 秒)。"""
    if claude:
        args = [PY, STAGE_RUN, "claude", "--run", run_dir, "--char", cid, "--stage", str(n), "--name", name, "--model", claude["model"],
                "--prompt", claude["prompt"], "--cwd", REPO, "--add-dir", run_dir, "--light", "--review", "off",
                "--judge-dir", claude["judge_dir"], "--timeout", str(claude.get("timeout", 3600))]
        if upto is not None:
            args += ["--upto", str(upto)]
        if claude.get("split"):
            args += ["--split", claude["split"]]
    else:
        args = [PY, STAGE_RUN, "tool", "--run", run_dir, "--char", cid, "--stage", str(n), "--name", name, "--review", "off", "--", *cmd]
    t0 = time.time()
    p = subprocess.run(args, cwd=REPO)
    return p.returncode == 0, round(time.time() - t0)


def write_result(run_dir, res):
    res["updated"] = now()
    json.dump(res, open(os.path.join(run_dir, "result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    lines = [f"# 落書きの試し {res['id']}", "",
             f"- 結果: **{'通った' if res['passed'] else '通っていない'}**(止まった所: {res.get('stopped') or 'なし'})",
             f"- 落書き: {res['picture']}(リポジトリに入れない)/ 始め {res['started']} / 更新 {res['updated']}",
             f"- ゆるキャラチェック: {res.get('check', {}).get('class', '-')} → {res.get('check', {}).get('next', '-')}",
             "- 人の確認(K3)は使っていない(夜の無人の試し)。判定役は同じ系統の Claude で、独立した確かめではない。", "",
             "| 段 | ok | 秒 |", "|---|---|---|"]
    lines += [f"| {s['name']} | {'ok' if s['ok'] else 'NG'} | {s['sec']} |" for s in res["stages"]]
    lines += ["", "- 時間と定価に直した目安(定額のプランで流した)は run.jsonl。`python creator/skilltest/stage_run.py sum --run <この場所>`",
              "- 「落書きからでも作れた」と言ってよいのは、上が「通った」のときだけ。"]
    for k in ("talk", "judge_vs_doodle", "note"):
        if res.get(k):
            lines.append(f"- {k}: {json.dumps(res[k], ensure_ascii=False)}")
    open(os.path.join(run_dir, "result.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")


def run_one(pic, a, wrap):
    cid = a.id or ("rakugaki_" + datetime.now().strftime("%m%d_%H%M"))
    run_dir = os.path.join(a.work, cid).replace("\\", "/")
    os.makedirs(run_dir, exist_ok=True)
    ext = os.path.splitext(pic)[1].lower()
    inp = os.path.join(run_dir, "input" + ext).replace("\\", "/")
    shutil.copyfile(pic, inp)
    if ext != ".png":       # 道具は png を読む
        from PIL import Image
        png = os.path.join(run_dir, "input.png").replace("\\", "/")
        Image.open(inp).convert("RGB").save(png)
        inp = png
    res = {"id": cid, "picture": os.path.basename(pic), "started": now(), "passed": False, "stopped": None, "stages": []}
    prev = os.path.join(run_dir, "result.json")
    if a.resume and os.path.exists(prev):        # 続きから: 前に ok だった段は流し直さない
        old = json.load(open(prev, encoding="utf-8"))
        res.update({k: old[k] for k in ("started", "check") if k in old})
        res["stages"] = [x for x in old.get("stages", []) if x.get("ok")]
    done = {x["name"] for x in res["stages"]}

    def step(name, ok, sec):
        res["stages"].append({"name": name, "ok": ok, "sec": sec})
        write_result(run_dir, res)
        return ok

    # 入口: ゆるキャラチェック
    ycp = run_dir + "/yuru_check/yuru_check.json"
    if "ゆるキャラチェック" not in done:
        ok, sec = stage(run_dir, cid, 0, "yuru_check", [PY, "creator/pipeline/c01_yuru_check.py", inp, run_dir + "/yuru_check"])
        yc = json.load(open(ycp, encoding="utf-8")) if os.path.exists(ycp) else {}
        res["check"] = {k: yc.get(k) for k in ("class", "next", "why")}
        if not step("ゆるキャラチェック", ok and bool(yc), sec):
            res["stopped"] = "ゆるキャラチェック"
            return finish(run_dir, res)
    yc = json.load(open(ycp, encoding="utf-8"))
    if yc["class"] == "human":
        res["stopped"] = "人の絵と分かれた(使う人の「ゆるキャラにしてみる」の はい が要る)"
        return finish(run_dir, res)
    if a.stop_after == "check":
        res["stopped"] = "--stop-after check(道の試し)"
        return finish(run_dir, res)
    check_txt = f"{yc['class']}({yc.get('why')})" + ("。複雑なので主役を 1 つ選んで描き直す" if yc["class"] == "complex" else "")

    # ⓪ 描き直し
    sample = os.path.join(REPO, "creator", "samples", f"{cid}_元の絵_noshadow.png")
    if "⓪ 描き直し" not in done:
        p0 = os.path.join(run_dir, "p0_draw.md")
        open(p0, "w", encoding="utf-8").write(DRAW_BRIEF.format(pic=inp, check=check_txt, cid=cid, out=run_dir))
        ok, sec = stage(run_dir, cid, 0, "draw", None, claude={"model": a.model, "prompt": p0, "judge_dir": run_dir + "/0_draw"})
        if not step("⓪ 描き直し", ok and os.path.exists(sample), sec):
            res["stopped"] = "⓪ 描き直し"
            return finish(run_dir, res)

    # ①〜⑥ 作る
    if a.stop_after == "draw":
        res["stopped"] = "--stop-after draw(道の試し)"
        return finish(run_dir, res)
    if wrap is None:
        res["stopped"] = "GPU の札の道具(YC_GPU_WRAP)が無いので、①〜⑦ の前で止めた"
        return finish(run_dir, res)
    p1 = os.path.join(run_dir, "p1_build.md")
    open(p1, "w", encoding="utf-8").write(BUILD_BRIEF.format(cid=cid, out=run_dir, pic=inp, wrap=shell_words(wrap) or "(札の要らない機械)"))
    split = os.path.join(run_dir, "split_build.json")
    json.dump(SPLIT, open(split, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ok, sec = stage(run_dir, cid, 1, "look_to_motion", None, upto=6,
                    claude={"model": a.model, "prompt": p1, "judge_dir": run_dir + "/build", "split": split})
    check_txt = os.path.join(run_dir, "build", "check", "check.txt")
    all_ok = os.path.exists(check_txt) and "全部 OK" in open(check_txt, encoding="utf-8").read()
    res["check_all"] = open(check_txt, encoding="utf-8").read().strip().splitlines()[-1] if os.path.exists(check_txt) else None
    if not step("①〜⑥ 作る", ok and all_ok and os.path.exists(run_dir + "/build/pack/character.json"), sec):
        res["stopped"] = "①〜⑥ 作る(check_all が全部 OK でない、か pack が無い)"
        return finish(run_dir, res)

    # ⑦ 話す
    talk = [*wrap, PY, "creator/pipeline/t07_talk.py", run_dir + "/build/pack", cid, "--name", a.name or cid, "--out", run_dir + "/7_talk"]
    ok, sec = stage(run_dir, cid, 7, "talk", talk)
    wc = run_dir + "/7_talk/web_check.json"
    res["talk"] = {k: v for k, v in json.load(open(wc, encoding="utf-8")).items() if k in ("ok", "mouth_max", "expressions", "motions", "problems")} if os.path.exists(wc) else None
    if not step("⑦ 話す", ok and bool(res["talk"]) and res["talk"].get("ok"), sec):
        res["stopped"] = "⑦ 話す"
        return finish(run_dir, res)
    cj = os.path.join(REPO, "characters", cid, "character.json")
    d = json.load(open(cj, encoding="utf-8"))
    d["origin"] = {"input": "picture", "picture": "落書き(人が描いた。リポジトリに入れない)", "drawn_by": "person",
                   "run": f"run.jsonl({cid})", "created": res["started"]}
    json.dump(d, open(cj, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    res["passed"] = True

    # 参考: 落書きと 3D を、判定役が「同じキャラか」で見る(合否には入れない)
    jd = run_dir + "/judge_vs_doodle"
    ok, sec = stage(run_dir, cid, 7, "judge_vs_doodle", [PY, "creator/pipeline/j01_judge.py", inp, run_dir + "/build/check/browser", jd])
    if os.path.exists(jd + "/judge.json"):
        res["judge_vs_doodle"] = json.load(open(jd + "/judge.json", encoding="utf-8")).get("pass")
    return finish(run_dir, res)


def finish(run_dir, res):
    write_result(run_dir, res)
    print(f"落書きの試し: {'通った' if res['passed'] else '通っていない'}(止まった所: {res['stopped'] or 'なし'})→ {run_dir}/result.md")
    return 0 if res["passed"] else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--work", required=True)
    ap.add_argument("--id")
    ap.add_argument("--name")
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--until", default="07:00")
    ap.add_argument("--no-gpu-wrap", action="store_true")
    ap.add_argument("--stop-after", choices=["check", "draw"], help="道の試し用: その段で止める(結果は「通っていない」のまま)")
    ap.add_argument("--resume", action="store_true", help="同じ --id の前の回で ok だった段を飛ばして、続きから流す")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    wrap = gpu_wrap(a.no_gpu_wrap)
    if a.id and not re.match(r"^[a-z0-9_]{1,32}$", a.id):
        raise SystemExit("id は英小文字・数字・_ の 32 字まで")
    pic = pick(a.src, a.work)
    if a.dry_run:       # 道具と札の用意だけを見る(絵が無くてもよい)
        for tool in ("creator/pipeline/c01_yuru_check.py", "creator/pipeline/d02_check_svg.py", "creator/pipeline/run_groups.sh",
                     "creator/pipeline/check_all.sh", "creator/pipeline/t07_talk.py", "creator/env.local.sh",
                     ".claude/skills/yc-0-draw/SKILL.md", ".claude/skills/make-character/SKILL.md"):
            print(("ある " if os.path.exists(os.path.join(REPO, tool)) else "無い ") + tool)
        print("落書き:", pic or "まだ無い", "/ GPU の札:", "あり" if wrap else ("なし(--no-gpu-wrap)" if wrap == [] else "無い(⓪ のあとで止まる)"))
        return 0
    if pic is None and a.watch:
        hh, mm = map(int, a.until.split(":"))
        start = datetime.now()
        deadline = start.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if deadline <= start:           # 夜をまたぐ(例: 21 時に始めて 07:00 まで)
            deadline += timedelta(days=1)
        print(f"落書きを待ちます({a.src}、{deadline:%m/%d %H:%M} まで 30 秒おき)", flush=True)
        while pic is None and datetime.now() < deadline:
            time.sleep(30)
            pic = pick(a.src, a.work)
        if pic is None:
            print(f"{a.until} まで落書きが来なかった")
            return 3
    if pic is None:
        print("落書きがまだありません:", a.src)
        return 3
    print("落書き:", pic, "/ GPU の札:", "あり" if wrap else ("なし(--no-gpu-wrap)" if wrap == [] else "無い(⓪ のあとで止まる)"))
    mark_done(a.work, pic)
    return run_one(pic, a, wrap)


if __name__ == "__main__":
    sys.exit(main())
