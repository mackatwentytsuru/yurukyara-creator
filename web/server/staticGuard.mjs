// 配るファイルと、つないできた名前(Host)の見張り。
// - パス: 戻す前の生のパスで、区切りになる文字(%2F・%5C・%00)と、戻した後にもう 1 度戻せる印(%25…)を断る。
//   .. の部品・点で始まる名前(.env・.git)・バックスラッシュ・コロンも断る。
//   さらに実際の置き場所(realpath)が、許した場所の中にある時だけ配る(shortcut・symlink で外へ出る道を断つ)。
// - Host: DNS rebinding(外のページが自分の名前をこの PC に向け直す)を断る。通すのは、自分の端末を指す名前だけ。
import { existsSync, realpathSync, statSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { isAbsolute, join, normalize, relative } from 'node:path';

const ENCODED_SEP = /%2f|%5c|%00|%25/i;

/** URL の生のパス(戻す前)を見て、配ってよい形なら戻したパスを返す。だめなら { error }(status は 400 か 404) */
export function checkStaticPath(rawPathname) {
  if (typeof rawPathname !== 'string' || !rawPathname.startsWith('/')) return { error: 'パスの形が違います', status: 400 };
  if (ENCODED_SEP.test(rawPathname)) return { error: 'パスの形が違います', status: 400 };
  let path;
  try {
    path = decodeURIComponent(rawPathname);
  } catch {
    return { error: 'パスが読めません', status: 400 };
  }
  if (/[\\\0:]/.test(path)) return { error: 'パスの形が違います', status: 400 };
  if (path.split('/').some((p) => p === '..' || p.startsWith('.'))) return { error: '見つかりません', status: 404 };
  return { path };
}

function isInside(base, real) {
  const rel = relative(base, real);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** root の中の rel を realpath で確かめて、本物の置き場所を返す(allowedTops があれば、その頭のフォルダの中だけ)。だめなら null */
export function resolveInside(root, rel, allowedTops = null) {
  const full = normalize(join(root, rel));
  if (!isInside(root, full) || !existsSync(full)) return null;
  let real;
  let realRoot;
  try {
    real = realpathSync(full);
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  const bases = allowedTops ? allowedTops.map((t) => join(realRoot, t)) : [realRoot];
  if (!bases.some((b) => isInside(b, real))) return null;
  try {
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** Host の見出しから名前だけ(小文字)。[::1]:8787 → ::1、Example.com:80 → example.com。読めない形は '' */
export function hostNameOf(header) {
  if (typeof header !== 'string') return '';
  const h = header.trim().toLowerCase();
  if (!h || /[\s/\\@?#]/.test(h)) return '';
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end < 0) return '';
    return h.slice(1, end).split('%')[0];
  }
  if ((h.match(/:/g) ?? []).length > 1) return '';
  return h.split(':')[0].replace(/\.$/, '');
}

const WILDCARD = new Set(['0.0.0.0', '::', '']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** この端末を指す名前の表。外から開ける待ち受け(HOST が自分の端末だけでない時)は、この端末の住所と名前も足す */
export function allowedHostNames({ bindHost = '127.0.0.1', extra = '', nets = networkInterfaces(), machine = hostname() } = {}) {
  const names = new Set(LOOPBACK);
  const bind = String(bindHost).toLowerCase();
  if (!WILDCARD.has(bind)) names.add(bind);
  if (!LOOPBACK.has(bind)) {
    for (const list of Object.values(nets ?? {})) for (const n of list ?? []) names.add(String(n.address).toLowerCase().split('%')[0]);
    const me = String(machine).toLowerCase();
    if (me) {
      names.add(me);
      names.add(`${me}.local`);
    }
  }
  for (const s of String(extra).split(',')) {
    const n = hostNameOf(s.trim());
    if (n) names.add(n);
  }
  return names;
}

/** tailnet の名前(<端末>.<tailnet>.ts.net)は、Tailscale が決める名前で、向け直しができない。README の tailscale serve の道を通す */
const TAILNET = /\.ts\.net$/;

/** この Host で来た頼みを受けてよいか */
export function hostAllowed(header, names) {
  const name = hostNameOf(header);
  if (!name) return false;
  return names.has(name) || TAILNET.test(name);
}

/** 状態を変える頼み(POST・PUT・DELETE)の Origin。付いていれば、その名前も同じ表で見る。付いていない頼み(curl など)はそのまま通す */
export function originAllowed(origin, names) {
  if (origin === undefined) return true;
  const value = String(origin).trim();
  if (!/^https?:\/\//i.test(value)) return false; // "null"(囲われた枠)や変な形は断る
  try {
    return hostAllowed(new URL(value).host, names);
  } catch {
    return false;
  }
}
