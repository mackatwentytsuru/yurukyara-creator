// 安全の網の直し(FCS 11-08)。B13SC の should 1〜4 の試験。
// 1 韓国語の暴力の網 2 ひらがなの命の網の誤り 3 日本語だけの時の外国語の網の誤り 4 出力の網「I'm a human being」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHistory, classifyInput, distressDetail, guardOutput } from '../server/safety.mjs';
import { classifyForeignCrisis, foreignDistressDetail, foreignOutputKind, maskJaOnly } from '../server/safetyLang.mjs';

const MULTI = { lang: 'multi' };

test('FCS 1: 韓国語「누가 때렸어요」「그 사람이 때렸어요」は、また拾う(多言語・日本語だけの両方)。つらい話の中身は暴力', () => {
  for (const t of ['누가 때렸어요', '그 사람이 때렸어요', '어떤 사람이 때렸어요', '누군가가 때렸어요', '걔가 때렸어요', '누가 나를 때렸어요', '그 사람이 나를 때렸어요']) {
    assert.equal(classifyInput(t, MULTI), 'distress', t);
    assert.equal(classifyInput(t), 'distress', `日本語だけ ${t}`);
    assert.equal(foreignDistressDetail(t), 'abuse', t);
  }
  // 今までどおり
  for (const t of ['나를 때렸어요', '아빠가 나를 때려요', '친구가 때려요']) assert.equal(classifyInput(t, MULTI), 'distress', t);
});

test('FCS 1: 広げない。ボールや物をたたく話・言い切りでない言い方は拾わない', () => {
  for (const t of ['공을 때렸어요', '공을 세게 때려요', '골프공을 때렸어', '누가 공을 때렸어요', '그 사람이 공을 때렸어요', '북을 때렸어요', '사람이 때리면 안 돼요', '누가 왔어요?', '그 사람이 왔어요', '걔가 때려치웠대']) {
    assert.equal(classifyInput(t, MULTI), null, t);
    assert.equal(classifyInput(t), null, `日本語だけ ${t}`);
  }
});

test('FCS 2: 食べ物・買い物の話では命の案内を出さない(ナイフでさしてたべる・ほうちょうでころころ・くすりをたくさんかった)', () => {
  for (const t of ['ナイフでさしてたべる', 'ほうちょうでころころ', 'くすりをたくさんかった', '薬をたくさんもらった', 'くすりをいっぱいぬった', 'ほうちょうでさしみをきった', '包丁で刺身を切った', 'ほうちょうでやさいをきったよ', 'ナイフとフォークでたべた', 'くすりやさんにいった', 'ナイフで殺菌した']) {
    assert.equal(classifyInput(t), null, t);
    assert.equal(classifyInput(t, MULTI), null, `多言語 ${t}`);
  }
});

test('FCS 2: 本当に危ない言い方は、今までどおり命の案内(ひらがな・カタカナ・漢字)', () => {
  const real = ['くすりをたくさんのんじゃった', 'くすりいっぱいのんだ', '薬をいっぱいのんだ', 'クスリをタクサンのんだ', 'くすりをたくさんのんでしまった', 'くすりをたくさんたべた', '薬をたくさん飲んだ', 'くすりをたくさん', '薬をたくさん。',
    'ほうちょうでさしたい', 'ほうちょうでさす', 'ナイフでさされた', '包丁で刺したい', '包丁で刺された', 'ほうちょうでころしたい', 'ほうちょうでころす', 'ナイフでころされる', 'ナイフでさしてやる', '包丁で殺したい', '包丁で殺す', 'ナイフでさしちゃった', '今から死ぬ'];
  for (const t of real) assert.equal(classifyInput(t), 'emergency', t);
});

test('FCS 3: 日本語だけの時、題名・慣用句・日本語の言葉は、外国語の命・つらい話の網に当てない', () => {
  for (const t of ['Suicide Squad みた', 'Suicide Squad', 'suicide squad、おもしろかった', 'Better Off Dead', 'Better Off Dead って曲', 'I want to die laughing', 'I wanna die of laughter', '結束生命', '結束生命保険のCM']) {
    assert.equal(classifyInput(t), null, t);
    assert.equal(classifyInput(t, { lang: 'ja' }), null, `ja ${t}`);
    assert.equal(classifyForeignCrisis(t), null, t);
    assert.equal(classifyHistory([{ role: 'user', content: t }]), null, `履歴 ${t}`);
  }
});

test('FCS 3: 日本語だけでも、本当の外国語の危ない言い方は、今までどおり拾う', () => {
  for (const [t, k] of [
    ['I want to die', 'distress'], ["I'd be better off dead", 'distress'], ["everyone's better off dead", 'distress'], ['I am better off dead', 'distress'], ['I feel suicidal', 'distress'],
    ['I am going to kill myself tonight', 'emergency'], ['my dad hits me', 'distress'], ['I want to die、つらい', 'distress'],
    ["I'm probably better off dead", 'distress'], ['better off dead', 'distress'], ['I wanna die of shame', 'distress'], ['我決定結束生命', 'distress'],
    ['我想自杀', 'distress'], ['我想死', 'distress'], ['我想結束生命', 'distress'], ['我现在要跳楼', 'emergency'], ['活不下去', 'distress'], ['죽고 싶어요', 'distress'], ['뛰어내리고 싶어요', 'emergency'],
  ]) {
    assert.equal(classifyInput(t), k, t);
  }
});

