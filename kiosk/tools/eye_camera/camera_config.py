"""見守りカメラ(TP-Link Tapo C200)の接続設定。パスワード・アドレスは、環境変数か git に入らないファイルから読む。
  環境変数: TAPO_HOST / TAPO_USER / TAPO_PASS(カメラのアカウント。Tapo のアカウントとは別)
  ファイル: kiosk/.secrets/tapo.json  {"host": "...", "user": "...", "password": "..."}(.gitignore 済み)
画面・ログ・課題に、アドレス・ユーザー・パスワードを出さない(出すときは mask() を通す)。
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import quote

SECRETS_FILE = Path(__file__).resolve().parents[2] / ".secrets" / "tapo.json"
DEFAULTS = {"rtsp_port": 554, "onvif_port": 2020, "stream": "stream1"}


class ConfigError(RuntimeError):
    pass


def load(env=None, file: Path | None = None) -> dict:
    env = os.environ if env is None else env
    file = SECRETS_FILE if file is None else file
    cfg = dict(DEFAULTS)
    if file.exists():
        try:
            cfg.update({k: v for k, v in json.loads(file.read_text(encoding="utf-8")).items() if v not in (None, "")})
        except (OSError, ValueError) as e:
            raise ConfigError(f"設定ファイルを読めません({type(e).__name__})") from None
    for key, name in (("host", "TAPO_HOST"), ("user", "TAPO_USER"), ("password", "TAPO_PASS")):
        if env.get(name):
            cfg[key] = env[name]
    missing = [k for k in ("host", "user", "password") if not cfg.get(k)]
    if missing:
        raise ConfigError("カメラの設定が足りません: " + ", ".join(missing) + "(環境変数 TAPO_HOST/TAPO_USER/TAPO_PASS か、kiosk/.secrets/tapo.json)")
    return cfg


def rtsp_url(cfg: dict, stream: str | None = None) -> str:
    """ffmpeg に渡す URL。パスワードを含むので、画面・ログへ出さない"""
    return f"rtsp://{quote(cfg['user'], safe='')}:{quote(cfg['password'], safe='')}@{cfg['host']}:{cfg['rtsp_port']}/{stream or cfg['stream']}"


def mask(text: str, cfg: dict | None) -> str:
    """文の中の、アドレス・ユーザー・パスワード(と、その URL 符号化)を伏せる"""
    if not cfg:
        return text
    for key in ("password", "user", "host"):
        v = cfg.get(key)
        if v:
            for form in {str(v), quote(str(v), safe="")}:
                text = text.replace(form, "***")
    return text
