// LINE notifications in mockup/_worker.js, run against in-memory Google Sheets and a fake LINE API.
// node tests/line.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'cbe-line-'));
writeFileSync(join(dir, 'worker.mjs'), readFileSync(new URL('../mockup/_worker.js', import.meta.url)));
const worker = (await import(join(dir, 'worker.mjs'))).default;

// ---- fake Google Sheets: books[id][tab] = rows (row 1 = header) ----
const col = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
function parseRange(r) {
  const m = /^'?((?:[^'!]|'')+?)'?(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?)?$/.exec(r);
  return { tab: m[1].replace(/''/g, "'"), c1: m[2] ? col(m[2]) : 1, r1: m[3] ? +m[3] : 1, c2: m[4] ? col(m[4]) : 99, r2: m[5] ? +m[5] : null };
}
const books = {}, lineCalls = [];
const pad = (row, n) => { while (row.length < n) row.push(''); return row; };
async function fakeFetch(input, init = {}) {
  const url = new URL(input), method = init.method || 'GET', ok = b => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.host === 'oauth2.googleapis.com') return ok({ access_token: 'tok' });
  if (url.host === 'api.line.me') { lineCalls.push({ path: url.pathname, body: JSON.parse(init.body), retry: init.headers['x-line-retry-key'] }); return ok({}); }
  if (url.host === 'sheets.googleapis.com') {
    const [, id, rest] = /^\/v4\/spreadsheets\/([^/]+)\/values(.*)$/.exec(url.pathname), b = books[id];
    if (rest.startsWith(':batchGet')) return ok({ valueRanges: url.searchParams.getAll('ranges').map(r => {
      const q = parseRange(r), rows = b[q.tab]; if (!rows) throw new Error('no tab ' + q.tab);
      return { values: rows.slice(q.r1 - 1, q.r2 || undefined).map(x => x.slice(q.c1 - 1, q.c2)) };
    }) });
    const body = JSON.parse(init.body);
    if (rest.startsWith(':batchUpdate')) { for (const d of body.data) { const q = parseRange(d.range), rows = b[q.tab]; d.values.forEach((v, i) => { const row = rows[q.r1 - 1 + i] = pad(rows[q.r1 - 1 + i] || [], q.c1 - 1); v.forEach((x, j) => { row[q.c1 - 1 + j] = x; }); }); } return ok({}); }
    if (rest.includes(':append')) { const q = { tab: decodeURIComponent(rest.split(':append')[0].slice(1)).split('!')[0] }; body.values.forEach(v => b[q.tab].push(v.map(String))); return ok({}); }
  }
  throw new Error('unexpected fetch ' + method + ' ' + url);
}
globalThis.fetch = fakeFetch;

// ---- data: one RM form with two sub-issues; plan in November (fiscal month 1) ----
const MONTH_COL = 6; // G
const lvRow = (lv, plan, target) => { const r = pad(['', 'ระดับ ' + lv, 'ค่าเกณฑ์ ' + lv, target], MONTH_COL); plan.forEach(v => r.push(v)); return r; };
const resRow = res => { const r = pad([], MONTH_COL); res.forEach(v => r.push(v)); return r; };
const z = n => Array(12).fill(0).map((_, i) => (i === n ? 1 : 0));
const formRows = [[], [], [], [], [],
  ['1.1', 'การกำหนดนโยบาย (น้ำหนัก 10)'], lvRow(1, z(1), 1), resRow(Array(12).fill(0)), lvRow(2, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1), resRow(Array(12).fill(0)),
  ['1.2', 'การติดตามผล (น้ำหนัก 10)'], lvRow(1, z(5), 1), resRow(Array(12).fill(0))];
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
const env = { GOOGLE_SA: JSON.stringify({ client_email: 'sa@test', private_key: pem }), SESSION_SECRET: 'x'.repeat(40), SYSTEM_SHEET_ID: 'sys', CUR_FY: '2570',
  LINE_CHANNEL_SECRET: 'line-secret', LINE_CHANNEL_TOKEN: 'line-token', LINE_ADD_URL: 'https://line.me/R/ti/p/@cbe', CRON_KEY: 'cron-key', ASSETS: { fetch: () => new Response('asset') } };
