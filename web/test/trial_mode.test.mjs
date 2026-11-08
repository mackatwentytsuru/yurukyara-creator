// おためしモード(鍵も Claude Code も無く、決まった台本で話す間)の見せ方の試験。画面なしの部品の決まりと、文・置き場所を読んで確かめる。
// 画面での確かめ(幅 390x844 と 1280x720、鍵あり・なし、接客モード)は trial_mode_browser.test.mjs。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TRIAL_BANNER_BUTTON,
  TRIAL_BANNER_TEXT,
  TRIAL_GATE_LINE,
  TRIAL_KIOSK_LABEL,
  TRIAL_KIOSK_STAFF_LINE,
  mountTrialMode,
  trialView,
} from '../src/ui/trialMode.js';
import { HIDDEN, SHOWN } from '../src/stage/kioskMode.js';
import { FALLBACK_BRAIN_NOTICE, FAKE_BRAIN_LATENCY_NOTE } from '../src/ui/panel.js';
import { MOCK_NOTICE, MOCK_NOTICE_SHORT } from '../src/ui/persona/preview.js';
import { MOCK_NOTE } from '../src/ui/onboarding/script.js';
import { CAMERA_MOCK_NOTE, CAMERA_PRIVACY_BACK_MOCK, CAMERA_PRIVACY_MOCK } from '../src/stage/cameraSwitch.js';
import { CAMERA_MOCK_LINES } from '../server/camera.mjs';
import { BRAIN_ERROR_NOTICE } from '../server/brain.mjs';

const WEB = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(WEB, p), 'utf8');

test('決まった文: 本人の言った言い方のまま', () => {
  assert.equal(TRIAL_BANNER_TEXT, 'おためしモード:Claude の鍵が入っていないので、決まった台本で話しています');
  assert.equal(TRIAL_BANNER_BUTTON, '本物の Claude にする');
  assert.equal(TRIAL_GATE_LINE, 'いまは おためしモード(本物の会話には、鍵か Claude Code が要ります)');
  assert.equal(TRIAL_KIOSK_LABEL, 'おためしモード(本物の会話ではありません)');
  assert.match(TRIAL_KIOSK_STAFF_LINE, /^おためしモードです。/);
  assert.match(TRIAL_KIOSK_STAFF_LINE, /Claude の鍵/);
  assert.match(TRIAL_KIOSK_STAFF_LINE, /Claude Code/);
  assert.match(TRIAL_KIOSK_STAFF_LINE, /この PC で/);
});

test('どこに出すか: 帯は「鍵が無いだけ」の時、入口の 1 行は手元のサーバーが鍵なしと言う時、接客は入口の知らせと札', () => {
  const none = { banner: false, gateLine: false, kioskStaff: false, kioskLabel: false };
  assert.deepEqual(trialView({}), none, 'まだ分からない間は何も出さない');
  assert.deepEqual(trialView({ brain: 'haiku', statusBrain: 'haiku' }), none, '鍵(か Claude Code)がつながっていれば、何も出さない');
  assert.deepEqual(trialView({ brain: 'haiku', statusBrain: 'haiku', kiosk: true }), none, '接客でも、本物なら何も出さない');
  assert.deepEqual(trialView({ brain: 'mock', statusBrain: 'mock' }), { ...none, banner: true, gateLine: true });
  assert.deepEqual(trialView({ brain: 'mock', noticeText: 'おためしモードです(今日の上限に届きました)', statusBrain: 'haiku' }), none, '上限・合言葉などの理由の時は帯を出さない');
  assert.deepEqual(trialView({ brain: 'mock', statusBrain: null }), { ...none, banner: true }, '公開の URL: 入口の 1 行は出さない(頭脳が分からない)');
  assert.deepEqual(trialView({ brain: 'mock', statusBrain: 'mock', kiosk: true }), { ...none, kioskStaff: true, kioskLabel: true }, '接客: 帯と入口の 1 行は出さず、店の人への知らせと来場者の札を出す');
  assert.deepEqual(trialView({ brain: 'mock', noticeText: 'おためしモードです(少し間をあけてから、もう一度どうぞ)', statusBrain: 'haiku', kiosk: true }), { ...none, kioskLabel: true }, '接客: 理由が何でも、台本の間は札を出す');
});

