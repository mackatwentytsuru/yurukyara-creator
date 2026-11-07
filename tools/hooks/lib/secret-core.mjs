// 鍵と入れない語の見張りの判定(純粋な関数。フックと試験の両方が使う)。
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 鍵の形は tools/key_patterns.json の 1 つの表から読む(push の点検・履歴の点検と同じ表)。値は理由に出さない(伏せ字にする)
const KEY_TABLE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'key_patterns.json');
export const SECRET_PATTERNS = JSON.parse(readFileSync(KEY_TABLE, 'utf8')).patterns
  .filter((r) => !r.checks || r.checks.includes('hook'))
  .map((r) => [new RegExp(r.pattern, r.flags ?? ''), r.label]);

// 記録してはいけないファイルの名前
export function badPath(path) {
  const p = String(path ?? '').replace(/\\/g, '/');
  if (/(^|\/)\.env(?!\.(example|sample)$)(\.[\w-]+)?$/.test(p)) return '.env は記録しません(.env.example だけ)';
  if (/\.(pem|key|crt|p12)$/i.test(p)) return '鍵や証明書のファイルは記録しません';
  if (/\.vrm$/i.test(p)) return 'VRM はリポジトリに入れません';
  return '';
}

/** 語の一覧のファイル自身(と手元だけの一覧)は、語が入っていて当たり前なので見ない */
export const isTermsFile = (path) => /\.local\.txt$/i.test(basename(String(path ?? '')));

const isUp = (rel) => rel.split(/[\\/]/)[0] === '..';
const within = (base, target) => {
  const rel = relative(base, target);
  return rel === '' || (!isUp(rel) && !isAbsolute(rel));
};
/** まだ無いファイルでも、在る一番近い親の本当の場所(つなぎ・リンクを解いた場所)にして返す */
function realOf(p) {
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync.native(cur), relative(cur, p));
    } catch {
      const up = dirname(cur);
      if (up === cur) return p;
      cur = up;
    }
  }
}

/**
 * 書く先がリポジトリ(root)の中か。中の時だけ、書く文を見張る(板や作業メモなど、リポジトリの外は記録に入らないので見ない)。
 * 相対のパスは base(フックの入力の cwd。無ければ root)から見る。大文字と小文字・区切りの違いは path.relative に任せる
 * (Windows では区別しない)。字面の場所と本当の場所のどちらかが中なら「中」とする(迷う時は見張る側に倒す)。
 * 書く先が分からない時も「中」とする。
 */
export function insideProject(root, filePath, base) {
  const p = String(filePath ?? '').trim();
  if (!p) return true;
  const target = resolve(base || root, p);
  const roots = [resolve(root), realOf(resolve(root))];
  const targets = [target, realOf(target)];
  return roots.some((r) => targets.some((t) => within(r, t)));
}

/**
 * 語の一覧の 1 行を正規表現にする。既定は大文字と小文字を区別しない文字そのもの。
 * 「cs:」は区別する文字そのもの、「re:」は区別する正規表現、「rei:」は区別しない正規表現(Python の tools/terms.py と同じ形)。
 */
export function termToRegExp(line) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (line.startsWith('rei:')) return new RegExp(line.slice(4), 'i');
  if (line.startsWith('re:')) return new RegExp(line.slice(3));
  if (line.startsWith('cs:')) return new RegExp(esc(line.slice(3)));
  return new RegExp(esc(line), 'i');
}

/**
 * 入れない語の一覧を読む(形は termToRegExp)。読めなければ null。
 * 正規表現として読めない行は飛ばさず broken に入れ、checkText が止める側に倒す(一覧を直すまで中のファイルを書かせない)
 */
export function loadTerms(root, env = process.env) {
  const file = env.PREPUSH_TERMS || join(root, 'tools', 'prepush_terms.local.txt');
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#'));
  } catch {
    return null;
  }
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loose = lines.filter((t) => !/^(cs|re|rei):/.test(t));
  const strict = lines.filter((t) => t.startsWith('cs:') && t.length > 3).map((t) => t.slice(3));
  const regex = [];
  const broken = [];
  for (const t of lines.filter((l) => /^(re|rei):./.test(l))) {
    try {
      regex.push(termToRegExp(t));
    } catch {
      broken.push(t.slice(0, t.indexOf(':') + 1));
    }
  }
  return {
    loose: loose.length ? new RegExp(loose.map(esc).join('|'), 'i') : null,
    strict: strict.length ? new RegExp(strict.map(esc).join('|')) : null,
    regex,
    broken,
  };
}

const mask = (s) => s.slice(0, 60).replace(/[A-Za-z0-9_=-]{12,}/g, '…');

/** 書こうとしている文の中の問題。terms が null なら語は見ない(鍵だけ) */
export function checkText(text, terms) {
  const problems = [];
  const s = String(text ?? '');
  for (const [re, label] of SECRET_PATTERNS) {
    const m = re.exec(s);
    if (m) problems.push(`${label}: ${mask(m[0])}`);
  }
  for (const re of [terms?.loose, terms?.strict, ...(terms?.regex ?? [])]) {
    const m = re?.exec(s);
    if (m) problems.push(`入れない語「${m[0]}」`);
  }
  if (terms?.broken?.length) problems.push(`語の一覧に、正規表現として読めない行が ${terms.broken.length} 行あります(一覧を直してください)`);
  return problems;
}

/** Write / Edit / MultiEdit の入力から、書こうとしている文を取り出す */
export function textOfEdit(toolName, ti = {}) {
  if (toolName === 'Write') return String(ti.content ?? '');
  if (toolName === 'Edit') return String(ti.new_string ?? '');
  if (toolName === 'MultiEdit') return (ti.edits ?? []).map((e) => String(e?.new_string ?? '')).join('\n');
  if (toolName === 'NotebookEdit') return String(ti.new_source ?? '');
  return '';
}
