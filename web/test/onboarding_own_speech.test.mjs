// おまかせの性格が、人格の文で話し方の決まった子(主役ノリーなど)に、語尾や口調を足さない試験。画面なし(編集ごとの試験に入る)。
// 11/7 03:09 の録画で、おまかせが主役に語尾「ぽよ」を選び「ノリーと申しマスぽよ」になった(直す前は、種 5 で同じになる)。
// - 話し方の決まった子のおまかせは、口調がいつも own(この子の話し方)。語尾は付けない。型・元気さ・長さは今までどおり選ぶ
// - 仮の頭脳の返事(人格の文の手本の文)を、言い回しも語尾も変えずに出す(変わるのは型の一言・文の終わりの記号・文の数だけ)
// - Claude に渡す設定の文は「人格の文の話し方のまま」。フレンドリー・ていねい・語尾の指示を入れない
// - 覚える場所は v2。v1 のおまかせで覚えた語尾(主役にも付いていた)は読まない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENDINGS, PRESETS, STORE_PREFIX, composePersona, definesOwnSpeech, loadSettings, normalize, ownSpeechFor, personaBlock,
  randomSettings, seededRandom, summary,
} from '../src/ui/persona/settings.js';
import { styleLines } from '../src/ui/persona/preview.js';
import { FirstRun } from '../src/ui/onboarding/script.js';
import { createSampleCreator } from '../src/ui/onboarding/creators.js';
import { MAIN_CHARACTER as MAIN } from '../src/character/defaults.js';
import { exampleReply, firstGreeting } from '../server/greeting.mjs';
import { sanitizePersona } from '../server/safety.mjs';

const MAIN_PERSONA = readFileSync(join(import.meta.dirname, '..', '..', 'characters', MAIN.id, 'persona.md'), 'utf8');
const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const hasEnding = (text) => ENDINGS.some((e) => text.includes(e));
const sentences = (lines) => lines.flatMap((t) => String(t).split(/(?<=[。!?！？…])/u)).map((t) => t.trim()).filter(Boolean);
const body = (t) => t.replace(/[。!?！？…]+$/u, '');

test('人格の文に話し方が書いてあるかを見分ける(主役は人格の文がまだ届かない時も、決まっているとみなす)', () => {
  assert.equal(definesOwnSpeech(MAIN_PERSONA), true, '主役の persona.md(話し方・一人称・話し方の例)');
  assert.equal(definesOwnSpeech(MAIN_PERSONA.replace(/\n/g, '\r\n')), true, 'CRLF の写しでも同じ');
  assert.equal(definesOwnSpeech('# みかん\n- 話し方: やさしく、短く。語尾はときどき「〜だよ!」。'), true);
  assert.equal(definesOwnSpeech('# 子\n- 一人称は「ぼく」。'), true);
  assert.equal(definesOwnSpeech('# 子\n\n## 話し方の例\n- 「好き」→「りんご!」'), true);
  assert.equal(definesOwnSpeech('# 子\nまるくて元気な子。好きなことはひなたぼっこ。'), false, '話し方の行が無い');
  assert.equal(definesOwnSpeech(''), false);
  assert.equal(definesOwnSpeech(personaBlock(normalize({ tone: 'polite' }))), false, '画面が足した設定の節だけでは、話し方が決まっているとみなさない');
  assert.equal(definesOwnSpeech(composePersona('# 子\nまるい。', normalize({ tone: 'friendly' }))), false, '設定の節の「口調」は数えない');
  assert.equal(ownSpeechFor(MAIN.id, { persona: '', mainId: MAIN.id }), true, '主役は人格の文の読み込み前でも');
  assert.equal(ownSpeechFor('newkid', { persona: '', mainId: MAIN.id }), false, '手元で描いたばかりの子(人格の文なし)');
  assert.equal(ownSpeechFor('mikan', { persona: '- 話し方: やさしく。', mainId: MAIN.id }), true);
  assert.equal(ownSpeechFor(null, { persona: MAIN_PERSONA, mainId: MAIN.id }), false);
});

