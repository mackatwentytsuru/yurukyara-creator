"""確かめ用の簡単なサーバー(キャッシュなし)。リポジトリの根を配る。

使い方: python creator/viewer/serve.py [ポート]   → http://127.0.0.1:8777/creator/viewer/index.html?c=../../characters/f_led/character.json
"""
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    os.chdir(root)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
