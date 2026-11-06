"""作例 4 体の検査(契約 K0 の「作例の検査の命令」)。重い物(Blender・GPU)は使わない。1 秒ほど。

使い方: python creator/setup/check_samples.py [--write-hash]
見る物(1 つでも外れたら終わりの番号 1):
  ① character.json が契約 K1 の形(creator/specs/validate_character.py)
  ② ビューアで動く形(creator/pipeline/pk02_check_character.py)
  ③ GLB の大きさの表(pk03_glb_report.py。注意は止めない)
  ④ 作例のファイルが、決めた時の物と同じ(creator/setup/samples_hash.json の sha256)。
     わざと作り直したときだけ --write-hash で書き直し、コミットの文に理由を書く。
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SAMPLES = ("yokoso", "robo", "f_led", "d_lantern")
HASHES = REPO / "creator" / "setup" / "samples_hash.json"
PY = sys.executable
TEXT = {".json", ".md", ".txt", ".svg", ".html", ".css", ".js", ".mjs", ".py", ".sh"}  # .gitattributes の text eol=lf と同じ。Windows の CRLF でも Mac・Linux の LF でも同じ値にする


def run(args):
    p = subprocess.run([PY, *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout + p.stderr).strip()


def file_hashes():
    out = {}
    for cid in SAMPLES:
        for f in sorted((REPO / "characters" / cid).rglob("*")):
            if f.is_file():
                b = f.read_bytes()
                if f.suffix in TEXT:      # git の改行の書きかえ(Windows の CRLF)で値が変わらないように
                    b = b.replace(b"\r\n", b"\n")
                out[f.relative_to(REPO).as_posix()] = hashlib.sha256(b).hexdigest()
    return out


def main():
    bad = 0
    for cid in SAMPLES:
        folder = f"characters/{cid}"
        rc1, o1 = run(["creator/specs/validate_character.py", f"{folder}/character.json"])
        rc2, o2 = run(["creator/pipeline/pk02_check_character.py", folder])
        _, o3 = run(["creator/pipeline/pk03_glb_report.py", folder])
        print(f"{cid}: ① {'OK' if rc1 == 0 else 'NG'} ② {'OK' if rc2 == 0 else 'NG'} ③ {o3.splitlines()[0] if o3 else '?'}")
        for rc, o in ((rc1, o1), (rc2, o2)):
            if rc:
                print("   " + o.replace("\n", "\n   "))
        bad += bool(rc1 or rc2)
    now = file_hashes()
    if "--write-hash" in sys.argv:
        HASHES.write_text(json.dumps(now, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"④ 書いた: {HASHES.relative_to(REPO).as_posix()}({len(now)} ファイル)")
    elif HASHES.exists():
        old = json.loads(HASHES.read_text(encoding="utf-8"))
        diff = sorted(k for k in set(old) | set(now) if old.get(k) != now.get(k))
        print(f"④ {'OK' if not diff else 'NG'} 作例のファイルが決めた時と同じ({len(now)} ファイル)")
        for k in diff[:20]:
            print(f"   変わった: {k}")
        bad += bool(diff)
    else:
        print("④ NG samples_hash.json が無い(--write-hash で作る)")
        bad += 1
    print("結果:", "合格" if not bad else f"不合格 {bad}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
