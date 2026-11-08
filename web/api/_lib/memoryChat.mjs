// 公開の /api/chat の記憶(契約 K4)。合言葉と上限を見た後に 1 回呼ぶ(chat.mjs)。
// - 合鍵(見出し x-memory-key)がある人: S3 の chatMemory。覚える・「わすれて」で全部消す・覚えていることを頭脳へ渡す。
//   「わすれて」の返事は、その子の人格の文の言い方で言う(persona を渡す。手元のサーバーと同じ)
// - 合鍵がまだ無い人: 覚える事が出た最初の回にだけ、合鍵を作って覚える(開いただけでは作らない)。
//   合鍵は返事のイベント { type:'memory', key, added } で渡す(画面はそれを持って、次から見出しで送る)
// 置き場を使う回は、使う前に記憶の入口(/api/memory)と同じ接続元ごとの 1 分の数えを通す。超えたら記憶なしで話す(CRITsec2 N3)。
// 置き場が使えない時も、記憶なしで話を続ける(会話を止めない)。
import { chatMemory, memoryConfig, NEW_PER_MINUTE } from '../../server/memory/handler.mjs';
import { createKvMemory } from '../../server/memory/kv.mjs';
import { extractFacts } from '../../server/memory/reflect.mjs';
import { characterOf } from '../../server/memory/store.mjs';
import { redactSecrets } from '../../src/conversation/secrets.js';
import { clientId } from './gate.mjs';
import { countMemoryUse } from './memory.mjs';

const none = () => ({ handled: false, events: [], memory: null, learned: [] });

/**
 * @param {Request} request
 * @param {string} text 使う人の言葉(sanitize の後)
 * @param {object} deps
 * @param {object} deps.cfg readConfig() の値
 * @param {object} deps.store 置き場(store.mjs)
 * @param {string} [deps.persona] その子の人格の文(sanitize の後)。「わすれて」の返事の言い方に使う
 * @returns {Promise<{handled:boolean, events:object[], memory:{text:string,items:object[]}|null, learned:object[]}>}
 */
export async function rememberForChat(request, text, { cfg, store, now = Date.now, env = process.env, persona = '', memoryOff = false }) {
  // ML1: お店の端末(本文 memory:'off')は、記憶の道を通らない(置き場を使わない・数えない・合鍵を作らない・「わすれて」も頭脳へ)
  if (memoryOff) return none();
  const memCfg = { passphrase: cfg.passphrase, maxBodyBytes: cfg.maxBodyBytes };
  const hasKey = Boolean(request.headers.get('x-memory-key'));
  const facts = hasKey ? [] : extractFacts(redactSecrets(String(text ?? '')).text);
  if (!hasKey && !facts.length) return none(); // 置き場を使わない回は数えない
  if ((await countMemoryUse(request, { cfg, store, now })) !== 'ok') return none();
  if (hasKey) return chatMemory(request, text, { store, cfg: memCfg, now, env, persona: String(persona ?? '') });
  try {
    // 合鍵を作る回数は、記憶の入口(/api/memory/new)と同じ 1 分の上限で数える。超えたら覚えずに話す
    const n = await store.incr(`ycm:nc:${clientId(request)}:${Math.floor(now() / 60000)}`, { ttlSeconds: 120 });
    if (n > NEW_PER_MINUTE) return none();
    const mem = createKvMemory({ store, pepper: memoryConfig(memCfg, env).pepper, now });
    const made = await mem.create();
    const learned = await mem.add(made.key, facts, characterOf(request.headers.get('x-yc-character') ?? ''));
    const added = learned.map(({ id, kind, text: t }) => ({ id, kind, text: t }));
    const ev = { type: 'memory', key: made.key, added, notice: made.notice, retentionDays: made.retentionDays, expiresAt: made.expiresAt };
    return { handled: false, events: [ev], memory: null, learned };
  } catch {
    return none();
  }
}
