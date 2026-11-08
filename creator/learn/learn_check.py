#!/usr/bin/env python3
"""yuru-learn の点検・差分・反映の道具(Python の標準の物だけ)。

お店・駅・町の人が渡した資料(ホームページ・PDF・地図の写真など)から Claude が読み取った「本当のこと」を、
characters/<id>/persona.md の 2 つの節(「## お店のきまり」「## 町のお知らせ」)に入れるときの、決まった点検と反映。
読み取りは Claude の側(スキル yuru-learn)。ここは「入れてよい形か」を決める所だけ(Claude を呼ばない)。

使い方:
  python creator/learn/learn_check.py check <ファイル> [--proposal] [--today YYYY-MM-DD]
  python creator/learn/learn_check.py diff  <id> <案のファイル> [--role "駅や町の案内"]
  python creator/learn/learn_check.py apply <id> <案のファイル> [--role "駅や町の案内"] --yes
  python creator/learn/learn_check.py undo  <id>
  python creator/learn/learn_check.py list  <id>

  check  : 字数・個人のこと・推測・指示めいた行・出典と日付を点検する。--proposal は「案」の形(2 つの節だけ)で見る。
  diff   : いまの persona.md と、案を入れた後の違いを出す(書き換えない)。
  apply  : 点検が通った案だけを入れる。入れる前の persona.md を creator/work/<id>/learn/ に控える。--yes が無ければ入れない
           (人の OK を聞いた後に付ける)。2 つの節の外は 1 字も変えない。案に無い節は、そのまま残す。
           案の中で中身が空の節は、その節を消す意味になる(空の見出しだけは残さない)。
  --role <言葉>: 「- 役目: …」の行も変える(差分に出る。undo で、節と一緒に戻る)。おうち・お店の案内・駅や町の案内・学校や施設。
  --root <場所>: リポジトリの代わりの場所(試しのとき。<場所>/characters/<id>/persona.md を見る)。サブコマンドの前に書く。
  undo   : いちばん新しい前の版に戻す。--yes が無ければ戻さず、何が変わるかを見せる(聞いてから --yes で流す)。
           使った前の版は .restored.md として残し(消さない)、いまの版は .undone.md に残す。
  list   : いま入っている物の出どころと、読んだ日からの日数。
終わりの番号: 0 できた / 2 使い方・ファイルの誤り / 3 点検で止めた / 4 --yes が無いので入れなかった・戻さなかった。
"""
import argparse
import datetime
import difflib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---- 決まり(web/src/conversation/facts.js と同じ見出し・字数の考え) ----
FACT_HEADINGS = ("お店のきまり", "町のお知らせ")
SERVER_MAX = 2000  # サーバーが事実として受ける全部の字数(画面の欄と合わせて)
MAX_TOTAL = 1600  # この道具が入れてよい字数(画面の欄の分を残す)
WARN_TOTAL = 1300
MAX_ITEM = 110  # 1 つの事実(出典と日付を含む)
MAX_ITEMS = 30
MAX_SOURCE = 30
# 役目の言葉(web/src/conversation/role.js の ROLE_LABELS と同じ。人格の文の「- 役目:」の行に書く)
ROLE_LABELS = ("おうち", "お店の案内", "駅や町の案内", "学校や施設")
ROLE_LINE = re.compile(r"^\s*(?:[-*・]\s*)?役目\s*[::]")

HEADING = re.compile(r"^#{1,6}\s*(.*)$")
BULLET = re.compile(r"^(?:[-*・]\s*)")
MARKER = re.compile(r"^【[^】]{1,24}】$")  # 道案内などの見出しの行(出典は要らない。中身の行が続く)
SOURCE = re.compile(r"[(（]出典[::]\s*([^()（）]+?)\s*[・/／]\s*(\d{4}-\d{2}-\d{2})\s*[)）]\s*$")

