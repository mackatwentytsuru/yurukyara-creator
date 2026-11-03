"""離れた所(店など)の Mac につないだ iPad / iPhone の撮影記録を、PC から更新する。

  python place/ios/tools/update_remote.py --check                 # 更新できる状態かだけを見る(何も変えない)
  python place/ios/tools/update_remote.py --device ipad           # 変わったファイルだけ送り、組み立てて入れる
  python place/ios/tools/update_remote.py --device ipad --rollback # 控えの版に戻す
  python place/ios/tools/update_remote.py --keep                  # いま入っている組み立てを控えにする

Mac へは ssh(Tailscale)。送るのは変わったファイルだけなので、細い回線でも足りる。組み立てと署名は Mac の
画面のセッションで動く(`open ipad_build.command`)。Mac の画面のロックが解けていないと署名で止まる。
組み立てに失敗したら入れない。入れてもアプリの Documents(テイクの一覧など)は残る。
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HOST = "pc3"
DEST = "sample_work/place_ios"
KEEP = "sample_work/stable_app"
APP = "build/Build/Products/Debug-iphoneos/ShootLog.app"
IOS = Path(__file__).resolve().parents[1]
SOURCES = ["project.yml", "RoomScan", "ARStage", "ShootLog", "CamProbe", "Shared", "ARSite"]
BUILD_SCRIPT = IOS / "tools" / "ipad_build.command"
DEVICES = {"ipad": "00008103-001959392279001E", "iphone": "00008101-000A4C9A2E45001E"}
PATH_FIX = "export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH; "


def ssh(cmd, *, stdin=None, timeout=120):
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=15", HOST, cmd], input=stdin, capture_output=True, timeout=timeout)
    return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")


def local_hashes():
    out = {}
    for s in SOURCES:
        p = IOS / s
        for f in [p] if p.is_file() else sorted(x for x in p.rglob("*") if x.is_file()):
            if f.name == ".DS_Store":
                continue
            out[f.relative_to(IOS).as_posix()] = hashlib.sha256(f.read_bytes()).hexdigest()
    return out


def remote_hashes():
    script = (
        "import hashlib, json, os\n"
        f"os.chdir(os.path.expanduser('~/{DEST}'))\n"
        "out = {}\n"
        f"for s in {SOURCES!r}:\n"
        "    if os.path.isfile(s):\n"
        "        out[s] = hashlib.sha256(open(s, 'rb').read()).hexdigest()\n"
        "    for d, _, fs in os.walk(s):\n"
        "        for n in fs:\n"
        "            if n != '.DS_Store':\n"
        "                p = os.path.join(d, n)\n"
        "                out[p] = hashlib.sha256(open(p, 'rb').read()).hexdigest()\n"
        "print(json.dumps(out))\n"
    )
    rc, so, se = ssh("python3 -", stdin=script.encode("utf-8"))
    if rc:
        raise SystemExit("Mac のファイルを読めません: " + se[-300:])
    return json.loads(so)


def route():
    r = subprocess.run(["tailscale", "status"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    for line in r.stdout.splitlines():
        if HOST in line:
            m = re.search(r"(direct [^,]+|relay \"[^\"]+\"|offline[^,]*)", line)
            return m.group(1) if m else line.strip()
    return "不明"


def device_state(udid):
    rc, so, se = ssh(PATH_FIX + f"xcrun devicectl device info details --device {udid} --json-output /tmp/dev.json >/dev/null 2>&1; echo rc=$?; cat /tmp/dev.json 2>/dev/null", timeout=60)
    m = re.match(r"rc=(\d+)\n", so)
    if not m or m.group(1) != "0":
        return None
    try:
        res = json.loads(so[m.end():])["result"]
        conn = res.get("connectionProperties", {})
        return {"名前": res.get("deviceProperties", {}).get("name"), "つなぎ": conn.get("transportType"), "経路": conn.get("tunnelState")}
    except (KeyError, ValueError):
        return None


def profile_days():
    rc, so, _ = ssh(f"cd ~/{DEST}; security cms -D -i {APP}/embedded.mobileprovision 2>/dev/null > /tmp/prov.plist; /usr/libexec/PlistBuddy -c 'Print :ExpirationDate' /tmp/prov.plist; date '+%s'; date -j -f '%a %b %d %T %Z %Y' \"$(/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' /tmp/prov.plist)\" '+%s'")
    lines = so.strip().splitlines()
    if rc or len(lines) < 3:
        return None, None
    return lines[0], (int(lines[2]) - int(lines[1])) // 86400


def check(udid):
    good = True
    t0 = time.time()
    rc, so, se = ssh("echo ok; df -g ~ | tail -1 | awk '{print $4}'; ioreg -n Root -d1 | grep -c CGSSessionScreenIsLocked; pgrep -x caffeinate | wc -l")
    print(f"Mac へ ssh: {'つながる' if rc == 0 else 'つながらない'}({time.time() - t0:.1f} 秒、経路 {route()})")
    if rc:
        print(se[-300:])
        return False
    _, free, locked, awake = so.split()[:4]
    print(f"Mac の空き: {free} GB")
    if int(free) < 3:
        print("  ※ 組み立てには 3 GB ほど要ります")
        good = False
    print(f"Mac の画面: {'ロック中' if int(locked) else 'ロックなし'}")
    print(f"Mac を起こしたままにする物(caffeinate): {'動いている' if int(awake) else '動いていない'}")
    state = device_state(udid)
    print(f"機器: {state if state else 'Mac から見えません(USB・Mac の許可・機器の信頼を確かめる)'}")
    good = good and bool(state)
    until, days = profile_days()
    print(f"署名の期限: {until}(あと {days} 日)" if days is not None else "署名の期限: 読めません(まだ組み立てていない)")
    if days is not None and days < 2:
        good = False
    print("更新できます" if good else "このままでは更新できません")
    return good


def send(local, remote):
    changed = sorted(k for k, v in local.items() if remote.get(k) != v)
    gone = sorted(k for k in remote if k not in local and not k.endswith("Info.plist"))     # Info.plist は組み立ての時に作られる
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.PAX_FORMAT) as tar:
        for k in changed:
            tar.add(IOS / k, arcname=k)
    data = buf.getvalue()
    print(f"送る: {len(changed)} 個、圧縮して {len(data) / 1e6:.2f} MB(消す {len(gone)} 個)")
    for k in (changed + [f"(消す) {g}" for g in gone])[:12]:
        print("  ", k)
    t0 = time.time()
    if changed:
        rc, _, se = ssh(f"mkdir -p ~/{DEST} && tar -xzf - -C ~/{DEST}", stdin=data, timeout=3600)
        if rc:
            raise SystemExit("送れませんでした: " + se[-300:])
    if gone:
        rc, _, se = ssh("cd ~/" + DEST + " && xargs -0 rm -f", stdin="\0".join(gone).encode("utf-8"))
        if rc:
            raise SystemExit("消せませんでした: " + se[-300:])
    secs = time.time() - t0
    print(f"送った: {secs:.1f} 秒")
    return len(data), secs


def build():
    script = BUILD_SCRIPT.read_bytes().replace(b"\r\n", b"\n")
    rc, _, se = ssh(f"cat > ~/{DEST}/ipad_build.command; chmod +x ~/{DEST}/ipad_build.command", stdin=script)
    if rc:
        raise SystemExit("組み立ての台本を置けません: " + se[-300:])
    t0 = time.time()
    rc, so, se = ssh(f"cd ~/{DEST}; rm -f ipad_build.done; open ipad_build.command; for i in $(seq 1 240); do [ -f ipad_build.done ] && break; sleep 5; done; [ -f ipad_build.done ] && echo finished; grep -E 'BUILD SUCCEEDED|BUILD FAILED|rc=|error:' ipad_build.log | cut -c1-200 | tail -8", timeout=1300)
    print(f"組み立て: {time.time() - t0:.0f} 秒")
    print(so.strip())
    if "finished" not in so or "BUILD SUCCEEDED" not in so or "rc=0" not in so:
        raise SystemExit("組み立てに失敗しました。入れていません(機器の中は前の版のまま)。Mac の画面のロックも確かめる")


def install(udid, app):
    t0 = time.time()
    rc, so, se = ssh(PATH_FIX + f"xcrun devicectl device install app --device {udid} {app} 2>&1", timeout=600)
    ok = rc == 0 and "App installed" in so
    print(f"入れた: {time.time() - t0:.0f} 秒" if ok else "入れられませんでした:\n" + so[-400:])
    if not ok:
        raise SystemExit(3)
    rc, so, _ = ssh(PATH_FIX + f"xcrun devicectl device info apps --device {udid} 2>/dev/null | grep -i shootlog | cut -c1-110")
    print("機器のアプリ:", so.strip())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--device", choices=sorted(DEVICES), default="ipad")
    ap.add_argument("--check", action="store_true", help="更新できる状態かだけを見る")
    ap.add_argument("--keep", action="store_true", help="いまの組み立てを控えにする")
    ap.add_argument("--rollback", action="store_true", help="控えの版を入れる")
    a = ap.parse_args()
    udid = DEVICES[a.device]
    if a.keep:
        rc, so, se = ssh(f"rm -rf ~/{KEEP}; mkdir -p ~/{KEEP}; cp -R ~/{DEST}/{APP} ~/{KEEP}/ && du -sh ~/{KEEP}/ShootLog.app")
        print("控えにした:", so.strip() if rc == 0 else se[-300:])
        sys.exit(rc)
    if not check(udid):
        sys.exit(2)
    if a.check:
        return
    if a.rollback:
        install(udid, f"~/{KEEP}/ShootLog.app")
        return
    send(local_hashes(), remote_hashes())
    build()
    install(udid, f"~/{DEST}/{APP}")
    print("できました。アプリを開いて確かめてください。だめなら --rollback")


if __name__ == "__main__":
    main()
