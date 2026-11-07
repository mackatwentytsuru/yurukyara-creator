// 「マイクと スピーカー」の決まり(第 12 波 b・BUX)の試験: 覚える・既定のマイクかの見分け・聞き取りの道・音が来ない時の見張り・
// サーバーの「音がほぼ 0」の答え・画面のアップデートを公開の版で出さない・始める命令の住所の行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_KEY, AUDIO_WORDS, SILENCE_MS, canPickSpeaker, createSilenceWatch, decideListening, isDefaultMic, loadChoice, micConstraints, resolveDevice, saveChoice, splitDevices } from '../src/conversation/audioDevices.js';
import { micPlan } from '../src/conversation/listener.js';
import { createStt, isSilentWav } from '../server/stt.mjs';
import { encodeWav } from '../src/conversation/wav.js';
import { mountUpdate, versionLine, UPDATE_WORDS } from '../src/ui/updatePanel.js';
import { addressLines, lanAddress } from '../scripts/yuru.mjs';
import { join } from 'node:path';

// 家の中の住所の見本は、その場で組み立てる(公開の前の履歴の書き換えの規則が書いたままの値を言い換え、試験の中身が変わるため)
const ip = (...parts) => parts.join('.');

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
};

// Chrome の一覧の形: 'default'(既定)と 'communications' と本物。既定の本物は同じ groupId
const CHROME = [
  { kind: 'audioinput', deviceId: 'default', label: '既定 - マイク A', groupId: 'gA' },
  { kind: 'audioinput', deviceId: 'communications', label: '通信 - マイク A', groupId: 'gA' },
  { kind: 'audioinput', deviceId: 'idA', label: 'マイク A', groupId: 'gA' },
  { kind: 'audioinput', deviceId: 'idB', label: 'オーディオインターフェース B', groupId: 'gB' },
  { kind: 'audiooutput', deviceId: 'default', label: '既定 - スピーカー', groupId: 'gS' },
  { kind: 'audiooutput', deviceId: 'outB', label: 'オーディオインターフェース B', groupId: 'gB' },
  { kind: 'videoinput', deviceId: 'cam', label: 'カメラ', groupId: 'gC' },
];

test('選んだ物は、このブラウザだけで覚える(形の違う物・長すぎる物は覚えない)', () => {
  const s = memStore();
  assert.deepEqual(loadChoice(s), { mic: null, speaker: null });
  saveChoice({ mic: { id: 'idB', label: 'B', groupId: 'gB', def: false }, speaker: { id: 'outB', label: 'B' } }, s);
  assert.deepEqual(loadChoice(s), { mic: { id: 'idB', label: 'B', groupId: 'gB', def: false }, speaker: { id: 'outB', label: 'B', groupId: '' } });
  s.setItem(AUDIO_KEY, '{"mic":{"id":5},"speaker":"x"}');
  assert.deepEqual(loadChoice(s), { mic: null, speaker: null });
  s.setItem(AUDIO_KEY, 'こわれた');
  assert.deepEqual(loadChoice(s), { mic: null, speaker: null });
  assert.doesNotThrow(() => saveChoice({ mic: null }, { setItem: () => { throw new Error('quota'); } }), '覚えられない端末でも止まらない');
  assert.deepEqual(loadChoice(null), { mic: null, speaker: null });
});

test('一覧を分け、覚えた物を id か名前で見つける', () => {
  const { mics, speakers } = splitDevices(CHROME);
  assert.deepEqual(mics.map((d) => d.id), ['default', 'communications', 'idA', 'idB']);
  assert.deepEqual(speakers.map((d) => d.id), ['default', 'outB']);
  assert.equal(resolveDevice(mics, { id: 'idB', label: '' })?.id, 'idB');
  assert.equal(resolveDevice(mics, { id: 'old-id', label: 'オーディオインターフェース B' })?.id, 'idB', 'id が変わっても名前で見つける');
  assert.equal(resolveDevice(mics, { id: 'gone', label: 'ない' }), null);
});

test('既定のマイクかを見分ける(Chrome の default と同じ groupId なら既定。default の無いブラウザは一覧の最初)', () => {
  const { mics } = splitDevices(CHROME);
  assert.equal(isDefaultMic(mics, null), true);
  assert.equal(isDefaultMic(mics, { id: 'default' }), true);
  assert.equal(isDefaultMic(mics, mics.find((d) => d.id === 'idA')), true, '既定と同じマイク');
  assert.equal(isDefaultMic(mics, mics.find((d) => d.id === 'idB')), false, 'オーディオインターフェース');
  const safari = [{ id: 's1', label: 'iPhone のマイク', groupId: '' }, { id: 's2', label: 'ヘッドセット', groupId: '' }];
  assert.equal(isDefaultMic(safari, safari[0]), true);
  assert.equal(isDefaultMic(safari, safari[1]), false);
  const before = [{ id: '', label: '', groupId: '' }]; // 許可の前: 一覧に id が無い → 選んだ時の印
  assert.equal(isDefaultMic(before, { id: 'idB', def: false }), false);
  assert.equal(isDefaultMic(before, { id: 'idA', def: true }), true);
});

