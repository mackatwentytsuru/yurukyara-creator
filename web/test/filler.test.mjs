import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speaker } from '../src/conversation/speaker.js';
import { fillerPath, FILLER_PHRASES } from '../server/fillers.mjs';

/** WebAudio の代わりの、最小の偽物。再生の予定(いつ・どの長さ)だけを記録する */
function fakeSpeaker(fillers) {
  const sp = new Speaker();
  const scheduled = [];
  sp.ctx = {
    currentTime: 10,
    createBuffer: (_ch, length) => ({ duration: length / 24000, copyToChannel() {} }),
    createBufferSource: () => ({
      connect() {},
      start(at) {
        scheduled.push({ at, dur: this.buffer.duration });
      },
      stop() {},
    }),
  };
  sp.analyser = {};
  sp.fillers = fillers.map((text, i) => ({ text, samples: new Float32Array(12000 + i * 1000), ms: 500 + i * 40 }));
  return { sp, scheduled };
}

test('あいづちは、同じ言葉が続けて出ない', () => {
  const { sp } = fakeSpeaker(['はい。', 'ええ。', 'なるほど。']);
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const f = sp.playFiller();
    assert.notEqual(f.text, prev);
    prev = f.text;
    sp.stop();
    sp.ctx.currentTime += 5;
  }
});

test('あいづちを出すと「話している」になり、続く返事の声は、そのあとに予定される', () => {
  const { sp, scheduled } = fakeSpeaker(['はい。', 'ええ。']);
  assert.equal(sp.speaking, false);
  const f = sp.playFiller();
  assert.equal(sp.speaking, true);
  const fillerEnd = scheduled[0].at + scheduled[0].dur;
  assert.ok(Math.abs(sp.nextTime - fillerEnd) < 1e-9);
  assert.ok(f.ms >= 500);
});

test('声が 1 種類だけなら、同じ物を出す(止まらない)。声が無ければ null', () => {
  const one = fakeSpeaker(['はい。']).sp;
  assert.equal(one.playFiller().text, 'はい。');
  assert.equal(one.playFiller().text, 'はい。');
  assert.equal(fakeSpeaker([]).sp.playFiller(), null);
});

test('stop() で、あいづちも止まる', () => {
  const { sp } = fakeSpeaker(['はい。', 'ええ。']);
  sp.playFiller();
  sp.stop();
  assert.equal(sp.sources.size, 0);
  assert.equal(sp.speaking, false);
});

test('サーバー: あいづちのファイル名は、決まった形だけ受ける(../ などは通さない)', () => {
  assert.equal(fillerPath('../../.env'), null);
  assert.equal(fillerPath('abc.pcm'), null);
  assert.ok(fillerPath('0123456789.pcm'));
  assert.ok(FILLER_PHRASES.length >= 4);
  assert.equal(new Set(FILLER_PHRASES).size, FILLER_PHRASES.length);
});