test('おまかせ: 話し方の決まった子は、400 回とも口調が「この子の話し方」で語尾なし。ほかの欄は今までと同じ並び', () => {
  const presets = new Set();
  for (const seed of SEEDS) {
    const own = randomSettings(seededRandom(seed), { ownSpeech: true });
    const plain = randomSettings(seededRandom(seed));
    assert.equal(own.tone, 'own', `種 ${seed}`);
    assert.equal(own.ending, '', `種 ${seed}`);
    assert.deepEqual({ ...own, tone: plain.tone, ending: plain.ending }, plain, `種 ${seed}: 口調のほかは同じ`);
    presets.add(own.preset);
  }
  assert.equal(presets.size, Object.keys(PRESETS).length, '型は 4 つとも出る(性格のおまかせは残す)');
  // 話し方の決まっていない子(手元で描いたばかりの子など)は、今までどおり語尾も選ぶ
  const tones = new Set(SEEDS.map((seed) => randomSettings(seededRandom(seed)).tone));
  assert.deepEqual([...tones].sort(), ['ending', 'friendly', 'polite']);
  assert.equal(summary(randomSettings(seededRandom(5), { ownSpeech: true })).split('・')[1], 'この子の話し方');
});

test('直す前の再現: 話し方の決まりを見ないと、種 5 で「ノリーと申しマスぽよ」になる(この試験が直しを見分けられる印)', () => {
  const hello = firstGreeting(MAIN_PERSONA);
  assert.equal(hello[0], 'はじめまして! ノリーと申しマス。', '主役のあいさつの 1 行目(persona.md)');
  const before = randomSettings(seededRandom(5));
  assert.equal(before.tone, 'ending');
  assert.match(styleLines(hello, before).join(''), /ノリーと申しマスぽよ/);
  const after = randomSettings(seededRandom(5), { ownSpeech: true });
  assert.doesNotMatch(styleLines(hello, after).join(''), /ぽよ/);
});

test('主役の仮の頭脳の返事: おまかせ 400 回とも、手本の文の言い回しのまま(語尾・ていねいへの言い換え・型の一言を足さない)', () => {
  const replies = [
    firstGreeting(MAIN_PERSONA),
    exampleReply(MAIN_PERSONA, '好きな食べ物はなに?'),
    exampleReply(MAIN_PERSONA, 'きみはだれ?'),
    exampleReply(MAIN_PERSONA, '今日の天気は?'),
  ];
  for (const r of replies) assert.ok(r.length >= 2, `手本の文が取れない: ${JSON.stringify(r)}`);
  for (const seed of SEEDS) {
    const s = randomSettings(seededRandom(seed), { ownSpeech: true });
    const lead = PRESETS[s.preset].lead;
    for (const raw of replies) {
      const want = sentences(raw);
      const got = styleLines(raw, s);
      const text = got.join('');
      assert.ok(!hasEnding(text), `種 ${seed}: 語尾が付いた: ${text}`);
      assert.equal(got.length, Math.min(want.length, s.length === 'short' ? 1 : s.length === 'normal' ? 2 : 3), `種 ${seed}: 文の数(型の一言を足さない): ${text}`);
      got.forEach((t, i) => {
        const plain = i === 0 ? lead.reduce((acc, l) => (acc.startsWith(l) ? acc.slice(l.length) : acc), t) : t;
        assert.equal(body(plain), body(want[i]), `種 ${seed}: 言い回しが変わった: ${t} ← ${want[i]}`);
      });
    }
  }
  // 「〜マス」「〜デス」が残る(ふつうの長さで 2 文目まで出る時)
  const normal = styleLines(firstGreeting(MAIN_PERSONA), normalize({ tone: 'own', length: 'normal', energy: 3 }));
  assert.match(normal.join(''), /ノリーと申しマス。$/);
});

