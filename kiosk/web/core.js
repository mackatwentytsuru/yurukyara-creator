// キオスクの画面の、画面に触らない部分(試験できる)。会話サーバー(/api/chat)との受け渡し・履歴・待ち受けの判定・参照の札。

export const REASON_LABEL = {
  complaint: 'ご意見',
  payment: 'お支払い',
  emergency: '緊急',
  age: '年齢・お酒',
  booking: 'ご予約',
  unknown: 'わたしでは分からないこと',
};

/** 流れてくる文字(SSE)を、届いた分だけ読む。まだ 1 件に満たない端は rest に残す */
export function parseEvents(buffer) {
  const events = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const line = part.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {
      // 壊れた 1 件は捨てる(次の件は読む)
    }
  }
  return { events, rest };
}

/** 履歴は直近の turns 往復だけ。頭脳には user から始まる並びで渡す */
export function trimHistory(history, turns) {
  const h = history.slice(-turns * 2);
  while (h.length && h[0].role !== 'user') h.shift();
  return h;
}

/** /api/chat に渡す本文。画面と試験(kiosk/eval/run.mjs)で同じ形にする */
export function buildChatBody({ text, history, config, character, persona, venue, interview = false }) {
  return {
    interview: interview === true, // true のとき、短い往復のインタビューの話し方(web/server/prompt.mjs)
    history: trimHistory(history, config.historyTurns ?? 6),
    text,
    trigger: null,
    scene: config.scene,
    character: { name: character.name, persona },
    place: { name: venue || 'お店', info: config.placeInfo, landmarks: [] },
    expressions: character.expressions,
    expressionHints: character.expression_hints,
    motions: ['nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point'],
    useShop: true,
  };
}

/** 参照の札(「店の記憶: 料金 11/04」など)。古い・確度が低い物は注意の印 */
export function sourceTag(src) {
  const conf = src.confidence === 'low' ? ' ・確度が低い' : src.confidence === 'medium' ? ' ・公式以外' : '';
  return { text: `${src.label} ${src.updatedAt}${src.stale && !conf ? ' ・古い可能性' : conf}`, warn: Boolean(src.stale) };
}

/** 触られないまま idleSec 秒たったら、最初の画面に戻す(前の人の会話を次の人に見せない) */
export function shouldReset(lastActiveMs, nowMs, idleSec) {
  return nowMs - lastActiveMs >= idleSec * 1000;
}

/** 起動のときに使う、声の入出力の差し込み口。何も無ければ文字だけで動く */
export function resolveIO(globalIO) {
  const stt = globalIO?.stt && typeof globalIO.stt.start === 'function' ? globalIO.stt : null;
  const tts = globalIO?.tts && typeof globalIO.tts.speak === 'function' ? globalIO.tts : null;
  return { stt, tts };
}
