// 合わせの後の小さな直し 3 つの試験
//  1) 「ことばで 書く」で札の上の絵を this._pin(null) で消す(覚えている絵も消える)
//  2) 描けなかった理由が 'fails'(今日はもう描けない)の時は、必ず止まる「もういちど 描く」を出さず、正直に言う
//  (接客の見張りの alive の試験は hands_free.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawCreator, createSampleCreator } from '../src/ui/onboarding/creators.js';
import { FirstRun } from '../src/ui/onboarding/script.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';
import { randomSettings, seededRandom } from '../src/ui/persona/settings.js';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const fakeFile = () => {
  const bytes = Buffer.from(PNG_1PX, 'base64');
  return { type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

function harness({ creator, pin }) {
  const said = [];
  let offered = [];
  const stored = new Map();
  const fr = new FirstRun({
    guide: MAIN,
    creator,
    persona: { get: (id) => stored.get(id) ?? null, set: (id, s) => stored.set(id, s), random: () => randomSettings(seededRandom(7)) },
    talk: async () => ({ lines: [{ text: 'こんにちは。' }], brain: 'mock' }),
    voice: { realVoice: () => null, canTakeKey: () => true, canRemember: () => false, notice: () => '', useKey: async () => ({ ok: false }) },
    present: async (lines) => { said.push(...lines); },
    offer: (a) => { offered = a; },
    showCharacter: async () => true,
    pin,
  });
  return { fr, said, get offered() { return offered.map((a) => a.id); }, texts: (who) => said.filter((l) => !who || l.who === who).map((l) => l.text) };
}

function withFetch(reply, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    const r = reply();
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  return fn().finally(() => { globalThis.fetch = real; });
}
const drawing = () => createDrawCreator({ sample: createSampleCreator({ main: MAIN }), enabled: () => true });

test('should 1: 「ことばで 書く」(_askWords)は _pin(null) で札の絵を消し、覚えている絵(pinned)も空にする', async () => {
  const pins = [];
  const h = harness({ creator: drawing(), pin: (p) => pins.push(p) });
  h.fr.pinned = { img: 'blob:own', caption: '選んだ絵' };
  await h.fr._askWords();
  assert.equal(h.fr.pinned, null, '覚えている絵が残らない(戻った時に消したはずの絵がまた出ない)');
  assert.deepEqual(pins, [null], '札の上の絵も消す');
  assert.deepEqual(h.offered, ['words', 'again']);
});

