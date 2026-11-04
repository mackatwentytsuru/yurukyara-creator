"""カメラの接続設定を、本人が自分の端末で入力して保存する(kiosk/.secrets/tapo.json。git に入らない)。
  python kiosk/tools/eye_camera/setup_secrets.py
パスワードは画面に出ず(getpass)、チャット・ログ・課題には書かない。AI はこのファイルの中身を読まない。"""
import getpass
import json
import os
import stat

import camera_config

host = input("カメラのアドレス(Tapo アプリの 機器の設定 → 端末情報 の IP): ").strip()
user = input("カメラのアカウントのユーザー名(Tapo のアカウントとは別): ").strip()
password = getpass.getpass("カメラのアカウントのパスワード(入力は見えません): ")
if not (host and user and password):
    raise SystemExit("空の項目があります。保存しませんでした")
path = camera_config.SECRETS_FILE
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({"host": host, "user": user, "password": password}, ensure_ascii=False), encoding="utf-8")
try:
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
except OSError:
    pass
print("保存しました。次: python kiosk/tools/eye_camera/run_eye.py --seconds 10")
