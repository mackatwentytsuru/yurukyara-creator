// 性格の画面(最初の設計の決め)。型(おっとり・元気・いたずら好き・恥ずかしがり屋)・口調・元気さ・返事の長さ・声を選び、
// その場で返事を試す。仮の頭脳のときは、変えるたびに自動で試す(お金がかからない)。本物の頭脳のときは「返事を試す」を押した時だけ。
// 文字は textContent だけで入れる。語尾の入力は settings.js の cleanEnding で確かめる。
import { injectStyles } from '../onboarding/styles.js';
import {
  ENERGY_LABELS, LENGTH_ORDER, LENGTHS, PITCHES, PRESET_ORDER, PRESETS, RATES, TONE_ORDER, TONES, VOICE_ORDER, VOICES,
  applyPreset, cleanEnding, normalize, personaBlock, pitchKey, rateKey,
} from './settings.js';
import { VOICE_ROLE_ORDER, VOICE_ROLES, voiceRoleNote } from './voiceChoice.js';
import { ROLES, ROLE_CHIPS } from '../onboarding/roles.js';
import { LANG_MODES, LANG_MODE_LABELS, LANG_MODE_NOTE } from '../../conversation/lang.js'; // ML1: ことば
import { FACTS_SCREEN_MAX } from '../../conversation/facts.js'; // ML1: お店のきまり・お知らせ
import { SHOP_DEVICE_LABELS, SHOP_DEVICE_NOTE, SHOP_FORGET_LABEL } from '../../conversation/shopDevice.js'; // ML1: この端末

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return n;
};

/** 押しボタンの組(1 つだけ選ぶ)。役割は radio(読み上げにも伝わる) */
function segmented(label, entries, current, onPick, { className = 'yp-seg', withHint = false } = {}) {
  const box = el('div', { className, role: 'radiogroup', ariaLabel: label });
  const buttons = entries.map(([key, item]) => {
    const b = el(
      'button',
      { type: 'button', className: withHint ? 'yp-choice' : '', role: 'radio' },
      withHint ? el('b', { textContent: item.label }) : item.label,
      withHint && item.hint ? el('small', { textContent: item.hint }) : null,
    );
    if (!withHint) b.textContent = item.label;
    b.dataset.key = key;
    b.addEventListener('click', () => onPick(key));
    return b;
  });
  box.append(...buttons);
  const sync = (value) => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === value)));
  sync(current);
  return { box, sync };
}

/**
 * @param {object} o
 * @param {object} o.initial いまの設定
 * @param {string} [o.characterName]
 * @param {()=>object} o.random おまかせの設定を作る
 * @param {(settings:object, text:string)=>Promise<{text:string, brain:string, notice?:string}>} o.preview 返事を試す
 * @param {(text:string, settings:object, el:HTMLElement)=>Promise<void>} [o.play] 返事を出す(文字送り・声)
 * @param {()=>string} [o.brain] 'mock' | 'haiku'(仮の頭脳なら自動で試す)
 * @param {(settings:object)=>void} o.onSave
 * @param {()=>void} [o.onCancel]
 * @param {HTMLElement} [o.parent]
 * @param {boolean} [o.lockTone] 人格の文で話し方が決まっている子(主役ノリーなど)。口調は「この子の話し方」から動かさない(D6)
 * @param {(role:string)=>({choice:string, role:string|null, own:string|null}|null)} [o.onVoiceRole] 声の役(おまかせ・男の子・女の子)を
 *   選んだ時に、舞台の読み上げへ渡す(試しの返事もその声で話す)。返り値は今の役(声の下の一言に出す)。「もどす」では元の役で呼び直す
 * @param {{isOn:()=>boolean, set:(on:boolean)=>any, forgetNow:()=>Promise<{message:string}>}|null} [o.shopDevice] ML1: この端末(お店の端末か)。
 *   端末ごとの設定なので、押すとすぐ変わる(「これにする」を待たない)。渡さなければ、この枠は出さない
 */