test('FCS 3: 空ける道具は長さを変えない。多言語の時は、今までどおり(題名も拾う = 安全側)', () => {
  const s = 'Suicide Squad みた';
  assert.equal(maskJaOnly(s).length, s.length);
  assert.equal(maskJaOnly('Better Off Dead').trim(), '');
  assert.equal(maskJaOnly("I'd be better off dead"), "I'd be better off dead");
  assert.equal(classifyInput(s, MULTI), 'distress');
});

test('FCS 4: 出力の網は「I\'m a human being」「I am a real human being!」も拾い、AI だと言う文に差し替える', () => {
  const say = (text) => ({ type: 'say', text, expression: 'neutral', motion: 'none' });
  for (const t of ["I'm a human being", 'I am a real human being!', "I'm really a human being.", "I'm a human being, not an AI!", "I’m a human being"]) {
    assert.equal(foreignOutputKind(t), 'human', t);
    const out = guardOutput(say(t), { multi: true });
    assert.equal(out.guarded, true, t);
    assert.equal(out.text, "I'm an AI character, not a human.", t);
  }
  // 当たらない言い方(前からの 6 つ + being の付く言い方)
  for (const t of ["I'm an AI character, not a human.", "I'm not a human, I'm an AI.", "I'm not a human being, I'm an AI.", "I'm a human-friendly character!", "I'm a person-shaped AI", "I'm a human character in a game", "I'm a person being silly", "I'm an AI, so not a human being."]) {
    assert.equal(foreignOutputKind(t), null, t);
  }
  // 日本語だけの時は、この網を使わない(今までどおり)
  assert.equal(guardOutput(say("I'm a human being")).guarded, undefined);
});

test('FCS: 日本語の死にたい・暴力の言葉は、これまでどおり(日本語の網は変えていない)', () => {
  for (const t of ['死にたい', 'ほうちょうでさしたいくらいつらい', '先生にぶたれた']) assert.ok(classifyInput(t), t);
  assert.equal(distressDetail('死にたい'), 'self');
});

test('FCS_2 must 1: 人から刺される話・刃物の「さして/刺して/刺さ」は、命の案内に戻す(食べ物の形だけ外す)', () => {
  for (const t of ['お父さんが包丁で刺してきた', 'パパがナイフでさしてくる', 'ほうちょうでさしてきた', '包丁で刺して', 'ナイフで刺さった', 'ほうちょうでさして', '包丁で刺してやる']) {
    assert.equal(classifyInput(t), 'emergency', t);
    assert.equal(classifyInput(t, MULTI), 'emergency', `多言語 ${t}`);
  }
  for (const t of ['ナイフでさしてたべる', 'ほうちょうでさしてたべたい', '包丁で刺して食べる', 'ほうちょうでころころ', '包丁でころっと切れた', '包丁で刺身を切った']) {
    assert.equal(classifyInput(t), null, t);
  }
});

test('FCS_2 must 2: ひらがなの「くすりをたくさんのむ」の形も、命の案内に戻す(買う・もらう・ぬる・薬屋さんは外す)', () => {
  for (const t of ['くすりをたくさんのむ', 'くすりをたくさんのもう', 'くすりをたくさんのめばしねる', 'くすりをたくさんためてる', '薬をたくさん口にいれた', 'くすりをいっぱいのめば', 'クスリをタクサンのむ']) {
    assert.equal(classifyInput(t), 'emergency', t);
    assert.equal(classifyInput(t, MULTI), 'emergency', `多言語 ${t}`);
  }
  for (const t of ['くすりをたくさんかった', '薬をたくさん買った', 'くすりをたくさんもらった', 'くすりをたくさんぬった', 'くすりやさんでたくさん']) {
    assert.equal(classifyInput(t), null, t);
  }
});
test('FCS_3 must: 薬を「買う・もらう」から「のむ・死ぬ」に続く文は、命の案内に戻す(日本語だけ・多言語の両方)', () => {
  for (const t of ['くすりをたくさんかって、ぜんぶのむ', '薬をたくさん買って全部飲む', 'くすりをいっぱいもらって、いっきにのむ', '薬をたくさんもらって死ぬ',
    'くすりをたくさんかってきた。ぜんぶのんじゃおうかな', 'くすりをたくさんかってしぬ', 'くすりをたくさんもらって、まとめてのもう', 'くすりをいっぱいかって、のんでしまいたい']) {
    assert.equal(classifyInput(t), 'emergency', t);
    assert.equal(classifyInput(t, MULTI), 'emergency', `多言語 ${t}`);
  }
  // 買う・もらうだけの文、別の文に「のむ」がある時(。で切れる時)は、今までどおり拾わない
  for (const t of ['くすりをたくさんかった', '薬をたくさん買った', 'くすりをたくさんもらった。ジュースをのむ', '薬をたくさん買ってきた。おなかがすいた', 'くすりをたくさんかってきた。おかあさんにわたした']) {
    assert.equal(classifyInput(t), null, t);
    assert.equal(classifyInput(t, MULTI), null, `多言語 ${t}`);
  }
});

