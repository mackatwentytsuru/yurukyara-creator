// Vercel の関数: POST /api/chat。中身は _lib/chat.mjs(試験はそちらを直接呼ぶ)。
import { mockReply, runTurn } from '../server/brain.mjs';
import { sanitizeChatBody } from '../server/validate.mjs';
import { handleChat } from './_lib/chat.mjs';
import { readConfig } from './_lib/config.mjs';
import { storeFor } from './_lib/store.mjs';

export async function POST(request) {
  const cfg = readConfig();
  return handleChat(request, { cfg, store: storeFor(cfg), runTurn, mockReply, sanitize: sanitizeChatBody });
}

export async function GET(request) {
  const cfg = readConfig();
  return handleChat(request, { cfg, store: storeFor(cfg), runTurn, mockReply, sanitize: sanitizeChatBody });
}
