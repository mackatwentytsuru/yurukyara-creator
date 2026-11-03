// 現場の決まりは、スキル(.claude/skills/shop-guide/SKILL.md)の 1 節が正本。実行時に、その節をそのまま頭脳へ渡す。
// スキルが読めない配り方(リポジトリの外に置いたとき)でも止まらないよう、最低限の決まりを持っておく。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../env.mjs';

export const SKILL_FILE = join(REPO_ROOT, '.claude', 'skills', 'shop-guide', 'SKILL.md');
const START = '<!-- rules:start -->';
const END = '<!-- rules:end -->';

export const FALLBACK_RULES = `# 現場の決まり
- 答えの根拠は店のデータだけ。載っていないことは推測せず、スタッフにつなぐ。
- クレーム・支払い・緊急・未成年は、スタッフにつなぐ。お客さん個人の情報は答えない。`;

/** スキルの文から、決まりの節を取り出す。印が見つからなければ null */
export function extractRules(markdown) {
  const a = markdown.indexOf(START);
  const b = markdown.indexOf(END);
  if (a < 0 || b <= a) return null;
  return markdown.slice(a + START.length, b).trim();
}

let cached = null;
export function loadRules(file = SKILL_FILE) {
  if (file === SKILL_FILE && cached) return cached;
  const found = existsSync(file) ? extractRules(readFileSync(file, 'utf8')) : null;
  const rules = found ?? FALLBACK_RULES;
  if (file === SKILL_FILE) cached = rules;
  return rules;
}
