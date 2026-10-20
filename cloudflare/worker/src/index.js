/**
 * Worker "cbe-api": รับ POST /api {token, action, payload} จาก Pages แล้วส่งให้ Durable Object ตัวเดียว
 * ซึ่งรันคำขอทีละรายการ (แทน LockService) เก็บ session และจำกัดความถี่การเข้าสู่ระบบต่อ IP
 */
import { DurableObject } from 'cloudflare:workers';
import { createGoogle } from './google.js';
import { createEngine } from './engine.js';

const MAX_BODY = 15 * 1024 * 1024; // ไฟล์ 10 MB หลังเข้ารหัส base64 + ข้อมูลอื่น
const LOGIN_LIMIT = 20;            // ครั้งต่อ IP ต่อ 10 นาที
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const GENERIC = 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่ หากยังพบปัญหาแจ้งผู้ดูแลระบบ';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api') return new Response('Not Found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BODY) return json({ ok: false, error: 'ข้อมูลที่ส่งใหญ่เกินไป' }, 413);
    const stub = env.CBE.get(env.CBE.idFromName('main'));
    return stub.fetch(request);
  }
};

export class CbeApi extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
    this.hits = new Map();
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL)');
    const store = {
      async get(k) {
        const r = sql.exec('SELECT v, exp FROM cache WHERE k = ?', k).toArray()[0];
        if (!r) return null;
        if (r.exp < Date.now()) { sql.exec('DELETE FROM cache WHERE k = ?', k); return null; }
        return r.v;
      },
      async put(k, v, ttl) { sql.exec('INSERT OR REPLACE INTO cache (k, v, exp) VALUES (?, ?, ?)', k, v, Date.now() + ttl * 1000); },
      async remove(k) { sql.exec('DELETE FROM cache WHERE k = ?', k); }
    };
    this.engine = null;
    this.init = () => {
      if (!this.engine) {
        if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.DB_SPREADSHEET_ID) throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_JSON หรือ DB_SPREADSHEET_ID');
        this.engine = createEngine({
          google: createGoogle(env.GOOGLE_SERVICE_ACCOUNT_JSON),
          store,
          props: { DB_SPREADSHEET_ID: env.DB_SPREADSHEET_ID },
          log: (lv, t) => (lv === 'error' ? console.error : lv === 'warn' ? console.warn : console.log)(t)
        });
      }
      return this.engine;
    };
    this.sweep = () => sql.exec('DELETE FROM cache WHERE exp < ?', Date.now());
  }

  limited(ip) {
    const now = Date.now(), win = 10 * 60000;
    const h = (this.hits.get(ip) || []).filter(t => now - t < win);
    h.push(now);
    this.hits.set(ip, h);
    if (this.hits.size > 5000) this.hits.clear();
    return h.length > LOGIN_LIMIT;
  }

  async fetch(request) {
    let body;
    try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'คำขอไม่ถูกต้อง' }, 400); }
    if (!body || typeof body.action !== 'string' || body.action.length > 40) return json({ ok: false, error: 'คำขอไม่ถูกต้อง' }, 400);
    if (body.action === 'login') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (this.limited(ip)) return json({ ok: false, error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 10 นาที' }, 429);
    }
    // รันทีละคำขอ เพื่อไม่ให้การเขียนชีทชนกัน
    const job = this.queue.then(async () => {
      try {
        const res = await this.init().api(body.token || null, body.action, body.payload || {});
        if (body.action === 'login' && res.ok) this.sweep();
        return json(res);
      } catch (e) {
        console.error(body.action + ': ' + (e && e.stack || e));
        return json({ ok: false, error: GENERIC }, 500);
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
