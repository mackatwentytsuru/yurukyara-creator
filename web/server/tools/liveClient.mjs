// 立ち上がっている会話のサーバー(手元の node server/index.mjs か、公開の関数)に、HTTP だけで話しかける道具。
// - 頭脳の鍵はこの道具に渡さない。鍵はサーバーの中だけにある(本人が自分の端末で入れて立ち上げる)
// - 合鍵(x-memory-key)・番号・合言葉は、呼ぶ側の記録に書かない(redactSecrets で伏せる)
// - 返事は 2 つの形を読む: 手元のサーバーの流れ(text/event-stream)と、公開の関数のまとめた JSON(events)

const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/** 送り先の書き方を確かめる。http(s) だけ。記録には「この端末か・外か」と番号だけを残す */
export function describeBase(base) {
  let u;
  try {
    u = new URL(base);
  } catch {
    throw new Error(`--base の書き方が違います(例 http://127.0.0.1:8787)`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('--base は http か https だけ');
  const loopback = LOOPBACK.has(u.hostname);
  return { loopback, label: loopback ? `この端末(${u.port || (u.protocol === 'https:' ? 443 : 80)} 番)` : '外のサーバー(名前は記録しない)' };
}

/** 記録に出してはいけない文字(合鍵・番号・合言葉)を伏せる */
export function redactSecrets(text, secrets) {
  let s = String(text ?? '');
  for (const v of secrets) if (typeof v === 'string' && v.length >= 4) s = s.split(v).join('[伏せた]');
  return s;
}

/** 1 回の返事のイベントの列から、記録に要る所だけを取り出す */
export function summarizeEvents(events) {
  const metas = events.filter((e) => e.type === 'meta');
  const said = events.filter((e) => e.type === 'say').map((e) => e.text);
  const usageMeta = metas.findLast((m) => m.usage);
  const brainMeta = metas.find((m) => m.brain);
  return {
    brain: brainMeta?.brain ?? null,
    model: brainMeta?.model ?? null,
    safety: brainMeta?.safety ?? null,
    limited: metas.some((m) => m.limited === true),
    notice: metas.find((m) => m.notice)?.notice ?? null,
    calledBrain: Boolean(usageMeta), // 本物の頭脳を呼んだ回だけ、最後に usage の meta が来る
    usage: usageMeta?.usage ?? null,
    said,
    memoryAdded: events.filter((e) => e.type === 'memory' && Array.isArray(e.added)).flatMap((e) => e.added.map((a) => a.text)),
    memoryForgotten: events.some((e) => e.type === 'memory' && e.forgotten === true),
    error: events.find((e) => e.type === 'error')?.message ?? null,
  };
}

/**
 * @param {{base:string, pass?:string, fetchImpl?:typeof fetch, timeoutMs?:number}} o pass は合言葉(公開は x-demo-pass、手元は x-app-pass)
 */
export function createLiveClient({ base, pass = '', fetchImpl = fetch, timeoutMs = 60000 }) {
  describeBase(base);
  const url = (p) => new URL(p, base).href;
  const headers = (memoryKey) => ({
    'content-type': 'application/json',
    ...(pass ? { 'x-demo-pass': pass, 'x-app-pass': pass } : {}),
    ...(memoryKey ? { 'x-memory-key': memoryKey } : {}),
  });

  async function request(method, path, { body, memoryKey } = {}) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url(path), { method, headers: headers(memoryKey), body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 会話 1 回。返事の最初の文が届くまでの時間(ms)も測る */
  async function chat(body, { memoryKey } = {}) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const t0 = performance.now();
    let firstSayMs = null;
    const events = [];
    try {
      const res = await fetchImpl(url('/api/chat'), { method: 'POST', headers: headers(memoryKey), body: JSON.stringify(body), signal: ac.signal });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) return { status: res.status, events, wallMs: Math.round(performance.now() - t0), firstSayMs };
      if (type.includes('text/event-stream')) {
        const decoder = new TextDecoder();
        let buf = '';
        const take = (block) => {
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) return;
          try {
            const ev = JSON.parse(line.slice(5));
            if (ev.type === 'say' && firstSayMs === null) firstSayMs = Math.round(performance.now() - t0);
            events.push(ev);
          } catch {
            // 読めない行は飛ばす
          }
        };
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            take(buf.slice(0, i));
            buf = buf.slice(i + 2);
          }
        }
        if (buf.trim()) take(buf);
      } else {
        const data = await res.json();
        firstSayMs = Math.round(performance.now() - t0);
        for (const ev of data?.events ?? []) events.push(ev);
        if (data?.notice) events.push({ type: 'meta', notice: data.notice, fallback: data.fallback === true });
      }
      return { status: res.status, events, wallMs: Math.round(performance.now() - t0), firstSayMs };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    status: () => request('GET', '/api/status'),
    newMemory: () => request('POST', '/api/memory/new'),
    listMemory: (memoryKey) => request('GET', '/api/memory', { memoryKey }),
    pair: (memoryKey) => request('POST', '/api/memory/pair', { memoryKey }),
    claim: (code) => request('POST', '/api/memory/claim', { body: { code } }),
    forgetAll: (memoryKey) => request('DELETE', '/api/memory', { memoryKey, body: {} }),
    chat,
  };
}
