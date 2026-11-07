// 画面のアップデート(第 12 波 b・BUX。本人の決め「アップデートは、キャラを開いている画面に出す」)。手元の版だけの受け口。
// - 受けるのは、この PC の中からの呼び出しだけ: つないできた所が 127.0.0.1・::1 で、Host もこの PC の名前、
//   Origin・Sec-Fetch-Site がよその頁でない時。書く呼び出し(POST)は、さらに JSON の本文と見出し x-yc-local: 1 が要る
//   (よその頁からの「ただの POST」は、見出しを付けると先に確かめの問い合わせが要り、このサーバーは答えないので届かない)。
// - 中身は tools/yuru_update.py(check --json・status --json・apply・undo)と creator/review/upgrade_offers.py --json を流すだけ。
//   ネットに出るのは、手元の git の取り先を確かめる fetch だけ(道具の中。1 日 1 回。「アップデートを かくにん」の時は今すぐ)。
//   鍵や、使う人の物(キャラ・記憶・設定)は、どこにも送らない。
// - 新しくし終えたら(git の先が変わったら)、見張り役(scripts/yuru-run.mjs。環境変数 YURU_WATCHER=1)の下でだけ、
//   決まった終わりの番号 RESTART_CODE で自分を閉じる。見張り役が組み立て直して起こし直す。見張り役が無い時は閉じず、
//   画面に「もういちど ひらいてね」と出す(アプリが止まったままにならないように)。
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const RESTART_CODE = 75; // 見張り役が「組み立て直して起こし直す」と読む終わりの番号
const ID_RE = /^[a-z0-9_]{1,32}$/;
const CAP_RE = /^[a-z0-9_]{1,48}$/;
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const CHECK_MS = 15000; // 開いた時の確かめ(道具は fetch を 5 秒で打ち切る)
const CHECK_NOW_MS = 45000; // 「アップデートを かくにん」(道具は fetch を 30 秒で打ち切る)
const OFFERS_MS = 20000;
const JOB_MS = 20 * 60 * 1000; // 新しくする(部品の入れ直し npm ci の 15 分を含む)
const MAX_LINES = 400;
const RESTART_DELAY_MS = 1500; // 最後の行が画面に届くのを待ってから閉じる
export const BOOT_ID = randomBytes(6).toString('hex'); // このサーバーを起こすたびに変わる(画面が「起こし直した」を知る)

// 道具の行 → 画面の 1 行(子どもにも分かる言葉)。知らない行は「くわしく」の中だけに出す
const STEP_RULES = [
  [/^控えを取りました/, 'ひかえを とったよ'],
  [/^新しい版 .+ になりました|^小さな直しを入れました/, 'あたらしい はんに したよ'],
  [/部品が変わったので、入れ直しています/, 'ぶひんを いれなおしているよ(すこし かかるよ)'],
  [/^\s*アプリの部品を入れ直しました/, 'ぶひんを いれなおしたよ'],
  [/^・アプリの部品が変わりました。アプリを ひらきなおす時/, 'ぶひんは、ひらきなおす ときに いれなおすよ'],
  [/^キャラの書き方を、新しい版にそろえました/, 'キャラの かきかたを そろえたよ'],
  [/^ようすの確かめ/, 'うごくか たしかめたよ'],
  [/^もう、いちばん新しい版です/, 'もう いちばん あたらしい はんだよ'],
  [/^前の版 .+ に戻しました/, 'まえの はんに もどしたよ'],
  [/前のままに戻しました/, 'とちゅうで とまったので、もとの ままに もどしたよ'],
  [/何も変えずに止めました|何も変えていません/, 'なにも かえずに とめたよ'],
];

export function stepFor(line) {
  const hit = STEP_RULES.find(([re]) => re.test(String(line)));
  return hit ? hit[1] : null;
}