# ---- 個人のこと ----
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
GENERIC_MAIL = {"info", "contact", "support", "inquiry", "office", "mail", "webmaster", "reserve", "reservation"}
DASH = "-ー‐－−"
MOBILE = re.compile(rf"(?<!\d)0[789]0[{DASH} ]?\d{{4}}[{DASH} ]?\d{{4}}(?!\d)")
PHONE = re.compile(rf"(?<!\d)(?:0\d{{1,4}}[{DASH} \u3000]\d{{1,4}}[{DASH} \u3000]\d{{3,4}}|0\d{{9,10}})(?!\d)")
ADDRESS = re.compile(rf"(〒|\d{{3}}[{DASH}]\d{{4}}|丁目|番地)")
CARD = re.compile(r"(?<!\d)(?:\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|\d{12})(?!\d)")
SECRET_WORDS = re.compile(r"(パスワード|暗証番号|マイナンバー|口座番号|カード番号|生年月日|本名)")
HONORIFIC = re.compile(r"([一-龥々]{2,4}|[ァ-ヶー]{3,6})(さん|様|氏)")
NAME_OK_ENDS = ("員", "手", "客", "係", "者", "人", "長", "主", "生", "皆", "方")
NAME_OK = {"家族", "お客", "みな", "皆", "みんな", "お子", "子ども", "こども", "お年寄り", "ご家族", "店", "町", "駅", "旅行", "観光", "ご利用", "ご来店", "どなた", "みなさ"}
CONTACT_LABELS = ("連絡先", "問い合わせ", "問合せ")
PLACE_LABELS = ("連絡先", "問い合わせ", "問合せ", "場所", "住所")

# ---- 推測・指示めいた言い方 ----
HEDGE = re.compile(r"(たぶん|多分|おそらく|恐らく|かもしれ|と思われ|思います|らしい|だろう|でしょう|ようです|ようだ|はずです|気がする|[?？])")
# 資料の中の「AI への頼み・指示」に見える言い方。語の単独(システム・これまでの)では止めず、組み合わせで止める
INJECT = re.compile(
    r"(無視|忘れて|命令|プロンプト|"
    r"指示(に従え|に従いなさい|を(無視|忘れ|変え|変更|書き換|書きか|上書き|リセット|守らな))|"
    r"(この|上の|上記の|前の|以前の|これまでの|次の|新しい|別の|先の)(指示|命令)|"
    r"システム(の|を|へ)?(決まり|指示|命令|設定|ルール|プロンプト|メッセージ)|"
    r"(AI|ＡＩ|アシスタント|ボット|キャラクター|読んでいる方|読む方)(へ|に|は|の方)|あなたは|"
    r"(答え|返事|回答|宣伝|紹介)(て|する)(ください|こと|なさい)|安全の決まり|恋人|独り占め|引きとめ|ひとりじめ)"
)
# 英語・中国語・韓国語の言い方(「Don't forget your ticket」のような、ふつうの掲示は止めない形にしてある)
INJECT_OTHER = re.compile(
    r"(\b(ignore|disregard|override|bypass|jailbreak)\b|"
    r"\bforget (all|everything|previous|prior|the (rules?|instructions?)|your (rules?|instructions?|prompt|role|persona|guidelines?))|"
    r"\b(previous|prior|above|earlier) (instructions?|prompts?|rules?)\b|"
    r"\b(system|developer) (prompt|message|instructions?)\b|"
    r"\byour (rules?|instructions?|prompt|role|persona|guidelines?)\b|"
    r"\byou are (now|a|an|the|no longer)\b|\byou (must|shall|should|will) (only|always|never|now)\b|"
    r"\bact as\b|\bpretend\b|\bfrom now on\b|\bnew (instructions?|rules?|role)\b|"
    r"\bonly (talk|speak|answer|reply|say)\b|\balways (recommend|promote|advertise|mention|say|answer|reply)\b|"
    r"\bdeveloper mode\b|\bas an ai\b|"
    r"(忽略|无视|忽視|忘记|忘記)(以上|之前|前面|上面|所有|你的)|지시.{0,4}무시|이전 지시)",
    re.IGNORECASE,
)
# キャラや来た人の振る舞い・答え方を決める行(事実ではない。命令に見えない形の命令)
BEHAVIOR = re.compile(
    r"((どの|すべての|全ての|あらゆる)(質問|問い合わせ|問いかけ)|"
    r"(いつも|必ず|常に|毎回)[^。]{0,16}(答え|言う|言って|言え|すすめ|勧め|紹介し|宣伝|名乗|返事|話し)|"
    r"[0-9０-９一二三四五六七八九十]+回(言|くり返|繰り返|唱|名乗|呼)|"
    r"(だけ|のみ)(を)?(すすめ|勧め|紹介|宣伝|話)|(すすめ|勧め|宣伝)(る|て)?(こと|ように|べき|なさい))"
)
# 行事の終わる日。「(〜2026-11-23)」の形で、行の出典の前に付ける
DEADLINE = re.compile(r"[(（]〜(\d{4}-\d{2}-\d{2})[)）]")
DATE_WORD = re.compile(r"\d{1,2}月\d{1,2}日")
URL = re.compile(r"(https?://|www\.)", re.IGNORECASE)
TAG = re.compile(r"</?[A-Za-z][^>]{0,40}>")
HIDDEN = re.compile("[​-‏⁠﻿‪-‮  ⁦-⁩]")


