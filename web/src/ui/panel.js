// 画面の部品: 「Claude の考え」の窓・字幕・上の小さな状態表示。
const $ = (id) => document.getElementById(id);

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

  const badge = $('shopBadge');
  const hideCaption = () => {
    caption.hidden = true;
    badge.hidden = true; // 参照した情報の札は、返事の字幕と一緒に消える
  };
  const setCaption = (text, hideAfterMs = 0, kind = '') => {
    clearTimeout(captionTimer);
    if (!text) {
      if (hideAfterMs > 0) captionTimer = setTimeout(hideCaption, hideAfterMs);
      else hideCaption();
      return;
    }
    caption.textContent = text;
    caption.className = `caption ${kind}`.trim();
    caption.hidden = false;
  };

  /** Claude が見た店のデータ(どの情報を、いつ更新された物として使ったか)を、考えの窓と字幕の上の札に出す */
  const showShop = (ev) => {
    if (!ev.shopLabel) return; // 店のデータを渡していない回
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
    say(ev) {
      replyParts.push(ev.text);
      actParts.push(`${ev.expression} / ${ev.motion} / ${ev.gaze}`);
      els.reply.textContent = replyParts.join('');
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
