// Runs mockup/_worker.js (the Cloudflare Pages worker) unchanged on an ordinary Node.js server.
// Data stays in Google Sheets/Drive; this replaces only Cloudflare's hosting:
//   env.ASSETS → static files from mockup/ (allow-list), env.AI → Workers AI REST API, ctx.waitUntil → background promises.
// Usage: node --env-file=.env server/index.mjs   (Node 20.6+; see server/README.md)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.APP_DIR || path.join(here, '..', 'mockup'));
const PORT = +process.env.PORT || 8080;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, ''); // the address users type, e.g. https://cbe.raot.co.th
const MAX_BODY = 12 * 1024 * 1024; // evidence files are limited to 10 MB by the app

const worker = (await import(pathToFileURL(path.join(ROOT, '_worker.js')).href)).default;

/* ---------- env: the same names as the Cloudflare project; long JSON secrets may come from files ---------- */
const env = { ...process.env };
for (const k of ['GOOGLE_SA', 'DRIVE_OAUTH']) if (!env[k] && env[k + '_FILE']) env[k] = fs.readFileSync(env[k + '_FILE'], 'utf8').trim();
for (const k of ['GOOGLE_SA', 'SESSION_SECRET', 'SYSTEM_SHEET_ID']) if (!env[k]) console.warn(`[cbe] warning: ${k} is not set`);

// Workers AI through Cloudflare's REST API (same models and quota as the binding); unset = AI features fall back or stay off
if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) env.AI = {
  async run(model, input) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST', headers: { authorization: 'Bearer ' + env.CF_API_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(`workers ai ${r.status} ${JSON.stringify(j.errors || j).slice(0, 200)}`);
    return j.result;
  }
};

/* ---------- static files: only what the browser needs (never _worker.js, tools/, docs) ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/privacy.html': 'privacy.html', '/privacy': 'privacy.html' };
env.ASSETS = {
  async fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const rel = PAGES[p] || (/^\/assets\/[\w.\-]+$/.test(p) ? p.slice(1) : null);
    if (!rel) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    try {
      const data = await fs.promises.readFile(path.join(ROOT, rel));
      return new Response(data, { headers: { 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream', 'cache-control': rel.endsWith('.html') ? 'no-cache' : 'public, max-age=86400' } });
    } catch (e) { return new Response('Not found', { status: 404 }); }
  }
};

const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN' };

/* ---------- Node request → web Request → worker → Node response ---------- */
const server = http.createServer(async (nreq, nres) => {
  try {
    const chunks = []; let size = 0;
    for await (const c of nreq) { size += c.length; if (size > MAX_BODY) { nres.writeHead(413).end('Payload too large'); return; } chunks.push(c); }
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (v != null && !k.startsWith(':')) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    // the worker uses the request URL as the site's origin (same-origin checks, links in LINE messages)
    const url = PUBLIC_URL + nreq.url;
    const ip = String(nreq.headers['x-forwarded-for'] || nreq.socket.remoteAddress || '').split(',')[0].trim();
    if (ip) headers.set('cf-connecting-ip', ip); // login lockout is per employee ID + IP
    const req = new Request(url, { method: nreq.method, headers, body: ['GET', 'HEAD'].includes(nreq.method) ? undefined : Buffer.concat(chunks) });
    const pending = [];
    const res = await worker.fetch(req, env, { waitUntil: p => pending.push(Promise.resolve(p).catch(e => console.error('[cbe] background', e))), passThroughOnException() {} });
    const out = {}; res.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (cookies.length) out['set-cookie'] = cookies;
    for (const [k, v] of Object.entries(SECURITY)) if (!(k in out)) out[k] = v;
    nres.writeHead(res.status, out);
    nres.end(nreq.method === 'HEAD' ? undefined : Buffer.from(await res.arrayBuffer()));
    Promise.allSettled(pending);
  } catch (e) {
    console.error('[cbe] request failed', e);
    if (!nres.headersSent) nres.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    nres.end(JSON.stringify({ error: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' }));
  }
});
server.requestTimeout = 60e3;
server.listen(PORT, () => console.log(`[cbe] listening on :${PORT} · public ${PUBLIC_URL} · app ${ROOT} · Workers AI ${env.AI ? 'on' : 'off'} · Gemini ${env.GEMINI_API_KEY ? 'on' : 'off'}`));