class Problem:
    def __init__(self, level, where, message):
        self.level, self.where, self.message = level, where, message

    def __str__(self):
        return f"[{self.level}] {self.where}: {self.message}"


def read_text(path):
    with open(path, "rb") as f:
        raw = f.read()
    return raw.decode("utf-8-sig")


def split_lines(text):
    return re.split(r"\r\n|\r|\n", text)


def heading_name(line):
    """見出しの行が事実の見出しなら、その名前(お店のきまり・町のお知らせ)。違えば None"""
    m = HEADING.match(line.strip())
    if not m:
        return None
    t = m.group(1).strip()
    for h in FACT_HEADINGS:
        if t.startswith(h):
            return h
    return None


def parse_blocks(text):
    """見出しごとの塊に分ける。[(見出しの行 か None, 事実の名前 か None, [行…])]。最初の塊は見出し前(見出しの行は None)"""
    blocks = [[None, None, []]]
    for line in split_lines(text):
        if HEADING.match(line.strip()):
            blocks.append([line, heading_name(line), []])
        else:
            blocks[-1][2].append(line)
    return blocks


def fact_sections(text):
    """{名前: [行(行頭の記号を外し、空行を除いた物)]}。節が無ければ空"""
    out = {}
    for _, name, lines in parse_blocks(text):
        if not name:
            continue
        rows = out.setdefault(name, [])
        for raw in lines:
            t = re.sub(r"\s+", " ", BULLET.sub("", raw.strip())).strip()
            if t:
                rows.append(t)
    return out


def strip_source(line):
    m = SOURCE.search(line)
    if not m:
        return line, None, None
    return line[: m.start()].rstrip(), m.group(1).strip(), m.group(2)


def is_labelled(line, labels):
    return line.startswith(labels)


def check_line(where, line, today, problems, strict=True):
    if MARKER.match(line):
        # 見出しの行(【…】)も、命令・URL・タグ・見えない文字は止める(出典は要らない)
        if HIDDEN.search(line) or TAG.search(line) or URL.search(line) or INJECT.search(line) or INJECT_OTHER.search(line) or BEHAVIOR.search(line):
            problems.append(Problem("止める", where, "見出しの行に、命令・URL・タグ・見えない文字は書きません: " + line[:30]))
        return
    body, source, date = strip_source(line)
    if source is None:
        problems.append(Problem("止める", where, "出典と読んだ日がありません。行の終わりに「(出典: 名前・YYYY-MM-DD)」を付けます: " + line[:30]))
    else:
        if len(source) > MAX_SOURCE:
            problems.append(Problem("止める", where, f"出典の名前が長すぎます({MAX_SOURCE} 字まで。URL ではなく、ページや紙の名前で書く)"))
        if URL.search(source):
            problems.append(Problem("止める", where, "出典に URL は書きません。ページや紙の名前で書きます"))
        try:
            d = datetime.date.fromisoformat(date)
            if d > today:
                problems.append(Problem("止める", where, f"読んだ日 {date} が今日より先です"))
        except ValueError:
            problems.append(Problem("止める", where, f"読んだ日 {date} が日付として読めません"))
    if len(line) > MAX_ITEM:
        problems.append(Problem("止める", where, f"1 つの事実は {MAX_ITEM} 字までです({len(line)} 字)。2 つに分けます"))
    if len(body) < 4:
        problems.append(Problem("止める", where, "事実の文が短すぎます(中身がありません)"))
    if HIDDEN.search(line):
        problems.append(Problem("止める", where, "見えない文字(向きを変える文字・幅ゼロの文字)が入っています"))
    if TAG.search(line):
        problems.append(Problem("止める", where, "HTML のタグが入っています。文字だけにします"))
    if URL.search(body):
        problems.append(Problem("止める", where, "URL は覚えさせません(声で読めません)。名前で書きます"))
    if INJECT.search(body) or INJECT_OTHER.search(body) or INJECT.search(source or "") or INJECT_OTHER.search(source or ""):
        problems.append(Problem("止める", where, "資料の中の「AI への頼み・指示」に見える言い方です。事実だけを書き、命令は入れません"))
    if BEHAVIOR.search(body):
        problems.append(Problem("止める", where, "キャラや来た人の振る舞い・答え方を決める行は、事実ではありません。事実だけを書きます"))
    check_deadline(where, body, today, problems, strict)
    if HEDGE.search(body):
        problems.append(Problem("止める", where, "推測・疑問の言い方です(たぶん・かもしれない・?など)。資料にはっきり書いてあることだけを書きます"))
    check_personal(where, line, body, problems)