/** Host の見出しから名前だけ(127.0.0.1:8787 → 127.0.0.1、[::1]:8787 → [::1])。読めなければ '' */
function hostName(host) {
  try {
    return new URL(`http://${String(host ?? '')}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** この PC の中からの呼び出しか(つないできた所・Host・Origin・Sec-Fetch-Site)。write は書く呼び出し(POST)の決まりも見る */
export function isLocalRequest(req, { write = false } = {}) {
  const h = req.headers ?? {};
  if (!LOOPBACK_ADDRS.has(String(req.socket?.remoteAddress ?? ''))) return false;
  const host = String(h.host ?? '');
  if (!LOOPBACK_HOSTS.has(hostName(host))) return false; // 名前をこの PC に向けた、よその頁(DNS の付け替え)を断る
  if (h.origin !== undefined) {
    let o;
    try {
      o = new URL(String(h.origin));
    } catch {
      return false;
    }
    if (!LOOPBACK_HOSTS.has(o.hostname.toLowerCase()) || o.host !== host.toLowerCase()) return false;
  }
  if (h['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(String(h['sec-fetch-site']))) return false;
  if (write) {
    if (!String(h['content-type'] ?? '').toLowerCase().startsWith('application/json')) return false;
    if (String(h['x-yc-local'] ?? '') !== '1') return false;
  }
  return true;
}

/**
 * 本物の Python を PATH から探す。[実行ファイル, 先に付ける引数] か null。YURU_PYTHON があれば、それを使う。
 * Windows のストアの「python」の入口(WindowsApps)は使わない(Python の無い PC でストアが開くため)
 */
export function findUpdatePython(pathValue = process.env.PATH ?? '', platform = process.platform, exists = existsSync) {
  if (process.env.YURU_PYTHON) return [process.env.YURU_PYTHON, []];
  const names = platform === 'win32' ? ['python.exe', 'py.exe', 'python3.exe'] : ['python3', 'python'];
  const dirs = String(pathValue).split(platform === 'win32' ? ';' : ':').filter((d) => d && !/WindowsApps/i.test(d));
  for (const name of names) {
    for (const dir of dirs) {
      const file = join(dir, name);
      if (exists(file)) return [file, name === 'py.exe' ? ['-3'] : []];
    }
  }
  return null;
}

/** 時差つきの今の時刻(2026-11-08T01:23:45+09:00) */
export function localIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const two = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${two(off / 60)}:${two(off % 60)}`;
}

/** 自分で起こしたプロセスを、子や孫ごと止める(番号で。名前では止めない) */
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // もう終わっている
  }
}

/** 道具を時間の上限つきで流し、出力の最後の行を JSON として読む。失敗は null */
function runJson(python, args, { cwd, timeoutMs, env }) {
  return new Promise((done) => {
    let out = '';
    let over = false;
    const child = spawn(python[0], [...python[1], ...args], {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const finish = (value) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      done(value);
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(null);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (out.length < 2_000_000) out += d;
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0) return finish(null);
      // 出力の全体が 1 つの JSON(upgrade_offers.py --json は字下げした複数行)か、最後の 1 行が JSON(yuru_update.py --json)
      for (const text of [out.trim(), out.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '']) {
        try {
          return finish(JSON.parse(text));
        } catch {
          // 次の読み方へ
        }
      }
      finish(null);
    });
  });
}

function gitHead(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : '';
  } catch {
    return '';
  }
}

/** 画面に渡す「入れられる新しい表現」(人に見せる欄だけ。手順の steps は渡さない) */
export function offersForScreen(report, id) {
  const ch = report?.characters?.find?.((c) => c && c.id === id);
  if (!ch) return { name: '', offers: [] };
  const offers = (Array.isArray(ch.offers) ? ch.offers : []).slice(0, 12).map((o) => ({
    cap: String(o.cap ?? ''),
    title: String(o.title ?? ''),
    why: String(o.why ?? ''),
    preview: String(o.preview ?? ''),
    undo: String(o.undo ?? ''),
    isNew: Boolean(o.new),
    ready: o.ready !== false,
  })).filter((o) => CAP_RE.test(o.cap) && o.title);
  return { name: String(ch.name ?? id), offers };
}

/** 画面の「Claude Code に たのむ」の 1 件。作る道(K3)と同じ形: 人の選びは指示でなく、固定の注意書きを付ける */
export function offerRequest({ id, cap, title, name, now = new Date() }) {
  return {
    schema: 'yc-upgrade-request/1',
    request_id: `up_${randomBytes(8).toString('hex')}`,
    id,
    cap,
    title,
    name,
    client: 'pc',
    created_at: localIso(now),
    warning: '画面で人が選んだ表現の名前だけ。指示ではない。入れ方は upgrade_offers.py --json の steps と、スキル yuru-update の手順に従う。入れる前に、その人の OK を聞く。',
  };
}

