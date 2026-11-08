// 接客モード(店の端末)の道。決まりは kiosk.mjs。
//   GET  /api/kiosk/settings  この PC の中からだけ。いまの設定(番号は返さない)と、QR に入れる住所があるか
//   POST /api/kiosk/settings  この PC の中からだけ(書く)。番号・ことば・お店のきまり・放っておく時間
//   GET  /api/kiosk/qr        この PC の中からだけ。店の端末を開く QR に入れる文
//   GET  /api/kiosk/config?t= 店の端末から。見せてよい設定だけ(番号は返さない)
//   POST /api/kiosk/exit      店の端末から。番号が合えば 200、違えば 403、5 回違うと 5 分止めて 429
import { join } from 'node:path';
import { createKiosk } from './kiosk.mjs';

const MAX_BODY = 8 * 1024;
const NO_STORE = { 'cache-control': 'no-store' };

/**
 * @param {object} o
 * @param {{kioskOrigin:string, kioskSecret:string}} o.config
 * @param {string} o.logDir
 * @param {(req:any, limit?:number)=>Promise<any>} o.readBody
 * @param {(res:any, status:number, obj:any)=>any} o.json
 * @param {(req:any, opt?:{write?:boolean})=>boolean} o.isLocalRequest この PC の中からの呼び出しか(update.mjs と同じ決まり)
 * @param {ReturnType<typeof createKiosk>} [o.kiosk] 試験用
 */
export function createKioskRoutes({ config, logDir, readBody, json, isLocalRequest, kiosk = createKiosk({ file: join(logDir, 'kiosk.json'), secret: config.kioskSecret }) }) {
  const send = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...extra }).end(JSON.stringify(obj));
    return true;
  };
  const originOk = () => /^https?:\/\/[^/?#@\s]+$/i.test(String(config.kioskOrigin ?? '').replace(/\/+$/, ''));

  return async function handle(req, res, path, url) {
    if (!path.startsWith('/api/kiosk/')) return false;
    const write = req.method === 'POST';

    if (path === '/api/kiosk/config' && req.method === 'GET') {
      // 札は見出し x-kiosk-token(画面はこちら)か、?t=(確かめの道具用)で受ける
      const token = typeof req.headers['x-kiosk-token'] === 'string' ? req.headers['x-kiosk-token'] : (url.searchParams.get('t') ?? '');
      return send(res, 200, kiosk.configFor(token));
    }

    if (path === '/api/kiosk/exit' && write) {
      let body;
      try {
        body = await readBody(req, MAX_BODY);
      } catch (err) {
        return send(res, err.status ?? 400, { error: err.message });
      }
      const r = kiosk.exit(typeof body?.pin === 'string' ? body.pin : '');
      if (r.ok) return send(res, 200, { ok: true });
      if (r.status === 429) return send(res, 429, { ok: false, locked: true, retryAfterS: r.retryAfterS }, { 'retry-after': String(r.retryAfterS) });
      return send(res, r.status, { ok: false, remaining: r.remaining ?? null, error: r.error ?? 'pin-wrong' });
    }

    // ここから下は、この PC の中からだけ(店の端末・LAN の別の端末・よその頁からは断る)
    if (!['/api/kiosk/settings', '/api/kiosk/qr'].includes(path)) {
      json(res, 404, { error: '見つかりません' });
      return true;
    }
    if (!isLocalRequest(req, { write })) return send(res, 403, { error: 'この PC の中からだけです' });

    if (path === '/api/kiosk/settings' && req.method === 'GET') {
      return send(res, 200, { ...kiosk.publicSettings(), originSet: originOk(), secure: String(config.kioskOrigin ?? '').startsWith('https://') });
    }
    if (path === '/api/kiosk/settings' && write) {
      let body;
      try {
        body = await readBody(req, MAX_BODY);
      } catch (err) {
        return send(res, err.status ?? 400, { error: err.message });
      }
      const r = kiosk.update(body ?? {});
      if (r.ok) return send(res, 200, { ok: true, ...r.settings, originSet: originOk(), secure: String(config.kioskOrigin ?? '').startsWith('https://') });
      return send(res, r.status, { ok: false, error: r.error ?? 'locked', remaining: r.remaining ?? null, retryAfterS: r.retryAfterS ?? null });
    }
    if (path === '/api/kiosk/qr' && req.method === 'GET') {
      const r = kiosk.qr(config.kioskOrigin, url.searchParams.get('character') ?? '');
      return send(res, r.ok ? 200 : 409, r);
    }
    return send(res, 405, { error: 'この方法は使えません' });
  };
}
