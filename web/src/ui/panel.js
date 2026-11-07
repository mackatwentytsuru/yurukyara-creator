// 画面の部品: 「Claude の考え」の窓・字幕・上の小さな状態表示・仮の頭脳の知らせ・短い知らせ(ui.notice)・「VR(Quest)で開く」の入口。
// 合言葉(契約 K5)は会話の側の web/src/conversation/demoPass.js が 1 か所で持つ(会話と記憶の通信が同じ値を読む)。
import { SCAN_HOW, NO_QR_NOTE, SEND_LABEL, SEND_NAME } from '../stage/questLink.js';

const $ = (id) => document.getElementById(id);

/** 仮の頭脳の知らせの決まりの文(理由が分からない時) */
export const FALLBACK_BRAIN_NOTICE = '仮の頭脳です(本物の頭脳につながっていません)';
/** 短い知らせを出しておく時間 */
const NOTICE_MS = 6000;

const STAGE_LABEL = {
  greet: '声かけ',
  need: '用件',
  guide: '案内',
  handoff: '人へつなぐ',
  chat: '雑談',
};

// 人へつなぐ理由(サーバーの reason)を、画面の言葉に
const REASON_LABEL = {
  complaint: 'クレーム',
  payment: '支払い',
  emergency: '緊急',
  age: '年齢の確認',
  booking: '予約',
  unknown: '分からないこと',
};

/* ---------- 「表情と動き」の言葉(点検 CRITux 9: happy / bow / person のような中の名前を出さない) ---------- */
// 名前は動きの意図(K2。web/src/character/intent.js)の 7 つの表情と動き、rig のキャラの動きのファイルの名前
const EXPRESSION_WORDS = Object.freeze({
  neutral: 'ふつう',
  happy: 'うれしい',
  surprised: 'びっくり',
  sad: 'かなしい',
  angry: 'ぷんぷん',
  relaxed: 'のんびり',
  think: '考え中',
  thinking: '考え中',
});
const MOTION_WORDS = Object.freeze({
  none: '動きなし',
  idle: 'じっと待つ',
  talk: '話す',
  nod: 'うなずく',
  bow: 'おじぎ',
  wave: '手をふる',
  think: '考える',
  tilt: '首をかしげる',
  shake: '首をふる',
  shrug: '肩をすくめる',
  point: '指さす',
  jump: 'はねる',
  sad: 'しょんぼり',
});

/** 視線の指定(person・away・landmark:<名前>)を、画面の言葉に */
function gazeWords(gaze) {
  const g = typeof gaze === 'string' ? gaze.trim() : '';
  if (!g || g === 'person' || g === 'user') return 'あなたを見る';
  if (g === 'away') return 'よそを見る';
  if (g.startsWith('landmark:') && g.length > 'landmark:'.length) return `${g.slice('landmark:'.length)}を見る`;
  return '見る先は同じ';
}

/**
 * 返事の 1 文の表情・動き・視線を、日本語の 1 行にする。知らない名前は、中の名前を出さずに「この子の表情」などにする。
 * @param {{expression?: string, motion?: string, gaze?: string}} ev
 * @returns {string} 例「うれしい・おじぎ・あなたを見る」
 */
export function actWords(ev = {}) {
  const e = typeof ev.expression === 'string' ? ev.expression.trim().toLowerCase() : '';
  const m = typeof ev.motion === 'string' ? ev.motion.trim().toLowerCase() : '';
  const expr = e ? EXPRESSION_WORDS[e] ?? 'この子の表情' : 'ふつう';
  const motion = m ? MOTION_WORDS[m] ?? 'この子の動き' : '動きなし';
  return `${expr}・${motion}・${gazeWords(ev.gaze)}`;
}

/* ---------- 考えの窓の下の「返事が始まるまで」(点検 CRITux 18) ---------- */
/** 仮の頭脳で話した回に、秒の後ろへ付ける一言 */
export const FAKE_BRAIN_LATENCY_NOTE = '(仮の頭脳なので、参考の値)';