/** DOM の最小のまね(部品が触る所だけ) */
function fakeDoc() {
  const mk = () => ({
    hidden: true, textContent: '', children: [], attrs: {}, listeners: {},
    classList: { s: new Set(), toggle(c, on) { if (on) this.s.add(c); else this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    append(...k) { this.children.push(...k); },
    replaceChildren(...k) { this.children = k; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { this.listeners[t] = f; },
  });
  return { createElement: () => mk(), documentElement: mk(), mk };
}

test('mountTrialMode: 帯・入口の 1 行・接客の入口・札の出し入れ。帯が消えたら案内の窓も閉じる。ボタンで案内を開く', () => {
  const doc = fakeDoc();
  const [banner, gateLine, kioskStaff, label] = [doc.mk(), doc.mk(), doc.mk(), doc.mk()];
  const calls = [];
  const guide = { open: (b) => calls.push(['open', b?.className]), close: () => calls.push(['close']) };
  const trial = mountTrialMode({ doc, banner, gateLine, kioskStaff, label, guide });
  assert.equal(gateLine.textContent, TRIAL_GATE_LINE);
  assert.equal(kioskStaff.textContent, TRIAL_KIOSK_STAFF_LINE);
  assert.equal(label.textContent, TRIAL_KIOSK_LABEL);
  const p = banner.children[0];
  const text = p.children.filter((c) => c.className !== 'tb-btn').map((c) => c.textContent).join('');
  assert.equal(text, TRIAL_BANNER_TEXT);
  const button = p.children.find((c) => c.className === 'tb-btn');
  assert.equal(button.textContent, TRIAL_BANNER_BUTTON);
  button.listeners.click();
  assert.deepEqual(calls.at(-1), ['open', 'tb-btn']);
  trial.update(trialView({ brain: 'mock', statusBrain: 'mock' }));
  assert.equal(banner.hidden, false);
  assert.equal(gateLine.hidden, false);
  assert.equal(kioskStaff.hidden, true);
  assert.equal(label.hidden, true);
  assert.equal(doc.documentElement.classList.contains('trial-banner-on'), true);
  trial.update(trialView({ brain: 'haiku', statusBrain: 'haiku' }));
  assert.deepEqual([banner.hidden, gateLine.hidden, kioskStaff.hidden, label.hidden], [true, true, true, true]);
  assert.equal(doc.documentElement.classList.contains('trial-banner-on'), false);
  assert.deepEqual(calls.at(-1), ['close'], '本物に替わったら案内も閉じる');
  trial.update(trialView({ brain: 'mock', statusBrain: 'mock', kiosk: true }));
  assert.deepEqual([banner.hidden, gateLine.hidden, kioskStaff.hidden, label.hidden], [true, true, false, false]);
});

test('index.html: 帯は上の段の先頭、札は字幕の列で AI の表示のすぐ上、入口の 1 行は始めるボタンの下、接客の知らせは接客を はじめるの上', () => {
  const html = read('index.html');
  const top = html.slice(html.indexOf('<header class="top">'), html.indexOf('</header>'));
  assert.ok(top.indexOf('id="trialBanner"') > 0 && top.indexOf('id="trialBanner"') < top.indexOf('id="topMain"'), '帯は上の段の先頭');
  const subs = html.slice(html.indexOf('<div class="subs">'), html.indexOf('id="aiNoticeTop"'));
  assert.ok(subs.indexOf('id="caption"') < subs.indexOf('id="trialLabel"') && subs.indexOf('id="trialLabel"') < subs.indexOf('id="aiNotice"'), '札は字幕と AI の表示の間');
  assert.ok(html.indexOf('id="startCam"') < html.indexOf('id="gateTrial"') && html.indexOf('id="gateTrial"') < html.indexOf('id="passField"'), '入口の 1 行は始めるボタンの下');
  assert.ok(html.indexOf('id="kioskTrial"') < html.indexOf('id="kioskStart"') && html.indexOf('id="kioskLead"') < html.indexOf('id="kioskTrial"'), '接客の知らせは はじめるボタンの上');
  for (const id of ['trialBanner', 'trialLabel', 'gateTrial', 'kioskTrial', 'brainGuide']) assert.match(html, new RegExp(`id="${id}"[^>]*hidden`), `#${id} は最初は隠れている`);
});

test('接客モード: 帯と案内は来場者に隠す(隠す一覧と kiosk.css が同じ)。入口の 1 行は出さない。札は接客の間だけ見える', () => {
  assert.ok(HIDDEN.some((h) => h.selector === '#trialBanner'));
  assert.ok(HIDDEN.some((h) => h.selector === '#brainGuide'));
  assert.ok(!SHOWN.some((s) => s.selector === '#trialLabel'), '札は台本の間だけなので、いつも見せる一覧には入れない');
  const css = read('src/ui/kiosk.css');
  assert.match(css, /html\.is-kiosk #trialBanner,/);
  assert.match(css, /html\.is-kiosk \.gate-trial,/);
  assert.match(css, /html\.is-kiosk \.trial-label:not\(\[hidden\]\) \{\s*display: block;/);
  assert.match(css, /html\.is-kiosk \.kiosk-trial:not\(\[hidden\]\) \{ display: block;/);
  // 接客の札には、案内のボタンもリンクも付けない
  const html = read('index.html');
  assert.match(html, /<p id="trialLabel" class="trial-label" role="status" hidden><\/p>/);
  assert.match(html, /<p class="kiosk-trial" id="kioskTrial" role="note" hidden><\/p>/);
});

test('main.js: 状態を読んだ後に入口の 1 行を出す(fillGate が updateBrainNotice を呼ぶ)。帯は鍵が無いだけの時のみ', () => {
  const main = read('src/main.js');
  const fill = main.slice(main.indexOf('function fillGate()'), main.indexOf('/** 入口を閉じた'));
  assert.match(fill, /updateBrainNotice\(\);/);
  assert.match(main, /const trialMode = mountTrialMode\(\{ banner: \$\('trialBanner'\), gateLine: \$\('gateTrial'\), kioskStaff: \$\('kioskTrial'\), label: \$\('trialLabel'\), guide: brainGuide \}\);/);
});

test('画面に出る言い方は おためしモード: 「仮の頭脳です」「かりの あたま」を画面の文に残さない(コードの名前と記録は別)', () => {
  for (const s of [FALLBACK_BRAIN_NOTICE, FAKE_BRAIN_LATENCY_NOTE, MOCK_NOTICE, MOCK_NOTICE_SHORT, MOCK_NOTE, CAMERA_MOCK_NOTE, CAMERA_PRIVACY_MOCK, CAMERA_PRIVACY_BACK_MOCK, BRAIN_ERROR_NOTICE, ...CAMERA_MOCK_LINES]) {
    assert.doesNotMatch(s, /仮の頭|かりの あたま|おためしの あたま/, s);
  }
  for (const s of [FALLBACK_BRAIN_NOTICE, MOCK_NOTICE, MOCK_NOTICE_SHORT, BRAIN_ERROR_NOTICE]) assert.match(s, /^おためしモード/, s);
  assert.match(MOCK_NOTE, /おためしモード/);
  assert.match(CAMERA_MOCK_LINES[0], /おためしモード/);
  assert.match(FAKE_BRAIN_LATENCY_NOTE, /おためしモード/);
  // サーバーが画面へ送る知らせ(手元・公開の関数)
  assert.doesNotMatch(read('server/index.mjs').replace(/console\.[a-z]+\([^\n]*\n/g, ''), /notice: `仮の頭脳/);
  const chat = read('api/_lib/chat.mjs');
  for (const m of chat.matchAll(/'[^']*?': '([^']*)',|passphrase: '([^']*)',/g)) {
    const text = m[1] ?? m[2];
    if (text.includes('頭脳')) assert.match(text, /^おためしモードです/, text);
  }
  assert.doesNotMatch(chat.match(/const FALLBACK_NOTICE[\s\S]*?\n\}\)?;/)?.[0] ?? '', /仮の頭脳です/);
  // 入口の合言葉の欄の説明
  assert.match(read('index.html'), /無くても おためしモードで話せます/);
  assert.doesNotMatch(read('index.html').replace(/<!--[\s\S]*?-->/g, ''), /仮の頭脳/);
});

test('帯の見た目: 上の段の中に置く(--top-h で段が高くなり、キャラがその下に収まる)。黄色の知らせは帯が出る間だけ畳む。短い画面では理由を畳む', () => {
  const css = read('src/ui/style.css');
  assert.match(css, /\.trial-banner \{\s*align-self: flex-start; max-width: 100%;[^}]*pointer-events: auto;/);
  assert.match(css, /html\.trial-banner-on:not\(\.tv-mode\) \.brain-notice \{ display: none; \}/);
  assert.match(css, /@media \(max-height: 520px\), \(max-width: 340px\) \{ \.tb-reason \{ display: none; \} \}/);
  assert.match(css, /\.tb-btn \{[^}]*min-height: 40px;/);
});