def deadline_of(body):
    """行の「(〜YYYY-MM-DD)」の日付。無ければ None。日付として読めない時は ValueError"""
    m = DEADLINE.search(body)
    return datetime.date.fromisoformat(m.group(1)) if m else None


def check_deadline(where, body, today, problems, strict):
    try:
        d = deadline_of(body)
    except ValueError:
        problems.append(Problem("止める", where, "行事の終わる日 (〜…) が日付として読めません"))
        return
    if d is not None:
        if d < today:
            # 案では止める(終わった行事は入れない)。すでに入っている物は、止めずに知らせる(ほかの行を入れられなくしない)
            level = "止める" if strict else "注意"
            problems.append(Problem(level, where, f"終わった行事です(〜{d.isoformat()})。入れません。入っている時は消します"))
    elif DATE_WORD.search(body):
        problems.append(Problem("注意", where, "月日のある行です。行事なら、終わる日を「(〜YYYY-MM-DD)」で、出典の前に付けます(年の分からない行事は本人に聞く)"))


def check_personal(where, line, body, problems):
    if MOBILE.search(body):
        problems.append(Problem("止める", where, "携帯電話の番号らしい数字があります(個人のこと)"))
    if PHONE.search(body) and not is_labelled(body, CONTACT_LABELS):
        problems.append(Problem("止める", where, "電話番号は、行の頭が「連絡先」の行(お店・窓口の公の連絡先)だけに書きます"))
    for m in EMAIL.finditer(body):
        local = m.group(0).split("@")[0].lower()
        if not (is_labelled(body, CONTACT_LABELS) and local in GENERIC_MAIL):
            problems.append(Problem("止める", where, "メールアドレスは、行の頭が「連絡先」で、窓口用(info など)の物だけです"))
            break
    if ADDRESS.search(body) and not is_labelled(body, PLACE_LABELS):
        problems.append(Problem("止める", where, "住所の形(〒・丁目・番地)は、行の頭が「場所」「住所」「連絡先」の行だけに書きます"))
    if CARD.search(body):
        problems.append(Problem("止める", where, "カードや番号らしい長い数字があります(個人のこと)"))
    if SECRET_WORDS.search(body):
        problems.append(Problem("止める", where, "パスワード・暗証番号・生年月日・本名など、個人のことに当たる言葉があります"))
    for m in HONORIFIC.finditer(body):
        name = m.group(1)
        if name in NAME_OK or name.endswith(NAME_OK_ENDS) or any(name.startswith(p) for p in ("お", "ご")):
            continue
        problems.append(Problem("止める", where, f"人の名前らしい言葉「{m.group(0)}」があります。人の名前は覚えさせません(役割の名前で書く)"))
        break


