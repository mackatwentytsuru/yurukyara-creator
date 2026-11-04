"""日本語の字が出る太字のフォントの場所を返す(一覧の絵の見出しに使う)。Windows・macOS・Linux で探す。
どれも無ければ、PIL が名前で探せる DejaVuSans.ttf を返す(日本語は四角になるが、止まらない)。"""
import os

CANDIDATES = [
    r"C:\Windows\Fonts\meiryob.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
]


def find_font():
    return next((p for p in CANDIDATES if os.path.exists(p)), "DejaVuSans.ttf")