test('FCS_3 should 1: 「包丁で刺してね」は拾う。食べ物の「さしてたべる」は外すが、同じ文におどし(やる)があれば拾う', () => {
  for (const t of ['包丁で刺してね', 'ナイフでさしてね', 'ナイフで刺してねって言われた', 'ナイフで刺してたべさせてやる', '包丁でさしてたべてやる', '包丁で刺して食べてやろう']) {
    assert.equal(classifyInput(t), 'emergency', t);
    assert.equal(classifyInput(t, MULTI), 'emergency', `多言語 ${t}`);
  }
  for (const t of ['ナイフでさしてたべる', '包丁で刺して食べる', 'ほうちょうでさしてたべたい', 'ほうちょうでさしみ', 'ナイフでころがす']) assert.equal(classifyInput(t), null, t);
});

test('FCS_4 must: 「包丁でさしてたべちゃうぞ」などのおどしは命の案内に戻す。食べ物の「さしてたべる」「ころころ」は外したまま', () => {
  for (const t of ['包丁でさしてたべちゃうぞ', 'ナイフで刺してたべさせるぞ', 'ほうちょうでさしてたべちゃうよ', 'ナイフで刺してたべさせてやるぞ']) {
    assert.equal(classifyInput(t), 'emergency', t);
    assert.equal(classifyInput(t, MULTI), 'emergency', `多言語 ${t}`);
  }
  for (const t of ['ナイフでさしてたべる', '包丁で刺して食べる', 'ほうちょうでさしてたべたい', 'ほうちょうでころころ', 'ほうちょうでさしみをつくった']) {
    assert.equal(classifyInput(t), null, t);
    assert.equal(classifyInput(t, MULTI), null, `多言語 ${t}`);
  }
});

test('FCS_4 should 2: 薬をたくさん買った次の文で「のむ」なら命の案内。ふつうの次の文は拾わない', () => {
  for (const t of ['くすりをたくさんかってきた。あしたのむ', '薬をたくさん買った。明日飲む', 'くすりをいっぱいもらった。それをのむ']) {
    assert.equal(classifyInput(t), 'emergency', t);
    assert.equal(classifyInput(t, MULTI), 'emergency', `多言語 ${t}`);
  }
  for (const t of ['くすりをたくさんもらった。ジュースをのむ', 'かぜぐすりをかってきた。あしたのむ', 'くすりをたくさんかってきた。おかあさんにわたした']) {
    assert.equal(classifyInput(t), null, t);
    assert.equal(classifyInput(t, MULTI), null, `多言語 ${t}`);
  }
});

test('FCS_3 should 2: 「くすりをたくさんうった」は文全体で決める(店・お金など売る話は外す。決められなければ拾う)', () => {
  for (const t of ['くすりをたくさんうった', 'くすりをいっぱいうった', 'くすりをたくさんうって、しぬ', '薬をたくさん打った', 'お店でくすりをたくさんうって、しにたい']) {
    assert.ok(classifyInput(t), t);
    assert.equal(classifyInput(t, MULTI) != null, true, `多言語 ${t}`);
  }
  for (const t of ['薬をたくさん売った', 'お店でくすりをたくさんうった', 'くすりをたくさんうって、おかねをもらった', 'くすりやさんがくすりをたくさんうった']) {
    assert.equal(classifyInput(t), null, t);
  }
  assert.equal(classifyInput('くすりをたくさんうった'), 'emergency');
});

test('FCS_3 should 3: 大文字の「I\'d Be Better Off Dead」「Im Better Off Dead」は小文字と同じに拾う。題名の「Better Off Dead」は空ける', () => {
  for (const t of ["I'd Be Better Off Dead", 'Im Better Off Dead', "I'M Better Off Dead", 'I Am Better Off Dead', "I'm Better Off Dead", "I'D BE BETTER OFF DEAD", 'I AM BETTER OFF DEAD', "i'd be better off dead", "I'd be better off dead"]) {
    assert.equal(classifyInput(t), 'distress', t);
    assert.equal(classifyInput(t, MULTI), 'distress', `多言語 ${t}`);
  }
  for (const t of ['Better Off Dead', 'Better Off Dead って曲']) assert.equal(classifyInput(t), null, t);
  // 「laughing」の慣用句でも、同じ文に自分を責める言葉があれば拾う
  assert.equal(classifyInput('I want to die laughing at myself, i hate me'), 'distress');
  assert.equal(classifyInput('I want to die laughing'), null);
  assert.equal(classifyInput('I want to die laughing. i hate me'), null);
});