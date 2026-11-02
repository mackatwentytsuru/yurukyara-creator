// RoomPlan が付けた機械的な名前(ドア・窓・テーブル…)を、Claude に「その場所での呼び名と案内の一言」に直してもらう工程の、
// プロンプト作りと返答の検証。API を呼ぶ部分は name_landmarks.mjs。ここは node だけで試せる。
//
// 守ること: Claude が変えてよいのは name と note だけ。位置は絶対に変えさせない(index で対応づけ、位置は元のまま)。

export function buildPrompt(place, hint = '') {
  const lines = place.landmarks.map((l, i) => {
    const [x, y, z] = l.position;
    return `${i}: 名前=${l.name} 位置(x=${x}, y=${y}, z=${z}) m 説明=${l.note}`;
  });
  return [
    'あなたは、お店や施設の受付キャラが「場所を案内するときの呼び名」を決める係です。',
    `場所: ${place.name}。${hint ? `お店・施設の種類や事情: ${hint}` : ''}`,
    '下は、3D スキャンから機械的に付いた目印の一覧です。座標は m、y が上、床が y=0 です。',
    ...lines,
    '',
    '次のルールで、各目印の name(呼び名)と note(キャラが案内に使う一言)を JSON だけで返してください。',
    '- 位置は変えません。index は上の番号のとおり、全部の目印を 1 回ずつ返します。',
    '- name は 12 文字まで、日本語、全部ちがう名前にする。複数ある物は「入口」「奥の窓」のように違いが分かる名前にする。',
    '- note は 60 文字まで、お客さんに話す口調で、位置の手がかり(奥・手前・右・左は使わず、「壁ぞい」「入口の反対側」など)を入れる。',
    '- 機械の名前と大きさから分かること以外(何の部屋か、何を売っているか)は、上の種類や事情に書かれていないかぎり想像で書かない。',
    '- 出力は次の形の JSON だけ。前置きも説明も付けない。',
    '{"landmarks":[{"index":0,"name":"...","note":"..."}]}',
  ].join('\n');
}

/** 返ってきた文から最初の JSON の塊を取り出す(```json で囲まれていても通す)。 */
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('返答に JSON が無い');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * 検証して、名前と一言だけを入れかえた新しい place を返す(元は変えない)。
 * 守れていなければ、理由を日本語で並べて投げる。
 */
export function applyNaming(place, response) {
  const problems = [];
  const items = response?.landmarks;
  if (!Array.isArray(items)) throw new Error('landmarks の配列が無い');
  const byIndex = new Map();
  for (const it of items) {
    if (!Number.isInteger(it?.index) || it.index < 0 || it.index >= place.landmarks.length) {
      problems.push(`index が範囲外: ${JSON.stringify(it?.index)}`);
      continue;
    }
    if (byIndex.has(it.index)) problems.push(`index が重なっている: ${it.index}`);
    byIndex.set(it.index, it);
    if (typeof it.name !== 'string' || it.name.trim() === '') problems.push(`index ${it.index}: name が空`);
    else if (it.name.length > 12) problems.push(`index ${it.index}: name が 12 文字を超える(${it.name.length})`);
    if (typeof it.note !== 'string') problems.push(`index ${it.index}: note が文字列でない`);
    else if (it.note.length > 60) problems.push(`index ${it.index}: note が 60 文字を超える(${it.note.length})`);
  }
  for (let i = 0; i < place.landmarks.length; i += 1) {
    if (!byIndex.has(i)) problems.push(`index ${i} の返答が無い`);
  }
  const names = [...byIndex.values()].map((it) => it.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) problems.push(`name がかぶっている: ${dup}`);
  if (problems.length > 0) throw new Error(`名付けの返答が決まりに合わない:\n- ${problems.join('\n- ')}`);

  return {
    ...place,
    landmarks: place.landmarks.map((l, i) => ({
      name: byIndex.get(i).name.trim(),
      position: [...l.position],
      note: byIndex.get(i).note,
    })),
  };
}
