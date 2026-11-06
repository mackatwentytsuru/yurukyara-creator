// 鍵と入れない語の見張りの判定(純粋な関数。フックと試験の両方が使う)。
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// 鍵の形。値は理由に出さない(伏せ字にする)
export const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic の鍵らしい文字列'],
  [/\bsk_[a-f0-9]{32,}\b/, 'ElevenLabs の鍵らしい文字列'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'GitHub の鍵らしい文字列'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS の鍵らしい文字列'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, '秘密鍵'],
  [/(ANTHROPIC|ELEVEN(?:LABS)?|UPSTASH_REDIS_REST|KV_REST_API)_?(?:API_?)?(?:KEY|TOKEN)\s*[=:]\s*['"]?[A-Za-z0-9_=-]{16,}/i, '鍵の代入'],
  [/xi-api-key['"]?\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i, 'xi-api-key に直接書いた値'],
];

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

/** 入れない語の一覧を読む。「cs:」で始まる行は大文字と小文字を区別する。読めなければ null */
export function loadTerms(root, env = process.env) {
  const file = env.PREPUSH_TERMS || join(root, 'tools', 'prepush_terms.local.txt');
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#'));
  } catch {
    return null;
  }
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loose = lines.filter((t) => !t.startsWith('cs:'));
  const strict = lines.filter((t) => t.startsWith('cs:') && t.length > 3).map((t) => t.slice(3));
  return {
    loose: loose.length ? new RegExp(loose.map(esc).join('|'), 'i') : null,
    strict: strict.length ? new RegExp(strict.map(esc).join('|')) : null,
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
  for (const re of [terms?.loose, terms?.strict]) {
    const m = re?.exec(s);
    if (m) problems.push(`入れない語「${m[0]}」`);
  }
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