def check_text(text, proposal=False, today=None):
    """(problems, info)。info = {total, items, sections: {名前: 行の数}}"""
    today = today or datetime.date.today()
    problems = []
    blocks = parse_blocks(text)
    if proposal:
        head = [b for b in blocks[0][2] if b.strip()]
        if head:
            problems.append(Problem("止める", "案", "案には、2 つの節(「## お店のきまり」「## 町のお知らせ」)以外の文を書きません"))
        for line, name, _ in blocks[1:]:
            if name is None:
                problems.append(Problem("止める", "案", f"事実の節ではない見出しがあります: {line.strip()[:30]}"))
    seen = {}
    total = 0
    items = 0
    counts = {}
    for line_no_block, (hline, name, lines) in enumerate(blocks):
        if not name:
            continue
        rows = [re.sub(r"\s+", " ", BULLET.sub("", r.strip())).strip() for r in lines]
        rows = [r for r in rows if r]
        counts[name] = counts.get(name, 0) + len(rows)
        for i, r in enumerate(rows):
            where = f"{name} {i + 1} 行目"
            if MARKER.match(r):
                nxt = rows[i + 1] if i + 1 < len(rows) else None
                if nxt is None or MARKER.match(nxt):
                    problems.append(Problem("止める", where, f"見出しの行 {r} の下に、中身の行がありません"))
            else:
                items += 1
            check_line(where, r, today, problems, strict=proposal)
            body, _, _ = strip_source(r)
            if not MARKER.match(r):
                if body in seen:
                    problems.append(Problem("止める", where, f"{seen[body]} と同じ事実です"))
                seen.setdefault(body, where)
            total += len(r)
    if items == 0:
        problems.append(Problem("止める", "全体", "事実が 1 つもありません"))
    if items > MAX_ITEMS:
        problems.append(Problem("止める", "全体", f"事実が多すぎます({items} 個。{MAX_ITEMS} 個まで)。来た人がよく聞くことを残します"))
    if total > MAX_TOTAL:
        problems.append(Problem("止める", "全体", f"全部で {total} 字です({MAX_TOTAL} 字まで。サーバーは {SERVER_MAX} 字までしか読みません)。短くするか、減らします"))
    elif total > WARN_TOTAL:
        problems.append(Problem("注意", "全体", f"全部で {total} 字です({MAX_TOTAL} 字まで)。もうすぐいっぱいです"))
    return problems, {"total": total, "items": items, "sections": counts}


def format_report(problems, info):
    stops = [p for p in problems if p.level == "止める"]
    lines = [str(p) for p in problems]
    sec = "・".join(f"{k} {v} 行" for k, v in info["sections"].items()) or "節なし"
    lines.append(f"事実 {info['items']} 個・全部で {info['total']} 字({MAX_TOTAL} 字まで)・{sec}")
    lines.append("点検: 止めます" if stops else "点検: 通りました")
    return "\n".join(lines), bool(stops)


# ---- 反映 ----
def render_section(name, rows):
    return [f"## {name}"] + [f"- {r}" for r in rows]


def _flatten(blocks):
    out = []
    for hline, _, lines in blocks:
        if hline is not None:
            out.append(hline)
        out.extend(lines)
    return out


def set_role_line(text, role):
    """persona.md の「- 役目: …」の 1 行を role にする(無ければ、最初の見出しの塊の終わりに足す)。事実の節の中は見ない。ほかは 1 字も変えない"""
    nl = "\r\n" if "\r\n" in text else "\n"
    blocks = parse_blocks(text)
    new_line = f"- 役目: {role}"
    for b in blocks:
        if b[1]:
            continue
        for j, line in enumerate(b[2]):
            if ROLE_LINE.match(line):
                b[2][j] = new_line
                return nl.join(_flatten(blocks))
    for b in blocks:
        if b[0] is not None and not b[1]:  # 最初の事実でない見出しの塊の、最後の中身の行のあと
            at = max((j for j, line in enumerate(b[2]) if line.strip()), default=-1) + 1
            b[2].insert(at, new_line)
            return nl.join(_flatten(blocks))
    return nl.join([new_line, *_flatten(blocks)])


def build_new_text(persona_text, proposal_text, role=None):
    """persona.md の 2 つの節だけを、案で置き換えた文を返す(role があれば「- 役目:」の 1 行も)。案に無い節・節の外は 1 字も変えない(改行の形も保つ)"""
    nl = "\r\n" if "\r\n" in persona_text else "\n"
    prop = fact_sections(proposal_text)
    blocks = parse_blocks(persona_text)
    out = []
    done = set()
    for i, (hline, name, lines) in enumerate(blocks):
        if name and name in prop:
            if name in done:  # 同じ節が 2 回あれば、2 つ目は消す(案が全部を言う)
                continue
            done.add(name)
            if not prop[name]:  # 案の節が空 = その節を消す(空の見出しだけを残さない)
                continue
            new = render_section(name, prop[name])
            has_next = any(True for _ in blocks[i + 1:])
            out.extend(new + ([""] if has_next else []))
            continue
        if hline is not None:
            out.append(hline)
        out.extend(lines)
    missing = [n for n in FACT_HEADINGS if prop.get(n) and n not in done]
    if missing:
        while out and not out[-1].strip():
            out.pop()
        for n in missing:
            out.extend([""] + render_section(n, prop[n]))
        out.append("")
    text = nl.join(out)
    if not text.endswith(nl):
        text += nl
    if role:
        text = set_role_line(text, role)
    return text


