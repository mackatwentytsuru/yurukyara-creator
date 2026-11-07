// 画面のアップデート(第 12 波 b・BUX。本人の決め「アップデートは、キャラを開いている画面に出す」「ワンクリックで全部済んで再起動」)。
// - 出すのは、この PC の中で開いた画面(localhost)で、手元のサーバーが /api/update に答えた時だけ。公開の版(ネットの住所)・
//   同じ Wi-Fi のスマホ・確かめに失敗した時・オフラインの時は、何も出さない。
// - 上の段の小さな印「あたらしい はんが あります」。押すまで会話のじゃまをしない。押すと窓: できるようになったこと・
//   「アップデートする」(控え → 新しくする → 部品の入れ直し → 起こし直し → 画面が自動で開き直す)・「アップデートを かくにん」・
//   「もとに もどす」・進み具合を 1 行ずつ・この キャラに いれられる あたらしい ひょうげん(押すと PC の Claude Code への頼みを書く)。
// - 送る物: この PC のサーバーへ、開いているキャラの id と、押したボタンだけ。鍵や記憶は送らない。
import { isLoopbackPage } from '../character/urlSpec.js';
import { createNote, createSheet, el } from './sheet.js';

const POLL_MS = 600;
const REOPEN_POLL_MS = 800;
const REOPEN_SLOW_MS = 20000;
const REOPEN_GIVE_UP_MS = 16 * 60 * 1000; // 部品の入れ直し(npm ci)は 15 分まで
const DONE_KEY = 'yc.update.done';
const LOCAL = { 'content-type': 'application/json', 'x-yc-local': '1' };

export const UPDATE_WORDS = Object.freeze({
  badge: 'あたらしい はんが あります',
  title: 'アプリの アップデート',
  newest: 'いまの はんが いちばん あたらしいよ',
  news: 'できるようになったこと',
  keep: 'キャラ・せいかく・こえ・きおく・せっていは きえないよ。さきに ひかえを とるので、あとで もとに もどせるよ。',
  apply: 'アップデートする',
  check: 'アップデートを かくにん',
  undo: 'もとに もどす',
  saveMine: 'いまの なかみを ひかえに うつしてから もどす',
  checking: 'たしかめているよ…',
  offline: 'いまは たしかめられなかったよ。ネットに つながっているか みてね',
  busy: 'すすめているよ。はなすのは そのまま つづけられるよ',
  reopening: 'ひらきなおすのを まっているよ…',
  reopenSlow: 'すこし じかんが かかっているよ(ぶひんを いれなおしているかも)',
  reopenFail: 'ひらきなおせなかったよ。web の フォルダで npm start を もういちど ためしてね',
  fellBack: 'あたらしい はんが うごかなかったので、まえの はんに もどしたよ',
  details: 'くわしく',
  offers: 'この キャラに いれられる あたらしい ひょうげん',
  ask: 'Claude Code に たのむ',
  asked: 'たのんだよ。PC の Claude Code で /yuru-update と うってね',
  stopped: 'とちゅうで とめたよ。あなたの ものは そのままだよ',
});

function readSession(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // 覚えられない端末でも動く
  }
}

/** 窓に出す今の版の 1 行 */
export function versionLine(r) {
  if (!r) return '';
  if (r.available && r.newer) return `いまの はん ${r.ours} → あたらしい はん ${r.theirs}`;
  if (r.available) return `いまの はん ${r.ours}(ちいさな なおしが ${r.ahead} こ あります)`;
  return `${UPDATE_WORDS.newest}(${r.ours})`;
}

/**
 * @param {object} o
 * @param {object} o.app main.js の app(characterId・status を読むだけ)
 * @param {Location} [o.loc]
 * @returns {{open:(from?:HTMLElement)=>void, refresh:()=>Promise<object|null>, report:()=>object|null}|null}
 */
