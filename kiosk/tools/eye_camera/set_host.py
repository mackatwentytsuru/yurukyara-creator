"""カメラのアドレスだけを直す(現地の Wi-Fi につなぎ直すと、アドレスが変わるため)。ユーザー名・パスワードは触らない・表示しない。
  python set_host.py            アドレスを聞かれる(Tapo アプリの 機器の設定 → 端末情報)
  python set_host.py 192.168.x.y
"""
import json
import sys

import camera_config

path = camera_config.SECRETS_FILE
if not path.exists():
    raise SystemExit("設定ファイルがありません。先に setup_secrets.py を実行してください")
cfg = json.loads(path.read_text(encoding="utf-8"))
host = (sys.argv[1] if len(sys.argv) > 1 else input("カメラの新しいアドレス: ")).strip()
if not host:
    raise SystemExit("空です。変えませんでした")
cfg["host"] = host
path.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
print("アドレスだけを更新しました")