/**
 * 「返事が始まるまで ○ 秒」の後ろに付ける一言。付けるのは、仮の頭脳で話した回だけ。
 * 前は「本物の頭脳と声」で測った回の外は全部「(仮の頭脳か声なしなので、参考の値)」で、本物の頭脳が声なしで答えた回にも
 * 「仮の頭脳」と出ていた(11/7 の本物の Haiku の録画。声の有無は上の札「声」が出す)
 * @param {{brain?: string}} entry 会話の 1 回の記録(Dialogue の onMetric。brain は 'haiku' | 'mock' | 'unknown')
 * @param {{fakeBrain?: boolean}} [o] 会話のイベントで仮の頭脳と分かっている時(公開の関数の fallback の知らせ。記録に brain が無い)
 */
export function latencyNote(entry = {}, { fakeBrain = false } = {}) {
  const brain = entry?.brain;
  return brain === 'mock' || (brain !== 'haiku' && fakeBrain) ? FAKE_BRAIN_LATENCY_NOTE : '';
}

/* ---------- 字幕の流れ(点検 CRITux 12: 話し終わった後も、返事の全部を読めるように) ---------- */
/**
 * 字幕に出す物を決める(DOM は触らない。createUi が描く)。会話の側(Dialogue)の呼び方はそのまま受ける:
 *   say(文) → caption('' か 文) → caption(文字送りの途中)… → 次の say … → caption(null, ms)(話し終わり) / caption(null)(取り消し・次の会話)
 * - 話している間: 前の文(小さく)+ 今の文。文が入れ替わっても、前の文は消えない
 * - 話し終わり(null と待つ時間): 返事の全部を残す(前は 1.2 秒で消え、最後の 1 文しか読めなかった)。次の会話が始まるまで消さない
 * - 取り消し(null だけ)・使う人の言葉・ほかの知らせ(聞き返しなど): 返事を片づけて、その文を出す
 * @returns {{say(text: string): void, caption(text: string|null|undefined, hideAfterMs?: number, kind?: string): object, readonly phase: string}}
 *   caption の返す物: { hide: true, afterMs } / { reply: true, prev, current, settled } / { text, kind }
 */
/**
 * B3(第 12 波 b): 返事の字幕の描く物を決める(DOM は触らない)。onlyNow(テレビ表示・キーボードで低い画面の 1 行の字幕)の時は、
 * まだ話していない文(next)を出さない。描く物が何も無ければ hide(字幕の箱ごと隠す。空の箱を出さない)
 * @param {{prev?: string, current?: string, next?: string}} v createCaptionFlow の返す返事の形
 * @param {{onlyNow?: boolean}} [o]
 * @returns {{hide: boolean, next: string}}
 */
export function captionView(v, { onlyNow = false } = {}) {
  const next = onlyNow ? '' : (v?.next ?? '');
  return { hide: !v?.prev && !v?.current && !next, next };
}

