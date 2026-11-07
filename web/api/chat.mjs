// Vercel の関数: POST /api/chat。中身は _lib/chat.mjs(試験はそちらを直接呼ぶ)。
// 頭脳は本物も仮も web/server/brain.mjs の runTurn(仮は brain: 'mock')。記憶は _lib/memoryChat.mjs(S3 の chatMemory)。
// 本文の点検は、公開の決まりの版をはっきり渡す(環境変数 VERCEL の有り無しに頼らない。CRITsec F7)。
import { runTurn } from '../server/brain.mjs';
import { sanitizePublicChatBody } from '../server/validate.mjs';
import { handleChat } from './_lib/chat.mjs';
import { readConfig } from './_lib/config.mjs';
import { rememberForChat } from './_lib/memoryChat.mjs';
import { storeFor } from './_lib/store.mjs';

export async function POST(request) {
  const cfg = readConfig();
  return handleChat(request, { cfg, store: storeFor(cfg), runTurn, remember: rememberForChat, sanitize: sanitizePublicChatBody });
}

// POST 以外は 405(handleChat が答える)
export const GET = POST;