function reset(cfg) {
  books.sys = { users: [['id', 'role', 'ind', 'part', 'name'], ['3002', 'reporter', 'RM', '', 'สมชาย RM'], ['1000', 'audit', '', '', 'กปม. ทดสอบ']],
    forms: [['fy', 'code', 'id'], ['2570', 'RM', 'formRM']], state: [['fy', 'store', 'key', 'value', 'by', 'at']].concat(cfg ? [['2570', 'cfg', 'plan', JSON.stringify(cfg), '1000', 'x']] : []),
    log: [['at', 'id', 'who', 'what']], line: [['id', 'line_user', 'linked_at', 'code', 'code_exp']] };
  books.formRM = { "1.สรุปรายงานผู้บริหาร": [], '2.ผลตามเกณฑ์และ GAP': formRows.map(r => r.slice()) };
  lineCalls.length = 0;
}
const pending = [];
const call = async (path, init = {}) => { const r = await worker.fetch(new Request('https://cbe.example' + path, init), env, { waitUntil: p => pending.push(p) }); await Promise.all(pending.splice(0)); return r; };
async function signIn(id) {
  const r = await call('/api/login', { method: 'POST', headers: { origin: 'https://cbe.example' }, body: JSON.stringify({ id, password: 'cbe@' + id }) });
  assert.equal(r.status, 200, 'login ' + id); return r.headers.get('set-cookie').split(';')[0];
}
const post = (path, cookie, body) => call(path, { method: 'POST', headers: { origin: 'https://cbe.example', cookie, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
function hook(events) {
  const body = JSON.stringify({ events }), sig = createHmac('sha256', env.LINE_CHANNEL_SECRET).update(body).digest('base64');
  return call('/api/line/webhook', { method: 'POST', headers: { 'x-line-signature': sig }, body });
}
const msgEv = (user, text) => ({ type: 'message', replyToken: 'rt-' + text, source: { userId: user }, message: { type: 'text', text } });
const days = (d, j) => call(`/api/notify?day=${d}${j ? '&job=' + j : ''}`, { method: 'POST', headers: { 'x-cron-key': 'cron-key' } });

let n = 0; const ok = (name, fn) => fn().then(() => { n++; console.log('  ✓ ' + name); });

reset();
const rep = await signIn('3002'), aud = await signIn('1000');
await ok('status before linking: enabled, not linked', async () => {
  const s = await (await post('/api/line/status', rep)).json(); assert.equal(s.enabled, true); assert.equal(s.linked, false); assert.equal(s.addUrl, env.LINE_ADD_URL);
});
let code;
await ok('code: 6 digits, expires in 10 minutes, stored in the line tab', async () => {
  const r = await (await post('/api/line/code', rep)).json(); code = r.code;
  assert.match(code, /^\d{6}$/); assert.ok(r.expiresAt - Date.now() > 9 * 60e3);
  assert.equal(books.sys.line[1][0], '3002'); assert.equal(books.sys.line[1][3], code);
});
await ok('webhook rejects a bad signature', async () => {
  const r = await call('/api/line/webhook', { method: 'POST', headers: { 'x-line-signature': 'nope' }, body: '{"events":[]}' }); assert.equal(r.status, 401);
});
await ok('wrong code → reply, no link', async () => {
  await hook([msgEv('U-rep', '000000')]); assert.equal(books.sys.line[1][1], ''); assert.equal(lineCalls.at(-1).path, '/v2/bot/message/reply');
});
await ok('right code links the LINE user and clears the code', async () => {
  await hook([msgEv('U-rep', code)]);
  assert.equal(books.sys.line[1][1], 'U-rep'); assert.equal(books.sys.line[1][3], '');
  assert.equal(lineCalls.at(-1).body.messages[0].type, 'flex');
  assert.ok(books.sys.log.some(r => r[3] === 'เชื่อมต่อ LINE'));
  const s = await (await post('/api/line/status', rep)).json(); assert.equal(s.linked, true);
});
await ok('a used code no longer works', async () => {
  const before = books.sys.line[1][1]; await hook([msgEv('U-other', code)]); assert.equal(books.sys.line[1][1], before);
});
await ok('expired code is refused', async () => {
  const c = (await (await post('/api/line/code', aud)).json()).code; books.sys.line.find(r => r[0] === '1000')[4] = String(Date.now() - 1);
  await hook([msgEv('U-aud', c)]); assert.equal(books.sys.line.find(r => r[0] === '1000')[1], '');
  assert.match(lineCalls.at(-1).body.messages[0].text, /หมดอายุ/);
  const c2 = (await (await post('/api/line/code', aud)).json()).code; await hook([msgEv('U-aud', c2)]);
  assert.equal(books.sys.line.find(r => r[0] === '1000')[1], 'U-aud');
});
await ok('rich menu: สถานะ → reporter status card with deep link', async () => {
  lineCalls.length = 0; await hook([msgEv('U-rep', 'สถานะ')]);
  const m = lineCalls.at(-1).body.messages[0], flat = JSON.stringify(m.contents);
  assert.equal(m.type, 'flex'); assert.match(m.altText, /สถานะรายงานผลเดือน/); assert.ok(flat.includes('ความคืบหน้าทั้งปี')); assert.ok(flat.includes('/assets/line-logo.png')); assert.ok(flat.includes('/?tab=dash'));
});
await ok('rich menu: สถานะ for กปม. → all-indicator summary', async () => {
  lineCalls.length = 0; await hook([msgEv('U-aud', 'สถานะ')]);
  assert.match(lineCalls.at(-1).body.messages[0].altText, /ส่งแล้ว \d\/8/);
});
await ok('rich menu: สถานะ from an unlinked LINE user → how to link', async () => {
  lineCalls.length = 0; await hook([msgEv('U-nobody', 'สถานะ')]);
  assert.equal(lineCalls.at(-1).body.messages[0].altText, 'ยังไม่ได้เชื่อมต่อบัญชี');
});
await ok('rich menu: กำหนดส่ง and ช่วยเหลือ', async () => {
  lineCalls.length = 0; await hook([msgEv('U-nobody', 'กำหนดส่ง'), msgEv('U-nobody', 'ช่วยเหลือ')]);
  assert.match(lineCalls[0].body.messages[0].altText, /^กำหนดส่งรายงานเดือน .+: 5 /); assert.ok(JSON.stringify(lineCalls[0].body.messages[0].contents).includes('ช่วงกรอกแผน'));
  assert.equal(lineCalls[1].body.messages[0].altText, 'ช่วยเหลือ'); assert.ok(JSON.stringify(lineCalls[1].body.messages[0].contents).includes('343'));
});
await ok('webhook error → apology reply instead of silence', async () => {
  const saved = books.sys.line; books.sys.line = null; lineCalls.length = 0;
  try { const r = await hook([msgEv('U-rep', 'สถานะ')]); assert.equal(r.status, 200); assert.match(lineCalls.at(-1).body.messages[0].text, /ระบบขัดข้อง/); }
  finally { books.sys.line = saved; }
});
await ok('notify needs the cron key', async () => {
  const r = await call('/api/notify?day=1', { method: 'POST' }); assert.equal(r.status, 401);
});
await ok('day 1: reporter gets last month\'s planned levels and late levels', async () => {
  lineCalls.length = 0;
  const realNow = Date.now; Date.now = () => Date.UTC(2026, 11, 1, 2); // 1 ธ.ค. 2569 09:00 → reports November (fiscal month 1)
  try { const r = await (await call('/api/notify?day=1&dry=1', { method: 'POST', headers: { 'x-cron-key': 'cron-key' } })).json();
    assert.equal(r.sent, 1); const m = r.messages[0]; assert.equal(m.id, '3002');
    const flat = JSON.stringify(m.contents); assert.match(m.alt, /พ\.ย\./); assert.match(m.alt, /5 ธ\.ค\. 2569/);
    assert.ok(flat.includes('1.1 ระดับ 1'), 'planned in Nov'); assert.ok(flat.includes('1.1 ระดับ 2'), 'October plan not done → late');
    assert.ok(!flat.includes('1.2 ระดับ 1'), 'March plan not due');
    assert.equal(lineCalls.length, 0, 'dry run sends nothing');
  } finally { Date.now = realNow; }
});
await ok('day 1 for real: one push per linked reporter, with a retry key', async () => {
  lineCalls.length = 0; await days(1);
  const push = lineCalls.filter(c => c.path === '/v2/bot/message/push'); assert.equal(push.length, 1); assert.equal(push[0].body.to, 'U-rep'); assert.match(push[0].retry, /^[0-9a-f-]{36}$/);
});
await ok('day 6: กปม. gets the monthly summary, reporters do not', async () => {
  lineCalls.length = 0; await days(6);
  const push = lineCalls.filter(c => c.path === '/v2/bot/message/push'); assert.equal(push.length, 1); assert.equal(push[0].body.to, 'U-aud');
  assert.match(push[0].body.messages[0].altText, /สรุปผลรายเดือน/);
});
await ok('other days: nothing unless a plan window closes in 3 days', async () => {
  lineCalls.length = 0; await days(12); assert.equal(lineCalls.length, 0);
  const to = new Date(Date.now() + 7 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);
  reset({ open: true, to }); books.sys.line.push(['3002', 'U-rep', 'x', '', '']);
  await days(12); const push = lineCalls.filter(c => c.path === '/v2/bot/message/push'); assert.equal(push.length, 1); assert.match(push[0].body.messages[0].altText, /อีก 3 วันปิดรับ/);
});
await ok('กปม. closing a plan window tells linked reporters at once', async () => {
  reset({ open: true }); books.sys.line.push(['3002', 'U-rep', 'x', '', ''], ['1000', 'U-aud', 'x', '', '']);
  const a = await signIn('1000'); lineCalls.length = 0;
  const r = await post('/api/save', a, { fy: 2570, ops: [{ s: 'cfg', k: 'plan', v: { open: false, from: '', to: '' } }], log: [] }); assert.equal(r.status, 200);
  const push = lineCalls.filter(c => c.path === '/v2/bot/message/push'); assert.equal(push.length, 1); assert.equal(push[0].body.to, 'U-rep');
  assert.match(push[0].body.messages[0].altText, /ปิดรับการกรอกแผนการดำเนินงาน/);
});
await ok('unlink clears the LINE user', async () => {
  const r2 = await signIn('3002'); await post('/api/line/unlink', r2);
  assert.equal(books.sys.line.find(r => r[0] === '3002')[1], '');
});
await ok('without LINE settings the app still boots (line disabled)', async () => {
  const saved = env.LINE_CHANNEL_TOKEN; delete env.LINE_CHANNEL_TOKEN;
  try { const c = await signIn('3002'); const r = await call('/data-2570.js', { headers: { cookie: c } }); assert.match(await r.text(), /"line":\{"enabled":false\}/); }
  finally { env.LINE_CHANNEL_TOKEN = saved; }
});
// DUMP_FLEX=<dir>: save sample messages for the LINE Flex Message Simulator
if (process.env.DUMP_FLEX) {
  reset({ open: true, to: new Date(Date.now() + 7 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10) }); books.sys.line.push(['3002', 'U-rep', 'x', '', ''], ['1000', 'U-aud', 'x', '', '']);
  const realNow = Date.now; Date.now = () => Date.UTC(2026, 11, 1, 2);
  for (const j of ['monthly', 'summary']) { const r = await (await call('/api/notify?dry=1&job=' + j, { method: 'POST', headers: { 'x-cron-key': 'cron-key' } })).json(); writeFileSync(join(process.env.DUMP_FLEX, j + '.json'), JSON.stringify(r.messages[0].contents, null, 2)); }
  Date.now = realNow;
  for (const [w, u, f] of [['สถานะ', 'U-rep', 'status'], ['กำหนดส่ง', 'U-rep', 'deadline'], ['ช่วยเหลือ', 'U-rep', 'help']]) { lineCalls.length = 0; await hook([msgEv(u, w)]); writeFileSync(join(process.env.DUMP_FLEX, f + '.json'), JSON.stringify(lineCalls.at(-1).body.messages[0].contents, null, 2)); }
  const r = await (await call('/api/notify?dry=1&job=closing', { method: 'POST', headers: { 'x-cron-key': 'cron-key' } })).json(); writeFileSync(join(process.env.DUMP_FLEX, 'closing.json'), JSON.stringify(r.messages[0].contents, null, 2));
}
console.log(`\n${n} ผ่าน`);