export function createCaptionFlow() {
  let done = []; // この返事の、話し終えた文
  let full = null; // 話している文(全部)
  let ahead = []; // B3(第 12 波 b): 届いたけれど、まだ話していない文。話し始める前から薄く見せる(返事の全部が早く読める)
  let fullShown = false; // 今の文を、話す前に先に見せていたか(見せていた文は、文字送りの間も残りを薄く出したままにする)
  let phase = 'idle'; // idle | reply | settled
  const reset = () => {
    done = [];
    full = null;
    ahead = [];
    fullShown = false;
    phase = 'idle';
  };
  /** 薄く見せる所: 先に見せていた今の文のまだ出ていない残りと、届いてまだ話していない文。無ければ欄を付けない */
  const withNext = (view, shown) => {
    const next = `${fullShown && full !== null ? full.slice(shown.length) : ''}${ahead.join('')}`;
    return next ? { ...view, next } : view;
  };
  return {
    get phase() {
      return phase;
    },
    /** B3: 返事の 1 文が届いた(まだ話していない)。返す物は caption と同じ形(描く所がそのまま使う) */
    ahead(text) {
      const t = String(text ?? '');
      if (!t || phase === 'settled') return null;
      ahead.push(t);
      phase = 'reply';
      return withNext({ reply: true, prev: done.join(''), current: full ?? '', settled: false }, full ?? '');
    },
    /** 返事の 1 文を話し始めた(ui.say) */
    say(text) {
      if (full !== null) done.push(full);
      full = String(text ?? '');
      const at = ahead.indexOf(full);
      fullShown = at >= 0;
      if (at >= 0) ahead.splice(0, at + 1); // 届いた順に話すので、話し始めた文までを先の列から外す
      phase = 'reply';
    },
    caption(text, hideAfterMs = 0, kind = '') {
      const t = typeof text === 'string' ? text : '';
      if (kind === 'user') {
        reset();
        return t ? { text: t, kind: 'user' } : { hide: true, afterMs: hideAfterMs };
      }
      if (text == null || (t === '' && phase !== 'reply')) {
        // 話し終わり: 返事の全部を残す
        if (hideAfterMs > 0 && phase !== 'idle' && full !== null) {
          phase = 'settled';
          return { reply: true, prev: '', current: [...done, full, ...ahead].join(''), settled: true };
        }
        reset();
        return { hide: true, afterMs: hideAfterMs };
      }
      // 返事の文(全部か、文字送りの途中)。今の文の頭と同じなら返事の続き。まだ話していない所は next(薄く)
      if (phase === 'reply' && full !== null && full.startsWith(t)) return withNext({ reply: true, prev: done.join(''), current: t, settled: false }, t);
      // ほかの知らせ(聞き返しなど)
      reset();
      return { text: t, kind };
    },
  };
}