test('Claude に渡す設定の文: この子の話し方のまま。フレンドリー・ていねい・語尾の指示を入れず、安全の層でも消えない', () => {
  const s = normalize({ tone: 'own', preset: 'genki' });
  const block = personaBlock(s);
  assert.match(block, /- 口調: 上の人格の文に書いてある話し方のまま。/);
  assert.doesNotMatch(block, /〜だよ|〜です|語尾「|文の終わりに「/);
  assert.equal(sanitizePersona(block).removed, 0);
  const composed = composePersona(MAIN_PERSONA, s);
  assert.ok(composed.startsWith('# '), '人格の文が先、設定の節が後ろ');
  const habit = composed.indexOf('ノリー、がんばりマス'); // 主役の persona.md(S3)の口ぐせ。無い時に -1 で通らないように、在ることも見る
  assert.ok(habit >= 0 && habit < composed.indexOf('# 性格と話し方'), `人格の文の口ぐせが設定の節より先に無い: ${habit}`);
  assert.equal(normalize({ tone: 'own', ending: 'ぽよ' }).ending, '', 'own の時は語尾を持たない');
});

test('初めての会話: 主役の絵の入口で、おまかせ・もう一度ひく・あいさつ・話しかけ、どれも主役の話し方のまま(種 1〜30)', async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rnd = seededRandom(seed); // 本物の画面と同じく、1 つの乱数をおまかせのたびに引き続ける
    const said = [];
    const stored = new Map();
    let offered = [];
    const fr = new FirstRun({
      guide: MAIN,
      creator: createSampleCreator({ main: MAIN }),
      persona: {
        get: (id) => stored.get(id) ?? null,
        set: (id, v) => stored.set(id, v),
        // 入口(index.js)と同じ決め方: 舞台の子の persona.md と、主役の id
        random: (c) => randomSettings(rnd, { ownSpeech: ownSpeechFor(c?.id, { persona: c?.id === MAIN.id ? MAIN_PERSONA : '', mainId: MAIN.id }) }),
      },
      // 仮の頭脳と同じ文: はじめましては初めてのあいさつ、ほかは話し方の例(人格の文に設定の節を足した物から取り出す)
      talk: async (text, ctx) => {
        const persona = composePersona(MAIN_PERSONA, ctx.settings);
        const lines = /はじめまして/.test(text) ? firstGreeting(persona) : exampleReply(persona, text);
        return { lines: lines.map((t) => ({ text: t })), brain: 'mock' };
      },
      voice: { realVoice: () => null, canTakeKey: () => false, notice: () => '' },
      present: async (l) => {
        said.push(...l);
      },
      offer: (a) => {
        offered = a.map((x) => x.id);
      },
    });
    await fr.start();
    await fr.act('pick', { url: 'blob:test', name: 'e.png' });
    await fr.act('col_brown'); // ちゃいろで たてに ながい絵 → いちばん近いのは主役(UIR 2)
    await fr.act('shp_tall');
    assert.equal(fr.character.id, MAIN.id, '色と形が近い時は主役');
    await fr.act('keep');
    assert.equal(fr.step, 4);
    assert.equal(fr.settings.tone, 'own', `種 ${seed}: おまかせ`);
    assert.ok(said.some((l) => l.who === 'note' && l.text.includes('この子らしく')), '4 歩目のまとめに出る');
    for (let i = 0; i < 4; i++) {
      await fr.act('persona_roll');
      assert.equal(fr.settings.tone, 'own', `種 ${seed}: もう一度ひく ${i + 1}`);
    }
    assert.equal(stored.get(MAIN.id).tone, 'own');
    await fr.act('persona_ok');
    await fr.act('to_retro');
    assert.deepEqual(offered, ['say', 'to_voice']);
    await fr.act('say', { text: '好きな食べ物はなに?' });
    const chars = said.filter((l) => l.who === 'char').map((l) => l.text);
    assert.equal(chars.length, 2);
    for (const t of chars) assert.ok(!hasEnding(t), `種 ${seed}: 語尾が付いた: ${t}`);
    if (fr.settings.length !== 'short') assert.match(chars[0], /ノリーと申しマス/, `種 ${seed}: あいさつ`);
    assert.match(chars[1], /大好きデス/, `種 ${seed}: 話しかけの返事`);
  }
});

test('覚える場所は v2: v1 で覚えた「語尾ぽよ」の主役の設定は読まない', () => {
  assert.equal(STORE_PREFIX, 'yc.persona.v2.');
  const mem = new Map([[`yc.persona.v1.${MAIN.id}`, JSON.stringify({ v: 1, preset: 'mischief', tone: 'ending', ending: 'ぽよ' })]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(loadSettings(storage, MAIN.id), null);
});
