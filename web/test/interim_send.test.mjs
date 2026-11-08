// 途中の文字を先に送る部品(src/conversation/interimSend.js)の試験。時計と待ちは作り物で進める(実時間は待たない)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLUSH_MS, InterimSender, normalizeSpoken } from '../src/conversation/interimSend.js';
import { joinWords } from '../src/conversation/dialogue.js';

/** 作り物の時計と待ち */
function rig() {
  let t = 1000;
  const timers = [];
  const sent = [];
  const sender = new InterimSender({
    send: (text, info) => sent.push({ text, at: t, info }),
    now: () => t,
    setTimer: (fn, ms) => {
      const h = { fn, at: t + ms, live: true };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      if (h) h.live = false;
    },
  });
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((h) => h.live && h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      t = next.at;
      next.live = false;
      next.fn();
    }
    t = end;
  };
  return { sender, sent, advance, now: () => t };
}

test('声が止まって 700ms、確定が来なければ、いちばん新しい途中の文字を送る', () => {
  const r = rig();
  r.sender.voice(true);
  r.advance(300);
  r.sender.interim('こんにちは');
  r.advance(500);
  r.sender.interim('こんにちは 今日は');
  r.sender.voice(false, 1700);
  r.advance(FLUSH_MS - 1);
  assert.equal(r.sent.length, 0, '700ms より前には送らない');
  r.advance(1);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].text, 'こんにちは 今日は');
  assert.equal(r.sent[0].info.lastVoicedAt, 1700, '話し終わりの時刻を持っていく(返事の速さの数え始め)');
});

test('700ms より前に確定が来たら、先には送らない(そのまま送る)', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('おはよう');
  r.sender.voice(false, 1000);
  r.advance(400);
  assert.equal(r.sender.final('おはよう'), 'send');
  r.advance(2000);
  assert.equal(r.sent.length, 0);
});

test('先に送った言葉の確定があとから同じ言葉で届いたら、捨てる(2 回送らない)。句読点・全角半角の違いは同じ言葉', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('ステージはどこですか');
  r.sender.voice(false, 1000);
  r.advance(FLUSH_MS);
  assert.equal(r.sent.length, 1);
  r.advance(1500);
  assert.equal(r.sender.final('ステージは、どこですか？'), 'drop');
  assert.equal(r.sender.final('ステージはどこですか'), 'send', '捨てるのは 1 回だけ。次の同じ言葉は新しい発話');
});

test('確定が先に送った言葉と違えば(言い足し・聞き直し)、置き換える(送る)', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('きょうの');
  r.sender.voice(false, 1000);
  r.advance(FLUSH_MS);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sender.final('きょうのてんきは'), 'replace');
  assert.equal(r.sender.final('つぎの言葉'), 'send', '置き換えたあとは、先に送った言葉を覚えていない');
});

test('確定が何回かに分かれて、先に送った言葉の頭から順に届いても、全部捨てる', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('りんごとみかん');
  r.sender.voice(false, 1000);
  r.advance(FLUSH_MS);
  assert.equal(r.sender.final('りんごと'), 'drop');
  assert.equal(r.sender.final('みかん'), 'drop');
  assert.equal(r.sender.final('みかん'), 'send');
});

test('声が出始めたら、待っていた送りはやめる(言葉の途中の間)', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('あのね');
  r.sender.voice(false, 1000);
  r.advance(400);
  r.sender.voice(true); // また話し始めた
  r.advance(2000);
  assert.equal(r.sent.length, 0);
});

test('途中の文字が無い(サーバーの聞き取りの「…」だけ)なら、送らない', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('…');
  r.sender.voice(false, 1000);
  r.advance(5000);
  assert.equal(r.sent.length, 0);
});

test('声の出始めより前の古い途中の文字は、送らない', () => {
  const r = rig();
  r.sender.interim('前の言葉');
  r.advance(5000);
  r.sender.voice(true);
  r.advance(100);
  r.sender.voice(false, 1000);
  r.advance(5000);
  assert.equal(r.sent.length, 0);
});

test('送ったあとの途中の文字は、次の言葉の物(同じ言葉を 2 度送らない)', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('いち');
  r.sender.voice(false, 1000);
  r.advance(FLUSH_MS);
  assert.equal(r.sent.length, 1);
  r.sender.voice(false, 1000); // 声が止まった合図が重ねて来ても
  r.advance(FLUSH_MS);
  assert.equal(r.sent.length, 1, '同じ途中の文字を 2 度送らない');
});

test('先に送った言葉は 10 秒で忘れる(前の発話の確定を、いつまでも捨てない)', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('ひとこと');
  r.sender.voice(false, 1000);
  r.advance(FLUSH_MS);
  r.advance(11_000);
  assert.equal(r.sender.final('ひとこと'), 'send');
});

test('reset で、待っている送りも覚えも消える', () => {
  const r = rig();
  r.sender.voice(true);
  r.sender.interim('ねえ');
  r.sender.voice(false, 1000);
  r.sender.reset();
  r.advance(5000);
  assert.equal(r.sent.length, 0);
});

test('normalizeSpoken: 句読点・記号・空白を除き、全角半角と大文字小文字をそろえる', () => {
  assert.equal(normalizeSpoken(' ＡＢＣ、ｄｅｆ！ '), 'abcdef');
  assert.equal(normalizeSpoken('…'), '');
  assert.equal(normalizeSpoken(null), '');
});

test('joinWords: 前の言葉を頭に含んだ言葉は重ねない(途中の文字を先に送ったあと、全部の言葉で確定が届いた時)', () => {
  assert.equal(joinWords('今日の天気', '今日の天気を教えて'), '今日の天気を教えて');
  assert.equal(joinWords('今日の天気、', '今日の 天気を教えて'), '今日の 天気を教えて');
  assert.equal(joinWords('こんにちは', 'ステージはどこ'), 'こんにちは、ステージはどこ', '含まない時は今までどおりつなぐ');
  assert.equal(joinWords('', 'あ'), 'あ');
});