export function createUi() {
  const caption = $('caption');
  const els = {
    seen: $('tSeen'),
    intent: $('tIntent'),
    reply: $('tReply'),
    shop: $('tShop'),
    act: $('tAct'),
    foot: $('tFoot'),
  };
  let captionTimer = null;
  let noticeTimer = null;
  let replyParts = [];
  let actParts = [];
  let mirror = null; // VR の中の板へも同じ文字を渡す

  // 狭い画面では、最初は畳んでおく(字幕と顔を隠さないため)
  // 幅 1100 までは最初に畳む(iPad でも。開いたままだと窓の下へキャラが押されて小さく低くなった。L1 中)
  if (window.matchMedia('(max-width: 1100px)').matches) {
    $('thought').classList.add('collapsed');
    $('thoughtToggle').setAttribute('aria-expanded', 'false');
  }
  $('thoughtToggle').addEventListener('click', () => {
    const box = $('thought');
    box.classList.toggle('collapsed');
    $('thoughtToggle').setAttribute('aria-expanded', String(!box.classList.contains('collapsed')));
  });

  const badge = $('shopBadge');
  const hideCaption = () => {
    caption.hidden = true;
    badge.hidden = true; // 参照した情報の札は、返事の字幕と一緒に消える
  };
  const flow = createCaptionFlow(); // 返事の文を足して見せ、話し終わった後も全部を残す
  const span = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });
  /** 返事の字幕を描く(前の文は小さく、今の文は大きく、まだ話していない文は薄く。話し終わった後は全部を同じ大きさで) */
  const renderReply = (v) => {
    const root = document.documentElement.classList;
    const { hide, next } = captionView(v, { onlyNow: root.contains('tv-mode') || root.contains('kb-tight') });
    if (hide) {
      hideCaption(); // 1 文目の文字送りの始まり(まだ 1 字も無い)・まだ話していない文だけの時のテレビ表示
      return;
    }
    // 文字は textContent だけで入れる
    const now = v.current || next ? [span('cap-now', v.current ?? '')] : [];
    if (next) now[0].append(span('cap-next', next)); // B3: 今の文の続きに、薄く並べる(同じ段落で読める)
    caption.replaceChildren(...(v.prev ? [span('cap-prev', v.prev)] : []), ...now);
    caption.className = `caption reply${v.settled ? ' settled' : ''}`;
    caption.hidden = false;
    // 長い時は、今の文が見えるように(まだ話していない文は下に続く)
    const cur = caption.querySelector('.cap-now');
    caption.scrollTop = next && cur ? Math.max(0, cur.offsetTop - caption.offsetTop - 4) : caption.scrollHeight;
  };
  const setCaption = (text, hideAfterMs = 0, kind = '') => {
    clearTimeout(captionTimer);
    const v = flow.caption(text, hideAfterMs, kind);
    if (v.hide) {
      if (v.afterMs > 0) captionTimer = setTimeout(hideCaption, v.afterMs);
      else hideCaption();
      return;
    }
    if (v.reply) {
      renderReply(v);
      return;
    }
    caption.textContent = v.text;
    caption.className = `caption ${v.kind}`.trim();
    caption.hidden = false;
  };

  /** Claude が見た店のデータ(どの情報を、いつ更新された物として使ったか)を、考えの窓と字幕の上の札に出す */
  const showShop = (ev) => {
    if (!ev.shopLabel) return; // 店のデータを渡していない回
    const row = $('tShopRow');
    if (row) row.hidden = false; // 店のデータの行は、使った時だけ出す(ゆるキャラの会話では出ない)
    const used = ev.sources ?? [];
    if (!used.length) {
      els.shop.textContent = ev.handoff ? `使わず、スタッフへ(${ev.shopLabel})` : `使っていない(${ev.shopLabel})`;
      return;
    }
    const note = (s) => `${s.updatedAt} 更新${s.stale ? '・古い可能性' : ''}`;
    const chip = (s) => {
      const el = document.createElement('span');
      el.className = `src${s.stale ? ' stale' : ''}`;
      el.append(s.label, Object.assign(document.createElement('small'), { textContent: note(s) }));
      return el;
    };
    els.shop.replaceChildren(...used.map(chip), Object.assign(document.createElement('small'), { className: 'src-label', textContent: ev.shopLabel }));
    badge.textContent = `店のデータを見て答えています: ${used.map((s) => `${s.label}(${note(s)})`).join('・')} / ${ev.shopLabel}`;
    badge.hidden = false;
  };

  return {
    /** @param {(next:{user?:string, reply?:string, error?:string})=>void} fn */
    setMirror(fn) {
      mirror = fn;
    },
    /** 見えた様子(こちらで数字から作った言葉)を先に出す */
    scene(text) {
      if (els.seen.dataset.claude !== '1') els.seen.textContent = text || '—';
    },
    userSaid(text) {
      replyParts = [];
      actParts = [];
      els.reply.textContent = '…';
      els.act.textContent = '—';
      els.intent.textContent = '…';
      els.seen.dataset.claude = '';
      els.shop.textContent = '—';
      badge.hidden = true;
      if (text) setCaption(text, 4000, 'user');
      mirror?.({ user: text ?? '', reply: '', error: '' });
    },
    thought(ev) {
      if (ev.seen) {
        els.seen.textContent = ev.seen;
        els.seen.dataset.claude = '1';
      }
      const tag = document.createElement('span');
      tag.className = `stage-tag${ev.handoff ? ' handoff' : ''}`;
      tag.textContent = ev.handoff ? `人へつなぐ${ev.reason ? `(${REASON_LABEL[ev.reason] ?? ev.reason})` : ''}` : (STAGE_LABEL[ev.stage] ?? ev.stage);
      els.intent.replaceChildren(tag, document.createTextNode(ev.intent || '未確認'));
      showShop(ev);
    },
    /** B3(第 12 波 b): 返事の文が届いた(まだ話していない)。字幕に薄く足す(声と口は、話し始めた時の say のまま) */
    sayAhead(ev) {
      const v = flow.ahead(ev?.text);
      if (!v) return;
      clearTimeout(captionTimer);
      renderReply(v);
    },
    say(ev) {
      replyParts.push(ev.text);
      flow.say(ev.text); // 字幕: この文を話し始めた(前の文は残す)
      actParts.push(actWords(ev)); // 中の名前(happy / bow / person)でなく、日本語で
      els.reply.textContent = replyParts.join('');
      mirror?.({ reply: replyParts.join(''), error: '' });
      els.act.replaceChildren(...actParts.flatMap((t, i) => (i ? [document.createElement('br'), document.createTextNode(t)] : [document.createTextNode(t)])));
    },
    caption: setCaption,
    /** よくある質問のボタン。押すと onPick に言葉が渡る。emphasis で目立たせる(聞き取れなかったとき) */
    choices(items, onPick, emphasis = false) {
      const box = $('choices');
      box.hidden = !items?.length;
      box.classList.toggle('emphasis', emphasis);
      box.replaceChildren(
        ...(items ?? []).map((label) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.addEventListener('click', () => onPick(label));
          return b;
        }),
      );
    },
    /** AR の位置合わせの案内。null で隠す。bad は、食い違いが大きいときの色 */
    align(text, bad = false) {
      const el = $('align');
      el.hidden = !text;
      el.textContent = text ?? '';
      el.classList.toggle('bad', bad);
    },
    /** VR・AR を頼んでから入るか断られるまでの、画面の真ん中の知らせ(ブラウザの「許可する」を待つ間)。null で隠す。文字は textContent だけで入れる */
    xrWait(text) {
      const el = $('xrWait');
      if (!el) return;
      el.hidden = !text;
      el.textContent = text ?? '';
    },
    error(message) {
      els.reply.textContent = `エラー: ${message}`;
      mirror?.({ error: `エラー: ${message}` });
      setCaption(null);
    },
    foot(text) {
      els.foot.textContent = text;
    },
    chips(items) {
      $('chips').replaceChildren(
        ...items.map(([label, value, tone]) => {
          const s = document.createElement('span');
          s.className = `chip ${tone ?? ''}`.trim();
          const b = document.createElement('b');
          b.textContent = value;
          s.append(`${label} `, b);
          return s;
        }),
      );
    },
    privacy(text, off = false) {
      $('privacyText').textContent = text;
      $('privacy').classList.toggle('off', off);
    },
    /** 仮の頭脳で話している時の知らせ(K5)。null で隠す。文字は textContent だけで入れる */
    brainNotice(text) {
      const el = $('brainNotice');
      if (!el) return;
      el.hidden = !text;
      el.textContent = text ?? '';
    },
    /**
     * 会話の側(Dialogue)からの短い知らせ(鍵らしい文字を送らなかった、など)。数秒で消える。
     * 仮の頭脳の知らせと同じ文は、字幕の上にもう出ているので重ねない。文字は textContent だけで入れる
     */
    notice(text) {
      const el = $('uiNotice');
      const brain = $('brainNotice');
      if (!el || !text || (brain && !brain.hidden && brain.textContent === text)) return;
      clearTimeout(noticeTimer);
      el.textContent = text;
      el.hidden = false;
      noticeTimer = setTimeout(() => {
        el.hidden = true;
      }, NOTICE_MS);
    },
  };
}