def persona_path(root, ident):
    if not re.fullmatch(r"[a-z0-9_]+", ident):
        raise SystemExit("id は英小文字・数字・_ だけです")
    return os.path.join(root, "characters", ident, "persona.md")


def work_dir(root, ident):
    return os.path.join(root, "creator", "work", ident, "learn")


def readable_place(root, path, ident=None):
    """読んでよい場所か。check は characters/ と creator/work/<id>/learn/、diff・apply の案は creator/work/<その id>/learn/ だけ
    (資料の中の命令で、リポジトリの外や鍵のファイルを読ませないため)"""
    real = os.path.realpath(path)
    work = os.path.realpath(os.path.join(root, "creator", "work"))
    places = []
    if ident is None:
        places.append(os.path.realpath(os.path.join(root, "characters")))
        rel = os.path.relpath(real, work) if os.path.splitdrive(real)[0].lower() == os.path.splitdrive(work)[0].lower() else ".."
        parts = rel.replace("\\", "/").split("/")
        if len(parts) >= 3 and parts[0] not in ("..", ".") and parts[1] == "learn":
            return True
    else:
        places.append(os.path.realpath(work_dir(root, ident)))
    for base in places:
        try:
            if os.path.commonpath([real, base]) == base:
                return True
        except ValueError:  # ドライブが違う
            pass
    return False


def cmd_check(a):
    if not readable_place(a.root, a.file):
        print("読みません: 点検できるのは characters/ と creator/work/<id>/learn/ の中のファイルだけです。")
        return 2
    try:
        text = read_text(a.file)
    except OSError as e:
        print(f"読めません: {e}")
        return 2
    problems, info = check_text(text, proposal=a.proposal, today=parse_today(a.today))
    report, bad = format_report(problems, info)
    print(report)
    return 3 if bad else 0


def parse_today(s):
    return datetime.date.fromisoformat(s) if s else datetime.date.today()


def load_pair(a):
    pp = persona_path(a.root, a.id)
    if not readable_place(a.root, a.proposal, a.id):
        print(f"読みません: 案は creator/work/{a.id}/learn/ の中に置きます。")
        return None
    try:
        persona = read_text(pp)
        proposal = read_text(a.proposal)
    except OSError as e:
        print(f"読めません: {e}")
        return None
    return pp, persona, proposal


def diff_lines(old, new):
    a_ = split_lines(old)
    b_ = split_lines(new)
    return list(difflib.unified_diff(a_, b_, "いまの persona.md", "入れた後", lineterm="", n=1))


def show_diff_line(line):
    """差分の行を、行頭の「- 」と紛れない形で見せる(足す = ＋、消す = －)"""
    if line.startswith(("+++", "---", "@@")):
        return line
    if line.startswith("+"):
        return "＋ " + line[1:]
    if line.startswith("-"):
        return "－ " + line[1:]
    return "  " + line[1:] if line.startswith(" ") else line


def summarize(diff):
    add = sum(1 for d in diff if d.startswith("+") and not d.startswith("+++"))
    rem = sum(1 for d in diff if d.startswith("-") and not d.startswith("---"))
    return add, rem


def role_ok(a):
    if a.role is not None and a.role not in ROLE_LABELS:
        print("--role は、次の言葉のどれかです: " + "・".join(ROLE_LABELS))
        return False
    return True


def cmd_diff(a):
    if not role_ok(a):
        return 2
    got = load_pair(a)
    if not got:
        return 2
    _, persona, proposal = got
    problems, info = check_text(proposal, proposal=True, today=parse_today(a.today))
    report, bad = format_report(problems, info)
    new = build_new_text(persona, proposal, a.role)
    d = diff_lines(persona, new)
    if not d:
        print("いまと同じです。変える所はありません。")
    else:
        print("\n".join(show_diff_line(x) for x in d))
        add, rem = summarize(d)
        print(f"足す {add} 行・消す {rem} 行(2 つの節の中だけ)")
    print(report)
    return 3 if bad else 0