test('既定でないマイクは、PC の聞き取りへ(無ければ既定のマイクで聞き、そうと知らせる)', () => {
  const b = { id: 'idB', label: 'B' };
  assert.deepEqual(decideListening('web', { chosen: null, isDefault: true, serverOk: true }), { provider: 'web', useChosen: false, note: '' });
  assert.deepEqual(decideListening('web', { chosen: b, isDefault: true, serverOk: true }), { provider: 'web', useChosen: false, note: '' });
  assert.deepEqual(decideListening('web', { chosen: b, isDefault: false, serverOk: true }), { provider: 'server', useChosen: true, note: '' });
  assert.deepEqual(decideListening('web', { chosen: b, isDefault: false, serverOk: false }), { provider: 'web', useChosen: false, note: AUDIO_WORDS.noServer });
  assert.deepEqual(decideListening('server', { chosen: b, isDefault: false, serverOk: true }), { provider: 'server', useChosen: true, note: '' }, 'ヘッドセットはもともとサーバー');
  assert.deepEqual(micConstraints({ echoCancellation: true }, b, false), { echoCancellation: true, deviceId: { exact: 'idB' } });
  assert.deepEqual(micConstraints({ echoCancellation: true }, b, true), { echoCancellation: true }, '既定なら deviceId を付けない');
});

test('聞き取りの道を、覚えた選びと今の一覧で決める(Listener が押すたびに使う)', async () => {
  const enumerate = async () => CHROME;
  assert.deepEqual(await micPlan('web', { choice: { mic: null }, enumerate, serverOk: true }), { provider: 'web', useChosen: false, chosen: null, note: '' });
  const p1 = await micPlan('web', { choice: { mic: { id: 'idB', label: 'オーディオインターフェース B', groupId: 'gB', def: false } }, enumerate, serverOk: true });
  assert.equal(p1.provider, 'server');
  assert.equal(p1.useChosen, true);
  assert.equal(p1.chosen.id, 'idB');
  const p2 = await micPlan('web', { choice: { mic: { id: 'idA', label: 'マイク A', groupId: 'gA', def: true } }, enumerate, serverOk: true });
  assert.deepEqual([p2.provider, p2.useChosen], ['web', false], '既定と同じマイクは、ブラウザの聞き取りのまま');
  const p3 = await micPlan('web', { choice: { mic: { id: 'idB', label: 'B', groupId: 'gB', def: false } }, enumerate: async () => { throw new Error('x'); }, serverOk: false });
  assert.deepEqual([p3.provider, p3.useChosen, p3.note], ['web', false, AUDIO_WORDS.noServer]);
});

test('押してから音がまったく来ないと 1 回だけ知らせる(キャラが話している間は数えない・音が来たら知らせない)', () => {
  const w = createSilenceWatch({ startedAt: 0 });
  assert.equal(w.feed(0, 1000), 'ok');
  assert.equal(w.feed(0, SILENCE_MS - 1), 'ok');
  assert.equal(w.feed(0, SILENCE_MS + 10), 'silent');
  assert.equal(w.feed(0, SILENCE_MS + 2000), 'ok', '2 回目は出さない');
  const busy = createSilenceWatch({ startedAt: 0 });
  assert.equal(busy.feed(0, 6000, true), 'ok');
  assert.equal(busy.feed(0, 9000, true), 'ok', '話している間の 9 秒は数えない');
  assert.equal(busy.feed(0, 12000), 'ok', '話し終えてから 3 秒');
  assert.equal(busy.feed(0, 16500), 'silent');
  const heard = createSilenceWatch({ startedAt: 0 });
  heard.feed(0.01, 500);
  assert.equal(heard.feed(0, 20000), 'ok');
  assert.equal(heard.heard, true);
});

test('スピーカーを選べるか(Web Audio の setSinkId があるか)', () => {
  function WithSink() {}
  WithSink.prototype.setSinkId = () => {};
  function NoSink() {}
  assert.equal(canPickSpeaker(WithSink), true);
  assert.equal(canPickSpeaker(NoSink), false);
  assert.equal(canPickSpeaker(undefined), false);
});