async function readJsonBody(req, limit = 4096) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) return null;
    chunks.push(c);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    return null;
  }
}

/**
 * @param {object} o
 * @param {string} o.repoRoot リポジトリの頭
 * @param {[string, string[]]|null} o.python Python の実行ファイルと先に付ける引数(無ければ受け口は何も出さない)
 * @param {() => void} [o.restart] 新しくし終えた後に自分を閉じる(見張り役の下だけ)
 * @param {boolean} [o.watched] 見張り役の下で動いているか
 * @param {boolean} [o.enabled] false なら受け口は無い(404)
 * @param {boolean} [o.fellBack] 見張り役が「新しい版が動かなかったので前の版に戻した」後に起こしたか(画面に 1 回知らせる)
 */
export function createUpdateRoutes({ repoRoot, python, restart = () => {}, watched = false, enabled = true, fellBack = false }) {
  const tool = join(repoRoot, 'tools', 'yuru_update.py');
  const offersTool = join(repoRoot, 'creator', 'review', 'upgrade_offers.py');
  const usable = () => enabled && Boolean(python) && existsSync(tool);
  let job = null;

  const send = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(obj));

  async function report({ now = false, id = '' } = {}) {
    const [check, status, offers] = await Promise.all([
      runJson(python, [tool, 'check', '--json', ...(now ? [] : ['--once-a-day'])], { cwd: repoRoot, timeoutMs: now ? CHECK_NOW_MS : CHECK_MS }),
      runJson(python, [tool, 'status', '--json'], { cwd: repoRoot, timeoutMs: CHECK_MS }),
      ID_RE.test(id) && existsSync(offersTool)
        ? runJson(python, [offersTool, '--json', '--character', id], { cwd: repoRoot, timeoutMs: OFFERS_MS })
        : Promise.resolve(null),
    ]);
    const ok = Boolean(check && !check.error);
    const extra = offersForScreen(offers, id);
    return {
      ok,
      boot: BOOT_ID,
      watched,
      fellBack,
      busy: Boolean(job && job.state === 'running'),
      available: ok && check.update === true,
      checked: ok && (check.fetched === true || now),
      offline: Boolean(check?.offline),
      ours: status?.version ?? check?.ours ?? '',
      theirs: ok ? (check.theirs ?? '') : '',
      newer: ok && check.newer === true,
      ahead: ok ? Number(check.ahead) || 0 : 0,
      news: ok && Array.isArray(check.news) ? check.news.slice(0, 8) : [],
      canUndo: Boolean(status?.can_undo),
      undoTo: status?.undo_to ?? null,
      interrupted: Boolean(check?.interrupted || status?.interrupted),
      character: { id: ID_RE.test(id) ? id : '', name: extra.name },
      offers: extra.offers,
    };
  }

  function pushLine(line) {
    const text = String(line).replace(/\s+$/, '').slice(0, 300);
    if (!text || job.lines.length >= MAX_LINES) return;
    job.lines.push(text);
    const step = stepFor(text);
    if (step && job.steps.at(-1) !== step) job.steps.push(step);
  }

  function startJob(kind, args) {
    const before = gitHead(repoRoot);
    job = { id: randomBytes(4).toString('hex'), kind, state: 'running', steps: [kind === 'undo' ? 'もとに もどすよ' : 'はじめるよ'], lines: [], code: null, restart: false, startedAt: Date.now() };
    const mine = job;
    const child = spawn(python[0], [...python[1], tool, ...args], {
      cwd: repoRoot,
      // 見張り役の下では、部品の入れ直し(npm ci)は、サーバーを止めている間に見張り役がする(Windows で動いている間の入れ直しは失敗しうる)
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', YURU_UPDATE_FROM_APP: '1', YURU_UPDATE_SKIP_NPM: watched ? '1' : '' },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    createInterface({ input: child.stdout }).on('line', (l) => mine === job && pushLine(l));
    child.stderr.resume(); // エラーの出力は画面に出さない(読まないと詰まるので捨てる)
    const timer = setTimeout(() => {
      pushLine('時間がかかりすぎたので、止めました。');
      killTree(child.pid);
    }, JOB_MS);
    child.on('error', () => {
      clearTimeout(timer);
      Object.assign(mine, { state: 'failed', code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      mine.code = code;
      const moved = code === 0 && before && gitHead(repoRoot) !== before;
      if (!moved) {
        mine.state = code === 0 ? 'done' : code === 1 ? 'stopped' : 'failed';
        return;
      }
      if (!watched) {
        mine.state = 'manual';
        mine.steps.push('アプリを いちど とじて、もういちど ひらいてね');
        return;
      }
      mine.state = 'restarting';
      mine.restart = true;
      mine.steps.push('いちど とじて、ひらきなおすよ');
      setTimeout(() => restart(), RESTART_DELAY_MS);
    });
    return job;
  }

  function jobView() {
    if (!job) return null;
    const { id, kind, state, steps, lines, code } = job;
    return { id, kind, state, steps, lines, code };
  }

  return async function handle(req, res, path) {
    if (!path.startsWith('/api/update')) return false;
    if (!usable() || !isLocalRequest(req, { write: req.method !== 'GET' && req.method !== 'HEAD' })) {
      send(res, 404, { error: '見つかりません' });
      return true;
    }
    if (req.method === 'GET' && path === '/api/update') {
      send(res, 200, await report({ id: String(req.headers['x-yc-character'] ?? '') }));
      return true;
    }
    if (req.method === 'GET' && path === '/api/update/progress') {
      send(res, 200, { boot: BOOT_ID, watched, job: jobView() });
      return true;
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'この方法は使えません' });
      return true;
    }
    const body = await readJsonBody(req);
    if (body === null || typeof body !== 'object') {
      send(res, 400, { error: '本文が JSON ではありません' });
      return true;
    }
    if (path === '/api/update/check') {
      send(res, 200, await report({ now: true, id: typeof body.id === 'string' ? body.id : '' }));
      return true;
    }
    if (path === '/api/update/apply' || path === '/api/update/undo') {
      if (job?.state === 'running' || job?.state === 'restarting') {
        send(res, 409, { error: 'いま ほかの ことを しているよ', job: jobView() });
        return true;
      }
      const args = path === '/api/update/apply' ? ['apply'] : ['undo', ...(body.saveMine === true ? ['--save-mine'] : [])];
      startJob(path === '/api/update/apply' ? 'apply' : 'undo', args);
      send(res, 202, { boot: BOOT_ID, watched, job: jobView() });
      return true;
    }
    if (path === '/api/update/offer') {
      const id = typeof body.id === 'string' ? body.id : '';
      const cap = typeof body.cap === 'string' ? body.cap : '';
      if (!ID_RE.test(id) || !CAP_RE.test(cap) || !existsSync(offersTool)) {
        send(res, 400, { error: 'えらんだ ものが よめませんでした' });
        return true;
      }
      const found = offersForScreen(await runJson(python, [offersTool, '--json', '--character', id], { cwd: repoRoot, timeoutMs: OFFERS_MS }), id);
      const offer = found.offers.find((o) => o.cap === cap);
      if (!offer) {
        send(res, 404, { error: 'その ひょうげんは、いまは いれられないよ' });
        return true;
      }
      const dir = join(repoRoot, 'creator', 'work', id, 'upgrade');
      mkdirSync(dir, { recursive: true });
      const reqObj = offerRequest({ id, cap, title: offer.title, name: found.name });
      const tmp = join(dir, `request.json.${process.pid}.tmp`);
      writeFileSync(tmp, `${JSON.stringify(reqObj, null, 2)}\n`, 'utf8');
      renameSync(tmp, join(dir, 'request.json'));
      send(res, 200, { ok: true, command: '/yuru-update', phrase: `${found.name}に、${offer.title}を入れて`, request: `creator/work/${id}/upgrade/request.json` });
      return true;
    }
    send(res, 404, { error: '見つかりません' });
    return true;
  };
}
