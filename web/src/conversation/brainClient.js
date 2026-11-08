// サーバーの /api/chat を読んで、イベントを 1 つずつ渡す。
// - 手元のサーバー: Server-Sent Events で 1 つずつ流れてくる
// - 公開の関数(契約 K5): まとめて 1 回の JSON { brain, fallback, reason, notice, events, ms } で返る。同じ順に 1 つずつ渡す
// 記憶の合鍵があれば見出し x-memory-key、合言葉(公開のリンク)があれば見出し x-demo-pass で送る(URL に入れない)。
import { memoryHeaders } from '../ui/memoryKey.js';
import { demoHeaders } from './demoPass.js';

/**
 * 公開の関数のまとめた返事を、手元のサーバーと同じイベントの並びにする。
 * 仮の頭脳になった回は、先に { type:'meta', fallback:true, notice } を出す(画面が「仮の頭脳です」を出す)。
 */
export function dispatchJson(data, onEvent) {
  const d = data && typeof data === 'object' ? data : {};
  if (d.fallback || d.notice) onEvent({ type: 'meta', fallback: Boolean(d.fallback), reason: String(d.reason ?? ''), notice: String(d.notice ?? '') });
  for (const ev of Array.isArray(d.events) ? d.events : []) if (ev && typeof ev === 'object') onEvent(ev);
  onEvent({ type: 'done', serverMs: Number.isFinite(d.ms) ? d.ms : null });
}

/**
 * @param {object} body サーバーに渡す内容
 * @param {(ev:object)=>void} onEvent
 * @param {AbortSignal} signal
 */
export async function streamChat(body, onEvent, signal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    // ML1: お店の端末(本文 memory:'off')は、合鍵があっても送らない(合鍵は切り替えの時に捨てる。ここでも二重に止める)
    headers: { 'content-type': 'application/json', ...(body?.memory === 'off' ? {} : memoryHeaders()), ...demoHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw Object.assign(new Error(`会話のサーバーが答えません (${res.status})`), { status: res.status });
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    dispatchJson(await res.json(), onEvent);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5)));
      } catch (err) {
        console.warn('読めないイベント:', line, err.message);
      }
    }
  }
}