export function mountUpdate({ app, loc = globalThis.location } = {}) {
  if (!isLoopbackPage(loc)) return null; // 公開の版・同じ Wi-Fi のスマホでは何も出さない
  const row = document.querySelector('.top .top-row');
  if (!row) return null;
  const badge = el('button', { type: 'button', id: 'ycUpdateBadge', class: 'yc-update-badge', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'ycUpdate', title: UPDATE_WORDS.badge, hidden: true },
    el('span', { class: 'yc-update-dot', 'aria-hidden': 'true' }), el('span', { class: 'yc-update-long', text: UPDATE_WORDS.badge }), el('span', { class: 'yc-update-short', 'aria-hidden': 'true', text: 'あたらしい はん' }));
  badge.setAttribute('aria-label', UPDATE_WORDS.badge);
  row.append(badge);
  const note = createNote('ycUpdateNote');
  const sheet = createSheet({ id: 'ycUpdate', title: UPDATE_WORDS.title });

  const version = el('p', { class: 'yc-up-version' });
  const newsTitle = el('h3', { class: 'yc-up-h', text: UPDATE_WORDS.news });
  const newsList = el('ul', { class: 'yc-up-news' });
  const keep = el('p', { class: 'yc-up-keep', text: UPDATE_WORDS.keep });
  const applyBtn = el('button', { type: 'button', class: 'yc-btn yc-btn-main', id: 'ycUpdateApply', text: UPDATE_WORDS.apply });
  const checkBtn = el('button', { type: 'button', class: 'yc-btn', id: 'ycUpdateCheck', text: UPDATE_WORDS.check });
  const undoBtn = el('button', { type: 'button', class: 'yc-btn', id: 'ycUpdateUndo', text: UPDATE_WORDS.undo, hidden: true });
  const saveMineBtn = el('button', { type: 'button', class: 'yc-btn', id: 'ycUpdateSaveMine', text: UPDATE_WORDS.saveMine, hidden: true });
  const message = el('p', { class: 'yc-up-msg', role: 'status', 'aria-live': 'polite' });
  const steps = el('ol', { class: 'yc-up-steps', 'aria-live': 'polite' });
  const rawList = el('pre', { class: 'yc-up-raw' });
  const raw = el('details', { class: 'yc-up-details', hidden: true }, el('summary', { text: UPDATE_WORDS.details }), rawList);
  const offersBox = el('div', { class: 'yc-up-offers', hidden: true }, el('h3', { class: 'yc-up-h', text: UPDATE_WORDS.offers }));
  const offerList = el('ul', { class: 'yc-up-offer-list' });
  offersBox.append(offerList);
  sheet.body.append(version, newsTitle, newsList, keep, el('div', { class: 'yc-up-actions' }, applyBtn, checkBtn, undoBtn, saveMineBtn), message, steps, raw, offersBox);

  let report = null;
  let working = false;

  function renderOffers(r) {
    offerList.replaceChildren();
    const offers = Array.isArray(r?.offers) ? r.offers : [];
    offersBox.hidden = offers.length === 0;
    for (const o of offers) {
      const said = el('p', { class: 'yc-up-asked', role: 'status' });
      const btn = el('button', { type: 'button', class: 'yc-btn yc-btn-small', text: UPDATE_WORDS.ask, disabled: o.ready === false ? true : undefined });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch('/api/update/offer', { method: 'POST', headers: LOCAL, body: JSON.stringify({ id: r.character?.id ?? '', cap: o.cap }) });
          const data = await res.json().catch(() => ({}));
          said.textContent = res.ok ? `${UPDATE_WORDS.asked}(「${data.phrase}」)` : String(data.error ?? UPDATE_WORDS.stopped);
        } catch {
          said.textContent = UPDATE_WORDS.offline;
        } finally {
          btn.disabled = false;
        }
      });
      offerList.append(el('li', { class: 'yc-up-offer' }, el('b', { text: o.title }), o.why ? el('span', { text: o.why }) : null, btn, said));
    }
  }

  function render(r) {
    version.textContent = versionLine(r);
    const news = Array.isArray(r?.news) ? r.news : [];
    newsList.replaceChildren(...news.flatMap((s) => (Array.isArray(s.lines) ? s.lines : []).map((line) => el('li', { text: line }))));
    newsTitle.hidden = newsList.childElementCount === 0;
    newsList.hidden = newsTitle.hidden;
    applyBtn.hidden = !r?.available;
    keep.hidden = !r?.available;
    undoBtn.hidden = !r?.canUndo;
    applyBtn.disabled = working || Boolean(r?.busy);
    undoBtn.disabled = working || Boolean(r?.busy);
    checkBtn.disabled = working;
    renderOffers(r);
  }

  function renderJob(job) {
    if (!job) return;
    steps.replaceChildren(...(job.steps ?? []).map((s) => el('li', { text: s })));
    rawList.textContent = (job.lines ?? []).join('\n');
    raw.hidden = !(job.lines ?? []).length;
  }

  async function load(path = '/api/update', init) {
    try {
      const res = path === '/api/update'
        ? await fetch('/api/update', { headers: { 'x-yc-character': String(app?.characterId ?? '') } })
        : await fetch('/api/update/check', init);
      if (!res.ok) return null;
      const r = await res.json();
      return r && r.ok !== undefined ? r : null;
    } catch {
      return null;
    }
  }

  async function refresh() {
    const r = await load();
    if (!r) return null; // 答えない・失敗: 何も出さない
    report = r;
    badge.hidden = !r.available;
    render(r);
    if (r.fellBack && !readSession('yc.update.fellback.shown')) {
      writeSession('yc.update.fellback.shown', '1');
      note.show(UPDATE_WORDS.fellBack, { ms: 12000 });
    }
    return r;
  }

  /** 起こし直した新しいサーバーが答えたら、画面を開き直す(起こすたびに変わる boot で見分ける) */
  async function waitReopen(oldBoot, kind) {
    message.textContent = UPDATE_WORDS.reopening;
    const t0 = Date.now();
    writeSession(DONE_KEY, JSON.stringify({ kind, from: report?.ours ?? '' }));
    while (Date.now() - t0 < REOPEN_GIVE_UP_MS) {
      await new Promise((r) => setTimeout(r, REOPEN_POLL_MS));
      if (Date.now() - t0 > REOPEN_SLOW_MS) message.textContent = UPDATE_WORDS.reopenSlow;
      try {
        if (!(await fetch('/api/status', { cache: 'no-store' })).ok) continue;
        const p = await fetch('/api/update/progress', { cache: 'no-store' });
        const boot = p.ok ? (await p.json()).boot : '';
        if (!p.ok || boot !== oldBoot) {
          loc.reload();
          return;
        }
      } catch {
        // 起こし直している間は答えない
      }
    }
    writeSession(DONE_KEY, null);
    message.textContent = UPDATE_WORDS.reopenFail;
  }

  async function runJob(kind, body = {}) {
    working = true;
    render(report);
    message.textContent = UPDATE_WORDS.busy;
    saveMineBtn.hidden = true;
    let boot = '';
    try {
      const init = { method: 'POST', headers: LOCAL, body: JSON.stringify(body) };
      const res = kind === 'apply' ? await fetch('/api/update/apply', init) : await fetch('/api/update/undo', init); // 宛先は文字で書く(privacy.test.mjs が見る)
      const data = await res.json().catch(() => ({}));
      boot = data.boot ?? '';
      if (!res.ok && res.status !== 409) throw new Error(String(data.error ?? ''));
      renderJob(data.job);
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const p = await (await fetch('/api/update/progress', { cache: 'no-store' })).json();
        boot = p.boot ?? boot;
        renderJob(p.job);
        const state = p.job?.state;
        if (state === 'running') continue;
        if (state === 'restarting') return void (await waitReopen(boot, kind));
        if (state === 'manual') {
          message.textContent = '';
          break;
        }
        // done・stopped・failed: 道具の文はそのまま「くわしく」に。元に戻すが止まった(新しい版でも変わった物がある)時だけ、写してから戻す道を出す
        const stoppedUndo = kind === 'undo' && state === 'stopped' && (p.job.lines ?? []).some((l) => /--save-mine|写してから元に戻して/.test(l));
        saveMineBtn.hidden = !stoppedUndo;
        message.textContent = state === 'done' ? '' : UPDATE_WORDS.stopped;
        raw.open = state !== 'done';
        break;
      }
    } catch {
      message.textContent = UPDATE_WORDS.stopped;
    }
    working = false;
    await refresh();
  }

  badge.addEventListener('click', () => (sheet.isOpen() ? sheet.hide() : api.open(badge)));
  applyBtn.addEventListener('click', () => void runJob('apply'));
  undoBtn.addEventListener('click', () => void runJob('undo'));
  saveMineBtn.addEventListener('click', () => void runJob('undo', { saveMine: true }));
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    message.textContent = UPDATE_WORDS.checking;
    const r = await load('/api/update/check', { method: 'POST', headers: LOCAL, body: JSON.stringify({ id: String(app?.characterId ?? '') }) });
    checkBtn.disabled = false;
    if (!r || r.offline || !r.ok) {
      message.textContent = UPDATE_WORDS.offline;
      return;
    }
    report = r;
    badge.hidden = !r.available;
    message.textContent = r.available ? '' : UPDATE_WORDS.newest;
    render(r);
  });

  const api = {
    open(from) {
      render(report ?? { ours: '' });
      sheet.show(from ?? badge);
      if (!report) void refresh();
    },
    refresh,
    report: () => report,
  };

  // 開き直した後の 1 回だけの知らせ
  const done = readSession(DONE_KEY);
  if (done) {
    writeSession(DONE_KEY, null);
    void refresh().then((r) => {
      if (!r) return;
      let kind = 'apply';
      try {
        kind = JSON.parse(done).kind;
      } catch {
        // 形が違えば、ふつうの知らせ
      }
      note.show(kind === 'undo' ? `まえの はんに もどったよ(いまの はん ${r.ours})` : `アップデートが おわったよ(いまの はん ${r.ours})`, { ms: 12000 });
    });
  }
  return api;
}

/** キャラを読み終えた後(app.characterId が決まった後)に、1 回だけ確かめる。待つ上限つき */
export function startUpdateCheck(api, app, { waitMs = 30000 } = {}) {
  if (!api) return;
  const t0 = Date.now();
  const tick = () => {
    if (app?.characterId || Date.now() - t0 > waitMs) return void api.refresh();
    setTimeout(tick, 300);
  };
  tick();
}