/* ---------- 「VR(Quest)で開く」(本人の案 11/7。決まりは web/src/stage/questLink.js) ---------- */
/**
 * 上の段の小さなボタンと、押すと出る箱。箱には、この画面の QR(Quest 3・3S の QR コードスキャナーで読む)と、同じ URL の文字
 * (スキャナーの無い Quest では手で入れる)と、https の時は「Meta Quest に送る」(Meta 公式のウェブローンチを新しいタブで開く。
 * 本人の答え、11/7)。この PC・家の中のアドレスなら 1 行だけ。
 * 閉じるのは、ボタンをもう一度・箱を押す・外を押す・Escape(「Meta Quest に送る」を押しても閉じない)。開くたびに plan() を読む(その時の舞台の子と見た目)。
 * QR の部品(stage/qrCode.js)は、初めて開いた時に読む(最初の読み込みを軽くする)。文字は textContent だけで入れる。
 * @param {{root: HTMLElement, button: HTMLButtonElement, box: HTMLElement, plan: () => {show: boolean, kind: string, target?: string, launch?: string, note?: string},
 *   onToggle?: (open: boolean) => void, loadQr?: () => Promise<{encodeQr: Function, qrPath: Function}>}} o
 * @returns {{open(): void, close(focusButton?: boolean): void, readonly isOpen: boolean}}
 */
