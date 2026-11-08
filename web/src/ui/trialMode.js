// おためしモード(Claude の鍵も Claude Code もつながっていない = 決まった台本で話す)を、画面のあちこちで「そうだ」と分かるようにする部品。
// 「ちゃんと動く」と勘違いされないように、次の 4 か所に出す。どれも、本物の頭脳(鍵か Claude Code がつながっている)の時は出ない。
//  1. 帯(#trialBanner): ふつうの画面の上に出しっぱなし。「本物の Claude にする」で案内の窓(ui/brainGuide.js)を開く
//  2. 入口の 1 行(#gateTrial): 始めるボタンの下
//  3. 接客モードの入口(#kioskTrial): 店の人に「先に PC で鍵か Claude Code を入れてね」
//  4. 接客モードの札(#trialLabel): 来場者に見える所に出しっぱなし。案内のボタンは付けない
// 文は textContent だけで入れる。判定は純粋な関数(node の試験で読む)。DOM は mountTrialMode に渡された要素だけ触る。
import { shouldShowGuide } from './brainGuide.js';

export const TRIAL_NAME = 'おためしモード';
export const TRIAL_BANNER_LEAD = 'おためしモード:';
export const TRIAL_BANNER_REASON = 'Claude の鍵が入っていないので、決まった台本で話しています';
export const TRIAL_BANNER_TEXT = `${TRIAL_BANNER_LEAD}${TRIAL_BANNER_REASON}`;
export const TRIAL_BANNER_BUTTON = '本物の Claude にする';
export const TRIAL_GATE_LINE = 'いまは おためしモード(本物の会話には、鍵か Claude Code が要ります)';
export const TRIAL_KIOSK_STAFF_LINE = 'おためしモードです。このままでは、決まった台本で話すだけです。接客の前に、この PC で Claude の鍵を入れるか、Claude Code につないでから、起こし直してください。';
export const TRIAL_KIOSK_LABEL = 'おためしモード(本物の会話ではありません)';

/**
 * どこに出すか。
 * @param {{brain?: ('mock'|'haiku'|null), noticeText?: (string|null), statusBrain?: ('mock'|'haiku'|null), kiosk?: boolean}} o
 *   brain: いま話している頭脳 / noticeText: 理由つきの知らせ(上限・合言葉など。鍵が無いだけの時は null)
 *   statusBrain: 手元のサーバーが言う頭脳(/api/status。公開の URL は null)/ kiosk: 接客モードか
 */
export function trialView({ brain = null, noticeText = null, statusBrain = null, kiosk = false } = {}) {
  const mock = brain === 'mock';
  return {
    banner: !kiosk && shouldShowGuide(brain, noticeText), // 鍵が入っていないだけの時(上限・合言葉の理由の時は出さない)
    gateLine: !kiosk && statusBrain === 'mock', // 手元のサーバーが鍵なしと分かっている時だけ(公開の URL では分からないので出さない)
    kioskStaff: kiosk && statusBrain === 'mock',
    kioskLabel: kiosk && mock, // 接客では、理由が何でも、決まった台本の間は出す
  };
}

/** 帯の中身。文の部分の textContent を足し合わせると TRIAL_BANNER_TEXT と同じ。短い高さの画面では、理由の部分を畳んで「おためしモード」の札とボタンだけにする(css) */
function buildBanner(doc, root) {
  const lead = doc.createElement('b');
  lead.className = 'tb-lead';
  lead.textContent = TRIAL_BANNER_LEAD;
  const reason = doc.createElement('span');
  reason.className = 'tb-reason';
  reason.textContent = TRIAL_BANNER_REASON;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'tb-btn';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = TRIAL_BANNER_BUTTON;
  const text = doc.createElement('p');
  text.className = 'tb-text';
  text.append(lead, reason, button); // ボタンは文の終わりに続ける(スマホの幅でも、全体で 2 行に収まる)
  root.replaceChildren(text);
  return button;
}

/**
 * @param {{doc?: Document, banner?: HTMLElement|null, gateLine?: HTMLElement|null, kioskStaff?: HTMLElement|null, label?: HTMLElement|null,
 *          guide?: {open(opener?: HTMLElement): void, close(): void}|null}} o
 * @returns {{update(view: ReturnType<typeof trialView>): void}}
 */
export function mountTrialMode({ doc = globalThis.document, banner = null, gateLine = null, kioskStaff = null, label = null, guide = null } = {}) {
  const button = banner ? buildBanner(doc, banner) : null;
  button?.addEventListener('click', () => guide?.open(button));
  if (gateLine) gateLine.textContent = TRIAL_GATE_LINE;
  if (kioskStaff) kioskStaff.textContent = TRIAL_KIOSK_STAFF_LINE;
  if (label) label.textContent = TRIAL_KIOSK_LABEL;
  const root = doc.documentElement;
  return {
    update(view) {
      if (banner) banner.hidden = !view.banner;
      root.classList.toggle('trial-banner-on', Boolean(view.banner)); // 黄色の字幕の上の知らせは、帯が同じことを言うので畳む(style.css)
      if (!view.banner) guide?.close(); // 本物の頭脳に替わったら、開いていた案内も閉じる
      if (gateLine) gateLine.hidden = !view.gateLine;
      if (kioskStaff) kioskStaff.hidden = !view.kioskStaff;
      if (label) label.hidden = !view.kioskLabel;
    },
  };
}