test('サーバーの聞き取り: 音がほぼ 0 の区間は係に渡さず「音が届いていない」と答える(0.3 秒より短い物は今までどおり)', async () => {
  const zeros = (s) => Buffer.from(encodeWav(new Float32Array(Math.round(16000 * s))));
  const tone = (s) => Buffer.from(encodeWav(Float32Array.from({ length: Math.round(16000 * s) }, (_, i) => 0.2 * Math.sin(i / 5))));
  assert.equal(isSilentWav(zeros(0.5)), true);
  assert.equal(isSilentWav(zeros(0.1)), false);
  assert.equal(isSilentWav(tone(0.5)), false);
  assert.equal(isSilentWav(Buffer.from('RIFF')), false);
  process.env.FAKE_STT = 'ok';
  const stt = createStt({ command: process.execPath, args: [join(import.meta.dirname, '..', 'scripts', 'lib', 'fake_stt_worker.mjs')], engine: 'local' });
  assert.deepEqual(await stt.transcribe(zeros(0.6)), { text: '', ms: 0, silent: true }, '係を起こさずに答える');
  stt.stop();
});

test('画面のアップデートは、この PC の中で開いた時だけ(公開の版・同じ Wi-Fi のスマホでは何も作らない)', () => {
  assert.equal(mountUpdate({ app: {}, loc: { hostname: 'yuru-chara.example' } }), null);
  assert.equal(mountUpdate({ app: {}, loc: { hostname: ip(192, 168, 1, 20) } }), null);
  assert.equal(versionLine({ available: true, newer: true, ours: '1.0.0', theirs: '1.1.0' }), 'いまの はん 1.0.0 → あたらしい はん 1.1.0');
  assert.equal(versionLine({ available: true, newer: false, ours: '1.0.0', ahead: 2 }), 'いまの はん 1.0.0(ちいさな なおしが 2 こ あります)');
  assert.equal(versionLine({ available: false, ours: '1.0.0' }), `${UPDATE_WORDS.newest}(1.0.0)`);
  assert.equal(versionLine({ ok: false, available: false, ours: '1.0.0' }), 'いまの はん 1.0.0', '確かめられなかった時は「いちばん あたらしい」と言わない');
  for (const w of Object.values(UPDATE_WORDS)) assert.ok(!/7 歩/.test(w));
});

test('窓を開いている間の頭の線: キャラの横の範囲に重なる窓の下の端 + 14px(右に浮かせた PC の窓・隠れた窓は数えない)', async () => {
  const { sheetGuard } = await import('../src/ui/sheet.js');
  const top = { left: 12, right: 378, top: 12, bottom: 212, width: 366, height: 200 }; // スマホ: 上に浮かぶ窓
  const side = { left: 888, right: 1268, top: 80, bottom: 600, width: 380, height: 520 }; // PC: 右に浮かぶ窓
  assert.equal(sheetGuard(150, 257, [top]), 226, 'スマホ: 窓の下の端 212 + 14');
  assert.equal(sheetGuard(490, 790, [side]), 0, 'PC: キャラの横の範囲に重ならない');
  assert.equal(sheetGuard(150, 257, [{ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }]), 0, '隠れた窓');
  assert.equal(sheetGuard(150, 257, []), 0);
  assert.equal(sheetGuard(), 0, '開いた窓が無い');
});

test('始める命令の住所の行: アプリ・作る道・(--lan の時)スマホ。家の中の住所を先に選ぶ', () => {
  const lines = addressLines({ port: 8787, makePort: 8796, makeUp: true, lan: ip(192, 168, 1, 5) }).join('\n');
  assert.match(lines, /http:\/\/127\.0\.0\.1:8787\//);
  assert.match(lines, /http:\/\/127\.0\.0\.1:8796\/qr/);
  assert.match(lines, /http:\/\/192\.168\.1\.5:8787\//);
  assert.doesNotMatch(addressLines({ port: 8787, makePort: 8796, makeUp: false, lan: null }).join('\n'), /スマホ:/);
  assert.match(addressLines({ port: 8787, makePort: 8796, makeUp: false, lan: null }).join('\n'), /作る道: うごいていません/);
  const nets = { eth: [{ family: 'IPv4', internal: false, address: ip(100, 64, 1, 2) }, { family: 'IPv4', internal: false, address: ip(192, 168, 10, 7) }], lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] };
  assert.equal(lanAddress(nets), ip(192, 168, 10, 7));
  assert.equal(lanAddress({ lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }), null);
  // PC の中だけの仮の網(WSL・Hyper-V)は選ばない。192.168 を 172 より先に
  const win = { 'vEthernet (WSL (Hyper-V firewall))': [{ family: 'IPv4', internal: false, address: '172.30.0.1' }], 'Wi-Fi': [{ family: 'IPv4', internal: false, address: ip(192, 168, 1, 23) }] };
  assert.equal(lanAddress(win), ip(192, 168, 1, 23));
  assert.equal(lanAddress({ 'イーサネット': [{ family: 'IPv4', internal: false, address: '172.20.0.5' }], 'vEthernet (Default Switch)': [{ family: 'IPv4', internal: false, address: '172.17.0.1' }] }), '172.20.0.5');
  assert.match(addressLines({ port: 8787, makePort: 8796, makeUp: false, lan: null, makeSkipped: true }).join('\n'), /作る道: とめてあります/);
});
