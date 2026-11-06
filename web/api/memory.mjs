// Vercel の関数: /api/memory と /api/memory/<下の道>(vercel.json の書き換えでここへ集める)。
// 中身は S3 の web/server/memory/handler.mjs の handleMemory(request, { store, cfg, now })。
import { handleMemoryRoute } from './_lib/memory.mjs';
import { readConfig } from './_lib/config.mjs';
import { storeFor } from './_lib/store.mjs';

async function loadHandler() {
  try {
    return await import('../server/memory/handler.mjs');
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw err;
  }
}

async function route(request) {
  const cfg = readConfig();
  return handleMemoryRoute(request, { cfg, store: storeFor(cfg), loadHandler });
}

export const GET = route;
export const POST = route;
export const DELETE = route;
