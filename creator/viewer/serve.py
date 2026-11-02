"""確かめ用の簡単なサーバー(キャッシュなし)。リポジトリの根を配る。

使い方: python creator/viewer/serve.py [ポート] [--mount=/trial=<フォルダ>]   → http://127.0.0.1:8777/creator/viewer/index.html?c=../../characters/f_led/character.json
"""
import http.server
import os
import sys


MOUNTS = {}   # URL の頭 → 実際のフォルダ(--mount /名前=フォルダ)。リポジトリの外の試しのキャラを見るため


class NoCache(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        for prefix, folder in MOUNTS.items():
            if path.startswith(prefix + "/"):
                return super().translate_path(path[len(prefix):]).replace(os.getcwd(), folder, 1)
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    os.chdir(root)
    args = [a for a in sys.argv[1:] if not a.startswith("--mount")]
    for a in sys.argv[1:]:
        if a.startswith("--mount"):
            k, v = a.split("=", 1)[1].split("=", 1) if a.count("=") > 1 else (None, None)
            if k:
                MOUNTS[k] = os.path.abspath(v)
    port = int(args[0]) if args else 8777
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
