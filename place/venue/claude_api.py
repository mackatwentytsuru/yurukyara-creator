"""Anthropic の Messages API を 1 回呼ぶだけの小さな部品(画像つき)。キーは環境変数から読み、表示しない。"""
from __future__ import annotations

import base64
import io
import json
import os
import sys

import requests
from PIL import Image

API = "https://api.anthropic.com/v1/messages"


def get_key():
    for name in ("CLAUDE_CREDIT_API_KEY_2", "CLAUDE_CREDIT_API_KEY"):
        v = os.environ.get(name)
        if v:
            return v, name
    sys.exit("API キーの環境変数が無い(CLAUDE_CREDIT_API_KEY_2 / CLAUDE_CREDIT_API_KEY)")


def jpeg_b64(img: Image.Image, max_w: int = 1400, quality: int = 85) -> str:
    im = img.convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, int(im.height * max_w / im.width)))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode()


def image_block(img: Image.Image, max_w: int = 1400):
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": jpeg_b64(img, max_w)}}


def call(model: str, key: str, content: list, max_tokens: int = 3000):
    """返り値: (文章, 使った量)。失敗は例外。"""
    body = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": content}]}
    r = requests.post(API, headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                      json=body, timeout=180)
    if r.status_code != 200:
        raise RuntimeError(f"API {r.status_code}: {r.text[:300]}")
    j = r.json()
    text = "".join(b.get("text", "") for b in j["content"] if b["type"] == "text").strip()
    return text, j.get("usage", {})


def parse_json(text: str):
    return json.loads(text[text.find("{"): text.rfind("}") + 1])
