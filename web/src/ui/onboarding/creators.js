// 作る道(1〜3 歩目)の受け口。台本(script.js)はこの形だけを使う:
//   creator.mode            'sample'(見本を出す)| 'local'(手元の PC の作る道具へ渡す)
//   creator.check(input)    → { class: 'yuru'|'human'|'complex', by: 'claude'|'person', message }(絵のときだけ)
//   creator.make(input)     → { id, name, sample: boolean, note }(できた子。見本なら sample: true)
//   creator.review(id, 'redo', 一言)  → { ok, message }(手元で作った子だけ。K3 の request.json へ)
// 'local' は、絵や言葉を手元の PC へ渡す道ができてからつなぐ(G1 と同じ道。creator/review のサーバー)。
// 今あるのは 'sample' だけ: Claude Code で作ってある子を、言葉に近い順に出す。絵はこの端末の外に送らない。

/** 見本の子(characters/<id>/ にある物)。words は Claude が絵を描いた元の言葉(記録のある物だけ書く) */
export const SAMPLE_CHARACTERS = [
  { id: 'mikan', name: 'みかんちゃん', note: '言葉「みかんの子。まるくて元気。頭に葉っぱが 1 枚」から Claude が描いて作った子', keys: ['みかん', 'オレンジ', 'くだもの', '果物', '葉っぱ'] },
  { id: 'd_lantern', name: 'ちょうちんくん', note: 'Claude が描いた絵から作った子', keys: ['ちょうちん', '提灯', 'あかり', '明かり', '灯り', 'お祭り'] },
  { id: 'robo', name: 'ロボくん', note: 'Claude が描いた絵から作った子', keys: ['ロボ', 'ろぼ', 'ロボット', '機械', 'メカ'] },
  { id: 'f_led', name: 'パネルくん', note: 'Claude が描いた絵から作った子', keys: ['パネル', '画面', 'LED', 'テレビ', 'モニター'] },
  { id: 'yokoso', name: 'ようこそくん', note: 'Claude が描いた絵から作った子', keys: ['ようこそ', '受付', '案内', 'いらっしゃい', 'みどり', '緑'] },
];

/** 言葉にいちばん近い見本(当たる言葉が無ければ、言葉から作った見本) */
export function pickSample(words, samples = SAMPLE_CHARACTERS) {
  const w = String(words ?? '').normalize('NFKC').toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const s of samples) {
    const hits = s.keys.filter((k) => w.includes(k.normalize('NFKC').toLowerCase())).length;
    if (hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return best ?? samples[0];
}

/**
 * 見本の道。絵の入口では、主役(手描きの絵から作った子)を出す。
 * @param {object} [o]
 * @param {{id:string, name:string}} [o.main] 主役。絵から作った見本として出す(無ければ見本の 1 番目)
 * @param {object[]} [o.samples]
 */
export function createSampleCreator({ main = null, samples = SAMPLE_CHARACTERS } = {}) {
  return {
    mode: 'sample',
    async check() {
      // Claude の確かめは手元の PC だけ。見本の道では、使う人に選んでもらう(台本がそう伝える)
      return { class: 'complex', by: 'person', message: '' };
    },
    async make(input) {
      if (input?.from === 'picture' && main?.id) {
        return { id: main.id, name: main.name, sample: true, note: '協力者が手で描いた絵から、Claude Code で作った子' };
      }
      const s = pickSample(input?.words ?? '', samples);
      return { id: s.id, name: s.name, sample: true, note: s.note };
    },
  };
}