export function openPersonaPanel({ initial, characterName = 'この子', random, preview, play, brain = () => 'mock', onSave, onCancel = () => {}, parent = document.body, lockTone = false, onVoiceRole = null, recommended = null, shopDevice = null }) {
  injectStyles(parent.ownerDocument);
  // 話し方の決まった子は、口調をいつも own にする(覚えた設定・おまかせ・古い保存でも。「これにする」で主役の話し方を上書きしない)
  const fix = (v) => (lockTone ? normalize({ ...normalize(v), tone: 'own', ending: '' }) : normalize(v));
  let s = fix(initial);
  let tries = 0;
  let timer = null;
  const back = el('div', { className: 'yp-back' });
  const panel = el('section', { className: 'yp-panel', role: 'dialog', ariaModal: 'true', ariaLabel: `${characterName}の性格` });
  back.append(panel);

  const presets = segmented('性格', PRESET_ORDER.map((k) => [k, { label: PRESETS[k].label, hint: PRESETS[k].text.split('。')[0] }]), s.preset, (k) => update(applyPreset(s, k)), { className: 'yp-presets', withHint: true });
  // 口調は 4 つ(この子の話し方・フレンドリー・ていねい・独特の語尾)。スマホでは 2 つずつ 2 段に並べる(.yp-tones)
  const tone = segmented('口調', TONE_ORDER.map((k) => [k, TONES[k]]), s.tone, (k) => {
    if (lockTone) return; // 話し方の決まった子は変えない(ボタンも押せない)
    if (k === 'ending') update({ ...s, tone: 'ending', ending: s.ending || endingIn.value || 'にゃ' });
    else update({ ...s, tone: k });
  }, { className: 'yp-seg yp-tones' });
  // 話し方の決まった子: 口調の列を「この子の話し方」で止め、理由を書く(司令塔の決め D6・CRITux 11)
  const toneLock = el('p', { className: 'yp-note yp-tone-lock', textContent: `${characterName}の話し方は、この子の人格の文で決まっています(一人称や文の終わり)。ここでは変えられません。性格・元気さ・長さ・声は変えられます。` });
  toneLock.hidden = !lockTone;
  if (lockTone) {
    tone.box.dataset.locked = 'true';
    for (const b of tone.box.querySelectorAll('button')) {
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
    }
  }
  const endingIn = el('input', { type: 'text', className: 'yp-ending-in', maxLength: 8, placeholder: '例: にゃ', autocomplete: 'off', value: s.ending || '' });
  const endingMsg = el('span', { className: 'yp-note', textContent: 'ひらがな・カタカナで 4 字まで' });
  const endingRow = el('label', { className: 'yp-ending', hidden: s.tone !== 'ending' }, el('span', { textContent: '語尾' }), endingIn);
  endingIn.addEventListener('input', () => {
    const ok = cleanEnding(endingIn.value);
    endingMsg.textContent = ok ? `「${ok}」を文の終わりに付けます` : 'ひらがな・カタカナで 4 字まで';
    if (ok) update({ ...s, tone: 'ending', ending: ok });
  });

  const energyIn = el('input', { type: 'range', min: 1, max: 5, step: 1, value: s.energy, ariaLabel: '元気さ' });
  const energyOut = el('output', { textContent: `${s.energy} ${ENERGY_LABELS[s.energy]}` });
  energyIn.addEventListener('input', () => update({ ...s, energy: Number(energyIn.value) }));
  const length = segmented('返事の長さ', LENGTH_ORDER.map((k) => [k, LENGTHS[k]]), s.length, (k) => update({ ...s, length: k }));
  // 役目(この子は、どこで だれと。B4 12b): 作る道の最初に選んだ物を、あとからここで替えられる
  const where = segmented('どこで だれと', ROLES.map((k) => [k, { label: ROLE_CHIPS[k] }]), s.role, (k) => update({ ...s, role: k }), { className: 'yp-seg yp-where' });
  // ことば(ML1): 日本語だけ(いつもの)・多言語。下に 1 行「日本語だけの方が、日本語の聞き取りと話し方が正確です」
  const lang = segmented('ことば', LANG_MODES.map((k) => [k, { label: LANG_MODE_LABELS[k] }]), s.lang, (k) => update({ ...s, lang: k }), { className: 'yp-seg yp-two yp-lang' });
  const langNote = el('p', { className: 'yp-note yp-lang-note', textContent: LANG_MODE_NOTE });
  // お店のきまり・お知らせ(ML1): お店・駅や町・学校や施設の時だけ出す、日本語で書く欄。その端末の中だけに覚える
  const factsIn = el('textarea', { className: 'yp-facts-in', rows: 5, maxLength: FACTS_SCREEN_MAX, placeholder: '例:\n営業時間は 9 時から 17 時\n定休日は水曜日\n秋まつりは 11 月 23 日', ariaLabel: 'お店のきまり・お知らせ', value: s.facts ?? '' });
  const factsCount = el('output', { className: 'yp-facts-count', ariaLive: 'off' });
  const factsGroup = el(
    'fieldset',
    { className: 'yp-group yp-facts', hidden: s.role === 'home' },
    el('legend', { textContent: 'お店のきまり・お知らせ' }),
    factsIn,
    el('p', { className: 'yp-note', textContent: 'お客さんに伝えたいことを、日本語で 1 行ずつ書いてね。ここに書いたことだけを案内します(書いていないことは「スタッフに聞いてね」と言います)。この端末の中だけに覚えます。' }),
    factsCount,
  );
  factsIn.addEventListener('input', () => update({ ...s, facts: factsIn.value }));
  const showFactsCount = () => {
    factsCount.textContent = `${[...(factsIn.value ?? '')].length} / ${FACTS_SCREEN_MAX} 字`;
  };
  // この端末(ML1): ふつう(覚える)・お店の端末(お客さんの名前を覚えない)。端末ごとの設定なので、押すとすぐ変わる
  const shopOn = () => Boolean(shopDevice?.isOn());
  const shop = shopDevice
    ? segmented('この端末', [['normal', { label: SHOP_DEVICE_LABELS.normal }], ['shop', { label: SHOP_DEVICE_LABELS.shop }]], shopOn() ? 'shop' : 'normal', (k) => {
        shopDevice.set(k === 'shop');
        syncShop();
      }, { className: 'yp-seg yp-two yp-shop' })
    : null;
  const shopForget = shopDevice ? el('button', { type: 'button', className: 'yp-forget', textContent: SHOP_FORGET_LABEL }) : null;
  const shopNote = shopDevice ? el('p', { className: 'yp-note yp-shop-note', textContent: SHOP_DEVICE_NOTE, ariaLive: 'polite' }) : null;
  const shopGroup = shopDevice ? el('fieldset', { className: 'yp-group yp-shop-group' }, el('legend', { textContent: 'この端末' }), shop.box, shopNote, shopForget) : null;
  function syncShop() {
    if (!shopDevice) return;
    shop.sync(shopOn() ? 'shop' : 'normal');
    shopForget.hidden = !shopOn();
  }
  shopForget?.addEventListener('click', async () => {
    shopForget.disabled = true;
    try {
      shopNote.textContent = (await shopDevice.forgetNow()).message;
    } catch {
      shopNote.textContent = '消せませんでした。もう一度おしてね';
    } finally {
      shopForget.disabled = false;
    }
  });
  let roleResult = null;
  const showRoleNote = (k) => { roleNote.textContent = voiceRoleNote(roleResult, k, s.voice.provider); };
  const voices = segmented('声の出し方', VOICE_ORDER.map((k) => [k, VOICES[k]]), s.voice.provider, (k) => { update({ ...s, voice: { ...s.voice, provider: k } }); showRoleNote(s.voice.role); }, { className: 'yp-voices', withHint: true });
  const pitch = segmented('声の高さ', Object.entries(PITCHES), pitchKey(s), (k) => update({ ...s, voice: { ...s.voice, pitch: PITCHES[k].value } }));
  const rate = segmented('話す速さ', Object.entries(RATES), rateKey(s), (k) => update({ ...s, voice: { ...s.voice, rate: RATES[k].value } }));
  // 声の役(おまかせ = この子の役。11/7 第 11 波): 選ぶと、すぐ舞台の読み上げに渡す(試しの返事もその声)
  const role = segmented('声の役', VOICE_ROLE_ORDER.map((k) => [k, VOICE_ROLES[k]]), s.voice.role, (k) => {
    update({ ...s, voice: { ...s.voice, role: k } });
    roleResult = onVoiceRole?.(k) ?? null;
    showRoleNote(k);
  }, { className: 'yp-seg yp-roles' });
  const roleNote = el('p', { className: 'yp-note yp-role-note', ariaLive: 'polite' });
  const startRole = s.voice.role;

  const tryIn = el('input', { type: 'text', className: 'yp-try-in', maxLength: 60, value: 'はじめまして!', ariaLabel: '試しに話しかける言葉' });
  const tryBtn = el('button', { type: 'button', className: 'yp-try-btn', textContent: '返事を試す' });
  const replyName = el('span', { className: 'yp-reply-name', textContent: characterName });
  const replyText = el('span', { className: 'yp-reply-text' });
  const reply = el('p', { className: 'yp-reply', ariaLive: 'polite' }, replyName, replyText);
  const note = el('p', { className: 'yp-note yp-brain-note' });
  const block = el('pre', { className: 'yp-block' });
  // くじびき: 性格を くじで選び直す(画面は閉じない)。上の「おまかせ(ぜんぶ じどう)」と同じ名前にしない(押した後が違うので。11/7 S4w11d)
  const randomBtn = el('button', { type: 'button', className: 'yp-random', textContent: 'くじびき', title: '性格を くじで えらびなおします(この画面は とじません)' });
  const saveBtn = el('button', { type: 'button', className: 'yp-save', textContent: 'これにする' });
  const cancelBtn = el('button', { type: 'button', className: 'yp-cancel', textContent: 'もどす(閉じる)' });
  // おまかせ(ぜんぶ じどう): この子のおすすめの性格と、声の役「おまかせ」で決めて、すぐ閉じる(本人 11/7。あとから変えられる)
  const autoBtn = el('button', { type: 'button', className: 'yp-auto', textContent: 'おまかせ(ぜんぶ じどう)' });
  const autoNote = el('p', { className: 'yp-note yp-auto-note', textContent: 'えらぶ所は 6 つ(性格・口調・元気さ・長さ・どこで だれと・声)。ぜんぶ えらばなくても だいじょうぶ。おまかせなら 1 回で おわります(あとから いつでも かえられます)。' });

  // 返事の試しは上に置き、下の設定を選んでいる間も見えるようにする(スマホでは上に貼りつく)
  panel.append(
    el('h2', { textContent: `${characterName}の性格` }),
    el('p', { className: 'yp-lead', textContent: '選ぶと、すぐ上の返事が変わります。' }),
    // BSF(11-08 安全): 付けられない性格を 1 行で(人格の文のその行は、サーバーの安全の層が外す。safety.mjs の CLINGY_PERSONA)
    el('p', { className: 'yp-note yp-safety-note', textContent: '恋人の役・ひとりじめ・ひきとめる性格は、つけられません(安全のきまりが先に効きます)。' }),
    el('div', { className: 'yp-auto-row' }, autoBtn, autoNote),
    el('div', { className: 'yp-try' }, el('div', { className: 'yp-try-row' }, tryIn, tryBtn), reply, note),
    el('fieldset', { className: 'yp-group' }, el('legend', { textContent: '性格' }), presets.box),
    el('fieldset', { className: 'yp-group' }, el('legend', { textContent: '口調' }), tone.box, toneLock, endingRow, endingMsg),
    el('div', { className: 'yp-group' }, el('div', { className: 'yp-label yp-energy-head' }, el('span', { textContent: '元気さ' }), energyOut), el('div', { className: 'yp-energy' }, energyIn)),
    el('fieldset', { className: 'yp-group' }, el('legend', { textContent: '返事の長さ' }), length.box),
    el('fieldset', { className: 'yp-group' }, el('legend', { textContent: 'どこで だれと' }), where.box),
    factsGroup,
    el('fieldset', { className: 'yp-group yp-lang-group' }, el('legend', { textContent: 'ことば' }), lang.box, langNote),
    el(
      'fieldset',
      { className: 'yp-group' },
      el('legend', { textContent: '声' }),
      voices.box,
      el('div', { className: 'yp-sub' }, el('span', { textContent: '高さ' }), pitch.box),
      el('div', { className: 'yp-sub' }, el('span', { textContent: '速さ' }), rate.box),
      el('div', { className: 'yp-sub yp-role' }, el('span', { textContent: '声の役' }), role.box),
      roleNote,
    ),
    shopGroup,
    el('details', {}, el('summary', { textContent: 'Claude に渡す文を見る' }), block),
    el('div', { className: 'yp-foot' }, randomBtn, cancelBtn, saveBtn),
  );

  function sync() {
    presets.sync(s.preset);
    tone.sync(s.tone);
    endingRow.hidden = s.tone !== 'ending';
    endingMsg.hidden = s.tone !== 'ending';
    if (s.tone === 'ending' && document.activeElement !== endingIn) endingIn.value = s.ending;
    energyIn.value = String(s.energy);
    energyOut.textContent = `${s.energy} ${ENERGY_LABELS[s.energy]}`;
    length.sync(s.length);
    where.sync(s.role);
    lang.sync(s.lang);
    factsGroup.hidden = s.role === 'home'; // おうちの役目では使わない(お店・駅や町・学校や施設の時だけ出す)
    if (document.activeElement !== factsIn) factsIn.value = s.facts ?? '';
    showFactsCount();
    syncShop();
    voices.sync(s.voice.provider);
    pitch.sync(pitchKey(s));
    rate.sync(rateKey(s));
    role.sync(s.voice.role);
    block.textContent = personaBlock(s);
    panel.dataset.preset = s.preset;
  }

  async function runPreview() {
    const n = ++tries;
    tryBtn.disabled = true;
    replyText.textContent = '…';
    try {
      const r = await preview(s, tryIn.value.trim() || 'はじめまして!');
      if (n !== tries) return;
      note.textContent = r.notice ?? '';
      panel.dataset.brain = r.brain;
      if (play) await play(r.text, s, replyText);
      else replyText.textContent = r.text;
      if (n === tries) panel.dataset.previewed = String(n);
    } catch (err) {
      if (n === tries) replyText.textContent = `試せませんでした(${err.message})`;
    } finally {
      if (n === tries) tryBtn.disabled = false;
    }
  }

  function update(next) {
    s = fix(next);
    sync();
    if (brain() === 'mock') {
      clearTimeout(timer);
      timer = setTimeout(runPreview, 250);
    } else {
      note.textContent = '本物の頭脳です。「返事を試す」を押すと Claude に聞きます(1 回分の利用になります)。';
    }
  }

  tryBtn.addEventListener('click', runPreview);
  randomBtn.addEventListener('click', () => update({ ...random(), voice: s.voice }));
  panel.dataset.toneLocked = String(lockTone);
  const close = () => {
    clearTimeout(timer);
    tries += 1;
    back.remove();
  };
  saveBtn.addEventListener('click', () => {
    close();
    onSave(fix(s));
  });
  autoBtn.addEventListener('click', () => {
    const rec = normalize(recommended?.() ?? initial);
    const next = fix({ ...rec, voice: { ...rec.voice, role: 'auto' } });
    if (s.voice.role !== 'auto') onVoiceRole?.('auto');
    close();
    onSave(next);
  });
  cancelBtn.addEventListener('click', () => {
    close();
    if (s.voice.role !== startRole) onVoiceRole?.(startRole); // 選んだ声の役を、開いた時の役に戻す
    onCancel();
  });
  back.addEventListener('click', (e) => {
    if (e.target === back) cancelBtn.click();
  });

  sync();
  roleResult = onVoiceRole?.(s.voice.role) ?? null;
  showRoleNote(s.voice.role);
  parent.append(back);
  if (brain() === 'mock') runPreview();
  else note.textContent = '本物の頭脳です。「返事を試す」を押すと Claude に聞きます(1 回分の利用になります)。';
  saveBtn.focus({ preventScroll: true });
  return { element: panel, close, get settings() { return fix(s); }, preview: runPreview };
}
