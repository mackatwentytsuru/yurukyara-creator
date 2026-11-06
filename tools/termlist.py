"""語の一覧(リポジトリに入れない .local.txt)を読む共通の部品。フックの tools/hooks/lib/secret-core.mjs と同じ形。

1 行 1 つ。# で始まる行は注。
  既定        大文字と小文字を区別しない、文字そのもの
  cs:<語>     区別する、文字そのもの(英語のふつうの語と重なる物)
  re:<式>     区別する正規表現
  rei:<式>    区別しない正規表現
正規表現の \\b は英数字と _ だけを語の文字とみなす(日本語の隣でも語の切れ目になる。JavaScript・git filter-repo と同じ)。
使う所: tools/prepush_check.py・tools/history_check.py・tools/rewrite_history.py。
"""
import re


def compile_term(line):
    """1 行を正規表現にする。読めない正規表現は re.error"""
    if line.startswith("rei:"):
        return re.compile(line[4:], re.I | re.ASCII)
    if line.startswith("re:"):
        return re.compile(line[3:], re.ASCII)
    if line.startswith("cs:"):
        return re.compile(re.escape(line[3:]))
    return re.compile(re.escape(line), re.I)


def read_lines(path):
    with open(path, encoding="utf-8") as f:
        return [t.strip() for t in f if t.strip() and not t.lstrip().startswith("#")]


def load(path):
    """[(行, 正規表現)] を返す。ファイルが無ければ OSError。読めない正規表現は ValueError(何行目かだけを出す。語は出さない)"""
    out = []
    for i, line in enumerate(read_lines(path), 1):
        try:
            out.append((line, compile_term(line)))
        except re.error as e:
            raise ValueError(f"語の一覧の {i} 行目(注を除く)が正規表現として読めません: {e.msg}") from None
    return out


def first_hit(pats, text):
    """最初に当たった語の match。当たらなければ None"""
    for _, rx in pats:
        m = rx.search(text)
        if m:
            return m
    return None