def cmd_apply(a):
    if not role_ok(a):
        return 2
    got = load_pair(a)
    if not got:
        return 2
    pp, persona, proposal = got
    problems, info = check_text(proposal, proposal=True, today=parse_today(a.today))
    report, bad = format_report(problems, info)
    if bad:
        print(report)
        print("入れませんでした(点検で止めました)。")
        return 3
    new = build_new_text(persona, proposal, a.role)
    if new == persona:
        print("いまと同じです。入れる物はありません。")
        return 0
    if not a.yes:
        print("入れませんでした。人の OK を聞いた後に --yes を付けて、もう一度流します。")
        return 4
    # 入れた後の persona.md も、もう一度点検する(節の外の文には触れない)
    after_problems, _ = check_text(new, today=parse_today(a.today))
    if any(p.level == "止める" for p in after_problems):
        print("入れた後の形が点検を通りませんでした。入れませんでした。")
        print("\n".join(str(p) for p in after_problems))
        return 3
    wd = work_dir(a.root, a.id)
    os.makedirs(wd, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = os.path.join(wd, f"persona.{stamp}.bak.md")
    with open(bak, "wb") as f:
        f.write(persona.encode("utf-8"))
    with open(os.path.join(wd, "last_proposal.md"), "wb") as f:
        f.write(proposal.encode("utf-8"))
    with open(pp, "wb") as f:
        f.write(new.encode("utf-8"))
    print(report)
    print(f"入れました: characters/{a.id}/persona.md")
    print(f"入れる前の版: creator/work/{a.id}/learn/{os.path.basename(bak)}(元に戻す: undo)")
    return 0


def outside_facts(text):
    """2 つの事実の節と「- 役目:」の行を除いた、残りの中身の行(空行と行の両端の空白は見ない)"""
    out = []
    for hline, name, lines in parse_blocks(text):
        if name:
            continue
        if hline is not None:
            out.append(hline.strip())
        out.extend(t.strip() for t in lines if t.strip() and not ROLE_LINE.match(t))
    return out


def roles_of(text):
    """節の外の「- 役目:」の行の言葉を、全部"""
    out = []
    for _, name, lines in parse_blocks(text):
        if name:
            continue
        out.extend(ROLE_LINE.sub("", t, count=1).strip() for t in lines if ROLE_LINE.match(t))
    return out


def odd_fact_headings(text):
    """事実の節と読まれるのに、決まった形(「## お店のきまり」「## 町のお知らせ」)ちょうどではない見出し"""
    return [h.strip() for h, name, _ in parse_blocks(text) if name and h.strip() not in ("## " + n for n in FACT_HEADINGS)]


def backup_problems(backup, current, today):
    """控えを戻してよいか。apply が作る控えは、いまの persona.md と「2 つの節と役目の行」だけが違う。
    それ以外が違う控え・点検を通らない節・決まりに無い役目は、偽の控えか、手で直した後なので戻さない。"""
    reasons = []
    if outside_facts(backup) != outside_facts(current):
        reasons.append("前の版は、2 つの節と役目の行のほかも、いまの persona.md と違います(覚えさせた時の前の版ではありません)")
    roles = roles_of(backup)
    if len(roles) > 1:
        reasons.append("前の版に「役目」の行が 2 つ以上あります")
    for role in roles:
        if role not in ROLE_LABELS:
            reasons.append(f"前の版の役目「{role[:20]}」は、決まった言葉ではありません")
    for h in odd_fact_headings(backup):
        reasons.append(f"前の版の見出し「{h[:30]}」は、決まった形ではありません")
    if HIDDEN.search(backup):
        reasons.append("前の版に見えない文字(向きを変える文字・幅ゼロの文字など)が入っています")
    problems, info = check_text(backup, today=today)
    for p in problems:
        if p.level != "止める":
            continue
        if info["items"] == 0 and p.where == "全体":
            continue  # 覚えさせる前の控え(事実がまだ無い)は、そのままでよい
        reasons.append(str(p))
    return reasons


def cmd_undo(a):
    wd = work_dir(a.root, a.id)
    baks = sorted(f for f in (os.listdir(wd) if os.path.isdir(wd) else []) if f.startswith("persona.") and f.endswith(".bak.md"))
    if not baks:
        print("戻す前の版がありません。")
        return 2
    latest = baks[-1]
    pp = persona_path(a.root, a.id)
    try:
        backup = read_text(os.path.join(wd, latest))
        current = read_text(pp)
    except (OSError, UnicodeDecodeError) as e:
        print(f"読めません: {e}")
        return 2
    reasons = backup_problems(backup, current, parse_today(getattr(a, "today", None)))
    if reasons:
        print(f"戻しませんでした: {latest} は点検を通りません。persona.md は変えていません。")
        print("\n".join(f"- {r}" for r in reasons[:10]))
        return 3
    # キャラの知っていることが変わるので、人に聞いてから(apply と同じ。--yes が無ければ戻さない)
    if not getattr(a, "yes", False):
        diff = list(difflib.unified_diff(current.splitlines(), backup.splitlines(), "いまの版", "戻した後の版", lineterm="", n=0))
        print("戻していません。次の版に戻すと、キャラの知っていることが、こう変わります(いまの版も残します)。")
        print("\n".join(diff[:40]) if diff else "(違いはありません)")
        print("人の OK を聞いた後に --yes を付けて、もう一度流します。")
        return 4
    # いまの版も残してから戻す(戻した物も、また戻せる)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    undone = os.path.join(wd, f"persona.{stamp}.undone.md")
    with open(undone, "wb") as f:
        f.write(current.encode("utf-8"))
    with open(os.path.join(wd, latest), "rb") as f:
        data = f.read()
    with open(pp, "wb") as f:
        f.write(data)
    used = os.path.join(wd, latest[: -len(".bak.md")] + ".restored.md")
    os.replace(os.path.join(wd, latest), used)  # 前の版は消さずに残す(次の undo では選ばれない)
    print(f"元に戻しました: {latest}(前の版は {os.path.basename(used)} として残しました)")
    print(f"戻す前の版: creator/work/{a.id}/learn/{os.path.basename(undone)}")
    return 0


def cmd_list(a):
    try:
        text = read_text(persona_path(a.root, a.id))
    except OSError as e:
        print(f"読めません: {e}")
        return 2
    today = parse_today(a.today)
    for line in split_lines(text):
        if ROLE_LINE.match(line):
            print(BULLET.sub("", line.strip()))
            break
    secs = fact_sections(text)
    if not secs:
        print("まだ何も覚えていません。")
        return 0
    stats = {}
    expired = []
    for name, rows in secs.items():
        for r in rows:
            if MARKER.match(r):
                continue
            try:
                dl = deadline_of(strip_source(r)[0])
            except ValueError:
                dl = None
            if dl is not None and dl < today:
                expired.append((dl, r))
            _, src, date = strip_source(r)
            key = (src or "出典なし", date or "-")
            stats[key] = stats.get(key, 0) + 1
    for (src, date), n in sorted(stats.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        days = ""
        try:
            days = f"({(today - datetime.date.fromisoformat(date)).days} 日前)"
        except ValueError:
            pass
        print(f"{src} / 読んだ日 {date} {days}: {n} 個")
    for dl, r in sorted(expired):
        print(f"期限切れ(〜{dl.isoformat()}): {strip_source(r)[0][:40]}  ← 消します(その出典の行を案から外して入れ直す)")
    return 0


def main(argv=None):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description="yuru-learn の点検・反映")
    p.add_argument("--root", default=ROOT, help=argparse.SUPPRESS)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("file")
    c.add_argument("--proposal", action="store_true")
    c.add_argument("--today")
    c.set_defaults(fn=cmd_check)
    for name, fn in (("diff", cmd_diff), ("apply", cmd_apply)):
        s = sub.add_parser(name)
        s.add_argument("id")
        s.add_argument("proposal")
        s.add_argument("--today")
        s.add_argument("--role", help="「- 役目:」の行も、この言葉にする(差分に出る)。" + "・".join(ROLE_LABELS))
        if name == "apply":
            s.add_argument("--yes", action="store_true")
        s.set_defaults(fn=fn)
    u = sub.add_parser("undo")
    u.add_argument("id")
    u.add_argument("--yes", action="store_true")
    u.set_defaults(fn=cmd_undo)
    ls = sub.add_parser("list")
    ls.add_argument("id")
    ls.add_argument("--today")
    ls.set_defaults(fn=cmd_list)
    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
