// 画面の部品: 「Claude の考え」の窓・字幕・上の小さな状態表示。
const $ = (id) => document.getElementById(id);

const STAGE_LABEL = {
  greet: '声かけ',
  need: '用件',
  guide: '案内',
  handoff: '人へつなぐ',
  chat: '雑談',
};

export function createUi() {
  const caption = $('caption');
  const els = {
    seen: $('tSeen'),
    intent: $('tIntent'),
    reply: $('tReply'),
    act: $('tAct'),
    foot: $('tFoot'),
  };
  let captionTimer = null;
  let replyParts = [];
  let actParts = [];

  // 狭い画面では、最初は畳んでおく(字幕と顔を隠さないため)
  if (window.matchMedia('(max-width: 640px)').matches) {
    $('thought').classList.add('collapsed');
    $('thoughtToggle').setAttribute('aria-expanded', 'false');
  }
  $('thoughtToggle').addEventListener('click', () => {
    const box = $('thought');
    box.classList.toggle('collapsed');
    $('thoughtToggle').setAttribute('aria-expanded', String(!box.classList.contains('collapsed')));
  });

  const setCaption = (text, hideAfterMs = 0, kind = '') => {
    clearTimeout(captionTimer);
    if (!text) {
      if (hideAfterMs > 0) captionTimer = setTimeout(() => (caption.hidden = true), hideAfterMs);
      else caption.hidden = true;
      return;
    }
    caption.textContent = text;
    caption.className = `caption ${kind}`.trim();
    caption.hidden = false;
  };

  return {
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
      if (text) setCaption(text, 4000, 'user');
    },
    thought(ev) {
      if (ev.seen) {
        els.seen.textContent = ev.seen;
        els.seen.dataset.claude = '1';
      }
      const tag = document.createElement('span');
      tag.className = `stage-tag${ev.handoff ? ' handoff' : ''}`;
      tag.textContent = ev.handoff ? '人へつなぐ' : (STAGE_LABEL[ev.stage] ?? ev.stage);
      els.intent.replaceChildren(tag, document.createTextNode(ev.intent || '未確認'));
    },
    say(ev) {
      replyParts.push(ev.text);
      actParts.push(`${ev.expression} / ${ev.motion} / ${ev.gaze}`);
      els.reply.textContent = replyParts.join('');
      els.act.replaceChildren(...actParts.flatMap((t, i) => (i ? [document.createElement('br'), document.createTextNode(t)] : [document.createTextNode(t)])));
    },
    caption: setCaption,
    error(message) {
      els.reply.textContent = `エラー: ${message}`;
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
  };
}