export function mountQuestLink({ root, button, box, plan, onToggle = () => {}, loadQr = () => import('../stage/qrCode.js') }) {
  const doc = root.ownerDocument;
  let opened = false;
  let renderId = 0;
  const el = (tag, className, text) => Object.assign(doc.createElement(tag), { className, textContent: text ?? '' });

  // SVG の名前空間は、ボタンの印(index.html の <svg>。ブラウザが名前空間を付ける)から読む。画面のコードには、外の住所の形の文字を
  // 書かない決まり(web/test/privacy.test.mjs)。印が無い時は QR を描かず、URL の文字だけにする
  const svgNs = button.querySelector('svg')?.namespaceURI ?? null;

  /** QR の絵(SVG。白い地と 4 マスの縁・暗いマスの 1 本の path。外の画像は使わない) */
  const qrSvg = (matrix, qrPath) => {
    const { d, view } = qrPath(matrix);
    const svg = doc.createElementNS(svgNs, 'svg');
    const attrs = { viewBox: `0 0 ${view} ${view}`, class: 'ql-qr', role: 'img', 'aria-label': 'この画面を開く QR コード', 'shape-rendering': 'crispEdges' };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    const bg = doc.createElementNS(svgNs, 'rect');
    bg.setAttribute('width', String(view));
    bg.setAttribute('height', String(view));
    bg.setAttribute('fill', '#fff');
    const path = doc.createElementNS(svgNs, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000');
    svg.append(bg, path);
    return svg;
  };

  /**
   * 「Meta Quest に送る」: 決まりの launch(ウェブローンチ。questLink.js が作る)だけを新しいタブで開くリンク。
   * この頁の URL(合言葉・番号が入りうる)は Referer で送らない。押しても箱は閉じない(送った後も QR と URL を見られる)
   */
  const sendLink = (href) => {
    const a = el('a', 'ql-send', SEND_LABEL);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.referrerPolicy = 'no-referrer';
    a.setAttribute('aria-label', SEND_NAME);
    a.title = SEND_NAME;
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  };

  async function render() {
    const id = ++renderId;
    const p = plan();
    box.dataset.kind = p.kind;
    delete box.dataset.target;
    if (p.kind !== 'qr') {
      box.replaceChildren(el('p', 'ql-note', p.note ?? ''));
      return;
    }
    box.replaceChildren(el('p', 'ql-note', 'QR を作っています…'));
    const lib = await loadQr().catch(() => null);
    if (id !== renderId) return; // 作っている間に閉じた・開き直した
    const qr = svgNs ? (lib?.encodeQr(p.target) ?? null) : null;
    const text = el('div', 'ql-text');
    text.append(el('p', 'ql-title', 'VR(Quest)で開く'), el('p', 'ql-how', qr ? SCAN_HOW : NO_QR_NOTE), el('p', 'ql-url', p.target));
    if (p.launch) text.append(sendLink(p.launch)); // https の公開の URL の時だけ(決まりは questLink.js)
    box.replaceChildren(...(qr ? [qrSvg(qr.matrix, lib.qrPath)] : []), text);
    box.dataset.target = p.target; // QR に入れた文(確かめの道具が読む。画面に出す URL と同じ)
  }

  function open() {
    if (opened) return;
    opened = true;
    box.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    onToggle(true);
    void render();
    box.focus({ preventScroll: true });
  }

  function close(focusButton = false) {
    if (!opened) return;
    opened = false;
    renderId += 1;
    box.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    onToggle(false);
    if (focusButton) button.focus({ preventScroll: true });
  }

  button.addEventListener('click', () => (opened ? close() : open()));
  box.addEventListener('click', () => close(true)); // 箱を押すと閉じる(指で 1 回)
  doc.addEventListener('pointerdown', (e) => {
    if (opened && !root.contains(e.target)) close();
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (opened && e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
  });
  return {
    open,
    close,
    get isOpen() {
      return opened;
    },
  };
}
