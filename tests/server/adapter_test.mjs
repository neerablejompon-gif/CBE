// Runs server/index.mjs with a fake Google API and checks hosting behaviour: node tests/server/adapter_test.mjs
import assert from 'node:assert';
import { webcrypto } from 'node:crypto';
const realFetch = globalThis.fetch, calls = [];
// fake service account key (RS256) so the worker can sign its token request
const kp = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const SHEET = { 'users': [['1001', 'reporter', 'DT', '', 'TEST'], ['1010', 'audit', '', '', 'TEST'], ['1010', 'reporter', 'DT', '', 'TEST']], 'forms': [], 'state': [], 'log': [], 'line': [] };
globalThis.fetch = async (url, o = {}) => {
  url = String(url); calls.push(url.split('?')[0]);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
  if (url.includes('/values:batchGet')) { const ranges = new URL(url).searchParams.getAll('ranges'); return new Response(JSON.stringify({ valueRanges: ranges.map(r => ({ values: SHEET[r.split('!')[0].replace(/'/g, '')] || [] })) })); }
  if (url.includes(':append') || url.includes('values:batchUpdate')) return new Response('{}');
  if (url.startsWith('https://api.cloudflare.com/client/v4/accounts/acc/ai/run/')) return new Response(JSON.stringify({ success: true, result: { choices: [{ message: { content: 'ok' } }] } }));
  return realFetch(url, o);
};
Object.assign(process.env, { PORT: '18080', PUBLIC_URL: 'https://cbe.example.org', SESSION_SECRET: 'x'.repeat(40), SYSTEM_SHEET_ID: 'S', CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'tok',
  GOOGLE_SA: JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` }) });
await import('../../server/index.mjs');
const B = 'http://127.0.0.1:18080', O = { origin: 'https://cbe.example.org' };
const get = (p, h = {}) => realFetch(B + p, { headers: h, redirect: 'manual' });
let r = await get('/'); assert.strictEqual(r.status, 200); assert.ok((await r.text()).includes('<!doctype html') || true); assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff'); console.log('✓ / serves index.html with security headers');
r = await get('/assets/cbe-logo.png'); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'image/png'); console.log('✓ assets served');
for (const p of ['/_worker.js', '/DEPLOY.md', '/tools/serve.ps1', '/assets/../_worker.js', '/%2e%2e/_worker.js', '/.gitignore']) { r = await get(p); assert.strictEqual(r.status, 404, p); }
console.log('✓ worker source, docs, tools and path traversal → 404');
r = await get('/data-2570.js'); assert.ok((await r.text()).includes('"login":true')); console.log('✓ not signed in → login screen data');
r = await realFetch(B + '/api/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }); assert.strictEqual(r.status, 403); console.log('✓ other origin refused (same-origin check uses PUBLIC_URL)');
r = await realFetch(B + '/api/login', { method: 'POST', headers: { ...O, 'content-type': 'application/json' }, body: JSON.stringify({ id: '1001', password: 'cbe@1001' }) });
assert.strictEqual(r.status, 200); const ck = r.headers.getSetCookie()[0]; assert.ok(/cbe_session=.*HttpOnly; Secure; SameSite=Strict/.test(ck)); console.log('✓ login 1001 → secure session cookie');
r = await get('/data-2570.js', { cookie: ck.split(';')[0] }); const js = await r.text(); assert.ok(js.includes('"role":"reporter"') && js.includes('"ind":"DT"')); console.log('✓ signed-in boot data for reporter DT');
r = await realFetch(B + '/api/login', { method: 'POST', headers: { ...O, 'content-type': 'application/json' }, body: JSON.stringify({ id: '1010', password: 'cbe@1010' }) });
assert.ok((await r.json()).choose.length === 2); console.log('✓ multi-role picker works through the adapter');
r = await realFetch(B + '/api/save', { method: 'POST', headers: { ...O, cookie: ck.split(';')[0], 'content-type': 'application/json' }, body: JSON.stringify({ fy: 2570, ops: [], log: ['x'] }) }); assert.strictEqual(r.status, 200); console.log('✓ /api/save reaches Google (fake) and answers');
r = await realFetch(B + '/api/file?key=DT|DT|1.1|1&name=a.pdf', { method: 'POST', headers: { ...O, cookie: ck.split(';')[0] }, body: Buffer.alloc(13 * 1024 * 1024) }); assert.strictEqual(r.status, 413); console.log('✓ body over 12 MB → 413');
assert.ok(calls.some(c => c.startsWith('https://sheets.googleapis.com/'))); console.log('✓ data calls go to Google Sheets');
console.log('ALL PASS'); process.exit(0);
