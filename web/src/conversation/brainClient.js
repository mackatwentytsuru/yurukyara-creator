// サーバーの /api/chat(Server-Sent Events)を読んで、イベントを 1 つずつ渡す。

/**
 * @param {object} body サーバーに渡す内容
 * @param {(ev:object)=>void} onEvent
 * @param {AbortSignal} signal
 */
export async function streamChat(body, onEvent, signal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`会話のサーバーが答えません (${res.status})`);
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
