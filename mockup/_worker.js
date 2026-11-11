// Cloudflare Pages worker (advanced mode) for the CBE report system.
// Serves the static app plus an API that reads and writes Google Sheets with a Google Cloud service account.
// Users sign in with their 4-digit employee ID; the password is "cbe@" + ID (organisation's choice). Roles come from the "users" tab.
//
// Pages → Settings → Variables and Secrets:
//   GOOGLE_SA        (secret) service account JSON key
//   SESSION_SECRET   (secret) 32+ random characters for signing the session cookie
//   SYSTEM_SHEET_ID  spreadsheet with tabs users, forms, state, log (see mockup/DEPLOY.md)
//   FILES_FOLDER_ID  evidence root: the "กลุ่มที่ 3 Core Business Enablers" folder (optional)
//   DRIVE_OAUTH      (secret) {"client_id","client_secret","refresh_token"} of the Google account that owns that folder.
//                    Service accounts have no Drive storage, so files in a personal Drive must be uploaded as a real account;
//                    without it the service account is used (works only on a Shared Drive).
//   CUR_FY           current fiscal year (default 2570)
//   LINE_CHANNEL_SECRET (secret) Messaging API channel secret: checks webhook signatures
//   LINE_CHANNEL_TOKEN  (secret) long-lived channel access token: sends messages
//   LINE_ADD_URL     add-friend link of the LINE Official Account (https://line.me/R/ti/p/@...)
//   CRON_KEY         (secret) shared with the GitHub Actions job that calls /api/notify every morning
//   GUIDE_SHEET_ID   last year's consolidated report (one tab per part) shown as a writing guide (default: the 2569 sheet)
//   GEMINI_API_KEY   (secret) Google Gemini API key for the reporters' writing assistant (optional; paid tier: data not used for training)
//   GEMINI_TIER      'paid' hides the free-tier notice (free tier: Google may use the text to improve its products)
//   GEMINI_MODEL     Gemini model (default gemini-flash-latest) · GEMINI_DAILY_CALLS cap per day (default 800), 40 per person
//   AI               Workers AI binding (Settings → Bindings) for the กปม. AI pre-check (optional)
//   AI_MODEL         Workers AI text model (default @cf/google/gemma-4-26b-a4b-it)
//   AI_DAILY_NEURONS stop calling the AI after this many Neurons per UTC day (default 8000 of the free 10,000)

const IND_PARTS = { CG: ['CG'], SP: ['SP'], RM: ['RM'], SCM: ['SM', 'CM'], DT: ['DT'], HCM: ['HCM'], KMIM: ['KM', 'IM'], IA: ['IA'] };
const STORES = ['patch', 'wf', 'wfnote', 'tri', 'trinote', 'unlock', 'cfg', 'ai'];
const WF = ['draft', 'submitted', 'approved', 'returned'];
const MONTHS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
const SUM_TAB = "'1.สรุปรายงานผู้บริหาร'", FORM_TAB = "'2.ผลตามเกณฑ์และ GAP'";
const MONTH_COLS = [...'GHIJKLMNOPQR'];
const FILE_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const INLINE = ['pdf', 'png', 'jpg', 'jpeg'];
const MAX_FILE = 10 * 1024 * 1024, TTL = 60e3;
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/', DRIVE = 'https://www.googleapis.com/drive/v3/files/';

export default {
  async fetch(req, env, ctx) {
    const path = new URL(req.url).pathname, fy = +(env.CUR_FY || 2570);
    try {
      if (path.startsWith('/tools/') || path.startsWith('/.test/')) return new Response('Not found', { status: 404 });
      if (path === `/data-${fy}.js`) {
        try { return js(await boot(req, env, fy)); } catch (e) { if (!e.status) throw e; return js('window.CBE_API=' + JSON.stringify(e.status === 401 ? { login: true, error: '' } : { error: e.message }) + ';'); }
      }
      if (path === '/data.js' || path === '/history.js' || path === '/history-axes.js') { try { return js(await archive(req, env, { '/data.js': 'ARCHIVE', '/history.js': 'HISTORY', '/history-axes.js': 'HISTORY_AXES' }[path])); } catch (e) { if (e.status !== 401) throw e; return js(''); } }
      if (path === '/api/login' && req.method === 'POST') return await login(req, env);
      if (path === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': SESSION + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
      if (path === '/api/role' && req.method === 'POST') return await switchRole(req, env);
      if (path === '/api/save' && req.method === 'POST') return json(await save(req, env, fy, ctx));
      if (path === '/api/guide' && req.method === 'GET') return json(await guide(req, env));
      if (path === '/api/ai/write' && req.method === 'POST') return json(await aiWrite(req, env, fy));
      if (path === '/api/ai/check' && req.method === 'POST') return json(await aiCheck(req, env, fy, ctx));
      if (path === '/api/line/webhook' && req.method === 'POST') return await lineWebhook(req, env, fy);
      // config check for setup: booleans only, never values
      if (path === '/api/line/webhook' && req.method === 'GET') return json({ secret: !!env.LINE_CHANNEL_SECRET, token: !!env.LINE_CHANNEL_TOKEN, addUrl: !!env.LINE_ADD_URL, cronKey: !!env.CRON_KEY });
      if (/^\/api\/line\/(code|status|unlink|test)$/.test(path) && req.method === 'POST') return json(await lineApi(req, env, path.slice(10)));
      if (path === '/api/notify' && req.method === 'POST') return json(await notify(req, env, fy));
      if (path === '/api/file' && req.method === 'POST') return json(await upload(req, env, fy));
      if (path.startsWith('/api/file/')) return await download(req, env, fy, path.slice(10));
      if (path.startsWith('/api/')) return new Response('Not found', { status: 404 });
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (!e.status) console.error(e.stack || e);
      return json({ error: e.status ? e.message : 'ระบบขัดข้อง ลองใหม่อีกครั้ง' }, e.status || 500);
    }
  }
};

/* ---------- helpers ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
const noStore = { 'cache-control': 'no-store' };
const json = (o, status = 200, extra) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...noStore, ...extra } });
const js = s => new Response(s, { headers: { 'content-type': 'text/javascript; charset=utf-8', ...noStore } });
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
const b64url = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const RS256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const memo = {}; // per-isolate cache; every isolate refreshes on its own
async function cached(key, ttl, fn) {
  const m = memo[key];
  if (m && Date.now() - m.at < ttl) return m.v;
  const v = await fn();
  memo[key] = { at: Date.now(), v };
  return v;
}
// Bangkok time: month index in the fiscal year (ต.ค. = 0) and the log timestamp
function bkk() { return new Date(Date.now() + 7 * 3600e3); }
const fyMonth = d => (d.getUTCMonth() + 3) % 12;
function stamp() { const d = bkk(); return `${d.getUTCDate()} ${MONTHS[fyMonth(d)]} ${d.getUTCFullYear() + 543} ${d.toISOString().slice(11, 16)}`; }
// Months before this one are closed; last month stays open until the 5th, its reporting deadline
function openFrom() { const d = bkk(), m = fyMonth(d); return d.getUTCDate() <= 5 ? Math.max(0, m - 1) : m; }

/* ---------- sign-in: employee ID + "cbe@ID", HMAC-signed session cookie ---------- */
const SESSION = 'cbe_session', SESSION_HOURS = 8, MAX_FAILS = 5, LOCK_MS = 15 * 60e3;
const FAILS = {}; // per isolate: "id|ip" → { n, until }; pair with a Cloudflare rate-limiting rule on /api/login
function hmacKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  return cached('hmac', Infinity, () => crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
}
async function sessionId(req, env) {
  const m = new RegExp('(?:^|;\\s*)' + SESSION + '=([^;]+)').exec(req.headers.get('cookie') || '');
  if (!m) fail(401, 'กรุณาเข้าสู่ระบบ');
  const [p, s] = m[1].split('.');
  const key = await hmacKey(env);
  let body = null;
  try { if (await crypto.subtle.verify('HMAC', key, unb64url(s || ''), enc.encode(p))) body = JSON.parse(dec.decode(unb64url(p))); } catch (e) { /* malformed cookie */ }
  if (!body || body.exp < Date.now()) fail(401, 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  return body;
}
// Browsers send SameSite=Strict cookies only from this site; the Origin check also blocks forms posted from elsewhere
function sameOrigin(req) { const o = req.headers.get('origin'); if (o && o !== new URL(req.url).origin) fail(403, 'คำขอไม่ได้มาจากหน้าระบบ'); }
async function login(req, env) {
  sameOrigin(req);
  const b = await req.json().catch(() => ({})), id = str(b.id), slot = id + '|' + (req.headers.get('cf-connecting-ip') || ''), now = Date.now();
  let f = FAILS[slot];
  if (f && f.until > now) fail(429, 'ใส่รหัสผ่านผิดหลายครั้ง ลองใหม่อีกครั้งใน 15 นาที');
  if (f && f.until) f = null; // lock expired
  const u = (await system(env)).users[id];
  if (!/^\d{4}$/.test(id) || !u || String(b.password || '') !== 'cbe@' + id) {
    const n = (f ? f.n : 0) + 1;
    FAILS[slot] = { n, until: n >= MAX_FAILS ? now + LOCK_MS : 0 };
    fail(401, 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง');
  }
  delete FAILS[slot];
  checkUser(u);
  // Several roles: ask which one first (password already checked; nothing is issued until a role is chosen)
  if (u.roles.length > 1 && !Number.isInteger(b.r)) return json({ choose: u.roles.map((x, i) => ({ r: i, label: roleLabel(x) })), name: u.name });
  const cu = asRole(u, b.r);
  await appendRows(env, env.SYSTEM_SHEET_ID, 'log!A:D', [[stamp(), id, label(cu), 'เข้าสู่ระบบ']]);
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, id, cu.r) });
}
async function sessionCookie(env, id, r) {
  const p = b64url(enc.encode(JSON.stringify({ id, r, exp: Date.now() + SESSION_HOURS * 3600e3 })));
  const token = p + '.' + b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(p)));
  return `${SESSION}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
async function switchRole(req, env) {
  sameOrigin(req);
  const s = await sessionId(req, env), u = (await system(env)).users[s.id], b = await req.json().catch(() => ({}));
  if (!u) fail(401, 'บัญชีนี้ถูกยกเลิกแล้ว');
  if (!Number.isInteger(b.r) || b.r < 0 || b.r >= u.roles.length) fail(400, 'ไม่มีบทบาทนี้');
  const cu = asRole(u, b.r); checkUser(cu);
  await appendRows(env, env.SYSTEM_SHEET_ID, 'log!A:D', [[stamp(), u.id, label(cu), 'สลับบทบาทเป็น ' + roleLabel(cu)]]);
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, u.id, cu.r) });
}

/* ---------- Google APIs (service account) ---------- */
function gToken(env) {
  return cached('gtoken', 50 * 60e3, async () => {
    const sa = JSON.parse(env.GOOGLE_SA), now = Math.floor(Date.now() / 1000);
    const part = o => b64url(enc.encode(JSON.stringify(o)));
    const unsigned = part({ alg: 'RS256', typ: 'JWT' }) + '.' + part({ iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive' });
    const der = Uint8Array.from(atob(sa.private_key.replace(/-----[A-Z ]+-----|\s/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, RS256, false, ['sign']);
    const assertion = unsigned + '.' + b64url(await crypto.subtle.sign(RS256, key, enc.encode(unsigned)));
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + assertion });
    if (!r.ok) throw new Error('Google token ' + r.status + ': ' + await r.text());
    return (await r.json()).access_token;
  });
}
// Evidence files go through the folder owner's account when DRIVE_OAUTH is set
function driveToken(env) {
  if (!env.DRIVE_OAUTH) return gToken(env);
  return cached('dtoken', 50 * 60e3, async () => {
    const o = JSON.parse(env.DRIVE_OAUTH);
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: o.client_id, client_secret: o.client_secret, refresh_token: o.refresh_token, grant_type: 'refresh_token' }).toString() });
    if (!r.ok) throw new Error('Drive token ' + r.status + ': ' + await r.text());
    return (await r.json()).access_token;
  });
}
async function g(env, url, { json: body, headers, drive, ...init } = {}) {
  const r = await fetch(url, { ...init, body: body ? JSON.stringify(body) : init.body,
    headers: { authorization: 'Bearer ' + await (drive ? driveToken(env) : gToken(env)), ...(body ? { 'content-type': 'application/json' } : {}), ...headers } });
  if (!r.ok) throw Object.assign(new Error('Google ' + r.status + ' ' + url.split('?')[0] + ': ' + (await r.text()).slice(0, 300)), { google: r.status });
  return r;
}
async function getRanges(env, id, ranges) {
  const q = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  return (await (await g(env, `${SHEETS}${id}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`)).json()).valueRanges.map(v => v.values || []);
}
// RAW keeps text like "=..." from becoming a formula
async function putRanges(env, id, data) { if (data.length) await g(env, `${SHEETS}${id}/values:batchUpdate`, { method: 'POST', json: { valueInputOption: 'RAW', data } }); }
async function appendRows(env, id, range, values) {
  if (values.length) await g(env, `${SHEETS}${id}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', json: { values } });
}

/* ---------- system spreadsheet: users, form ids, workflow state, audit log ---------- */
const str = v => v == null ? '' : String(v).trim();
function system(env) {
  return cached('system', TTL, async () => {
    const [users, forms] = await getRanges(env, env.SYSTEM_SHEET_ID, ['users!A2:E', 'forms!A2:C']);
    const byId = {};
    users.forEach(r => {
      const id = str(r[0]); if (!id) return;
      const x = { role: str(r[1]).toLowerCase(), ind: str(r[2]).toUpperCase() || null, part: str(r[3]).toUpperCase() || null };
      const u = byId[id] = byId[id] || { id, name: '', roles: [] };
      if (!u.name) u.name = str(r[4]);
      if (!u.roles.some(y => y.role === x.role && y.ind === x.ind && y.part === x.part)) u.roles.push(x);
    });
    // Rows with a valid role come first; the first one is the default, invalid rows only matter when nothing else is valid
    Object.values(byId).forEach(u => { const ok = u.roles.filter(roleOk); if (ok.length) u.roles = ok; Object.assign(u, u.roles[0]); });
    return { users: byId, forms: forms.filter(r => str(r[1]) && str(r[2])).map(r => ({ fy: +r[0] || 0, code: str(r[1]), id: str(r[2]) })) };
  });
}
const roleOk = x => x.role === 'audit' || x.role === 'exec' || (x.role === 'reporter' && !!IND_PARTS[x.ind] && (!x.part || IND_PARTS[x.ind].includes(x.part)));
function checkUser(u) {
  if (!roleOk(u)) fail(403, `รหัสพนักงาน ${u.id} ยังไม่ได้กำหนดสิทธิ์ในระบบ ติดต่อ กปม.`);
}
const rolesOf = u => u.roles || [u];
const roleLabel = x => x.role === 'audit' ? 'กปม.' : x.role === 'exec' ? 'ผู้บริหาร' : 'ผู้รายงาน ' + (x.part || x.ind);
// The role in use for this session; `self` lists indicators the person reports, which they may not review as กปม.
function asRole(u, r) {
  const i = Number.isInteger(r) && r >= 0 && r < u.roles.length ? r : 0;
  return Object.assign({}, u, u.roles[i], { r: i, self: [...new Set(u.roles.filter(x => x.role === 'reporter').map(x => x.ind))] });
}
const SELF_MSG = 'ตัวชี้วัดที่ท่านรายงานเอง ต้องให้ กปม. ท่านอื่นตรวจ';
const isSelf = (u, ind) => u.role === 'audit' && (u.self || []).includes(ind);
// A user removed from the "users" tab loses access within a minute (system() cache), even with a valid cookie
async function me(req, env) {
  const s = await sessionId(req, env), base = (await system(env)).users[s.id];
  if (!base) fail(401, 'บัญชีนี้ถูกยกเลิกแล้ว');
  const u = asRole(base, s.r);
  checkUser(u);
  return u;
}
const label = u => (u.name || roleLabel(u)) + (u.roles && u.roles.length > 1 ? ' (' + roleLabel(u) + ')' : '');
// One row per (fy, store, key): A fy | B store | C key | D JSON value | E by | F at
async function loadState(env, fy) {
  const [rows] = await getRanges(env, env.SYSTEM_SHEET_ID, ['state!A2:D']), st = {}, at = {};
  STORES.forEach(s => { st[s] = {}; });
  rows.forEach((r, i) => {
    const s = str(r[1]), k = str(r[2]);
    if (+r[0] !== fy || !st[s] || !k) return;
    at[s + '\n' + k] = i + 2;
    if (r[3] === '' || r[3] == null) delete st[s][k]; else st[s][k] = JSON.parse(r[3]);
  });
  return { st, at };
}
// Reporters get only their own indicator's state: keys "IND", "IND:…", "IND|…", or finding ids "R1|IND|…"
function stateFor(u, st) {
  if (u.role !== 'reporter') return st;
  const mine = k => k === u.ind || k.startsWith(u.ind + ':') || k.startsWith(u.ind + '|') || k.split('|')[1] === u.ind, out = {};
  STORES.forEach(s => { out[s] = {}; Object.keys(st[s]).filter(mine).forEach(k => { out[s][k] = st[s][k]; }); });
  out.cfg = st.cfg; // plan-entry windows apply to every reporter
  out.ai = {}; // AI pre-check results are for กปม. only
  return out;
}

/* ---------- report forms (one Google Sheet per part, same layout as the Excel forms) ---------- */
const COL = c => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
// Same reading as tools/newforms-to-json.ps1; row / mrRows remember where each level sits so results can be written back
function parseForm(sum, rows) {
  const cell = (r, c) => str((r || [])[COL(c)]).replace(/\r/g, '');
  const num = v => { if (v === '') return null; const n = Number(v); return isNaN(n) ? null : n; };
  const targets = {}, subs = [];
  sum.forEach((r, i) => { const a = cell(r, 'A'); if (i + 1 >= 13 && /^\d/.test(a)) targets[a] = num(cell(r, 'D')); });
  let sub = null, lv = null, m;
  for (let i = 6; i <= rows.length; i++) {
    const r = rows[i - 1], B = cell(r, 'B');
    if ((m = /^(.*?)\s*\(น้ำหนัก ([\d.]+)\)/.exec(B))) {
      sub = { code: cell(r, 'A'), name: m[1].trim(), weight: +m[2], target: targets[cell(r, 'A')] ?? null, score: null, levels: [] };
      subs.push(sub); lv = null; continue;
    }
    if (!sub) continue;
    if ((m = /^ระดับ (\d)/.exec(B))) {
      const plan = MONTH_COLS.map(c => num(cell(r, c)) || 0), result = MONTH_COLS.map(c => num(cell(rows[i], c)) || 0), target = num(cell(r, 'D'));
      lv = { level: +m[1], criteria: cell(r, 'C'), gap: cell(r, 'AA'), narrative: cell(r, 'V'), remark: '', note: '', mr: [], row: i, mrRows: [],
        steps: target || plan.some(Boolean) ? [{ name: 'ดำเนินการตามค่าเกณฑ์ระดับ ' + m[1], unit: cell(r, 'E'), target, plan, result }] : [] };
      sub.levels.push(lv);
    }
    if (lv && cell(r, 'W')) { lv.mr.push({ req: cell(r, 'W'), has: cell(r, 'X') === '✓', evidence: cell(r, 'Y') }); lv.mrRows.push(i); }
  }
  return { title: '', owner: '', target: null, topics: [], subs };
}
async function form(env, fy, code) {
  const f = (await system(env)).forms.find(x => x.fy === fy && x.code === code);
  if (!f) return null;
  return cached('form:' + f.id, TTL, async () => ({ id: f.id, data: parseForm(...await getRanges(env, f.id, [SUM_TAB + '!A1:D400', FORM_TAB + '!A1:AA2000'])) }));
}
const hideRows = (k, v) => k === 'row' || k === 'mrRows' ? undefined : v;
async function findLevel(env, fy, lvKey) {
  const [, part, code, lv] = lvKey.split('|'), f = await form(env, fy, part), s = f && f.data.subs.find(x => x.code === code);
  return { f, s, L: s && s.levels.find(x => x.level === +lv) };
}

/* ---------- evidence folders: <root>/3.6 HCM/3.6.4.4 ชื่อประเด็น/เอกสารแนบค่าเกณฑ์ระดับ 1 ---------- */
const PART_DIR = { CG: '3.1 CG', SP: '3.2 SP', RM: '3.3 RM', SM: '3.4.1 SM', CM: '3.4.2 CM', DT: '3.5 DT', HCM: '3.6 HCM', KM: '3.7.1 KM', IM: '3.7.2 IM', IA: '3.8 IA' };
const FOLDER = 'application/vnd.google-apps.folder', DRIVE_LIST = DRIVE.slice(0, -1);
// Finds a child folder whose name is `prefix` or starts with "prefix "; creates `name` when there is none
function childFolder(env, parent, prefix, name) {
  return cached('dir:' + parent + '|' + prefix, 6 * 3600e3, async () => {
    const q = `'${parent}' in parents and mimeType='${FOLDER}' and trashed=false`;
    let token = '';
    do {
      const j = await (await g(env, `${DRIVE_LIST}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { drive: true })).json();
      const hit = (j.files || []).find(f => f.name.trim() === prefix || f.name.trim().startsWith(prefix + ' '));
      if (hit) return hit.id;
      token = j.nextPageToken;
    } while (token);
    return (await (await g(env, `${DRIVE_LIST}?supportsAllDrives=true&fields=id`, { method: 'POST', drive: true, json: { name: name.slice(0, 120), mimeType: FOLDER, parents: [parent] } })).json()).id;
  });
}
async function levelFolder(env, fy, key) {
  const [, part, code, lv] = key.split('|'), dir = PART_DIR[part];
  if (!dir) fail(400, 'ไม่รู้จักแบบฟอร์ม ' + part);
  const { s } = await findLevel(env, fy, key), subPrefix = dir.split(' ')[0] + '.' + code;
  const p = await childFolder(env, env.FILES_FOLDER_ID, dir, dir);
  const sf = await childFolder(env, p, subPrefix, subPrefix + (s ? ' ' + s.name.replace(/\s+/g, ' ') : ''));
  return childFolder(env, sf, 'เอกสารแนบค่าเกณฑ์ระดับ ' + lv, 'เอกสารแนบค่าเกณฑ์ระดับ ' + lv);
}

/* ---------- routes ---------- */
// The app loads this as a plain script: current-year forms + who is signed in + saved state
async function boot(req, env, fy) {
  const u = await me(req, env), codes = u.role === 'reporter' ? IND_PARTS[u.ind] : Object.values(IND_PARTS).flat();
  const [forms, { st }, log] = await Promise.all([Promise.all(codes.map(c => form(env, fy, c))), loadState(env, fy),
    getRanges(env, env.SYSTEM_SHEET_ID, ['log!A2:D']).then(([rows]) => rows.slice(-60).reverse().map(r => ({ t: str(r[0]), who: str(r[2]), what: str(r[3]) })))]);
  const data = {};
  codes.forEach((c, i) => { if (forms[i]) data[c] = forms[i].data; });
  const api = { write: !!(env.GEMINI_API_KEY || env.AI), writeGemini: !!env.GEMINI_API_KEY, writeFree: env.GEMINI_TIER !== 'paid', me: { role: u.role, ind: u.ind, part: u.part, name: u.name, id: u.id, r: u.r, self: u.role === 'audit' ? u.self : [], roles: u.roles.map((x, i) => ({ r: i, label: roleLabel(x) })) }, state: stateFor(u, st), log, openFrom: openFrom(), line: await lineStatus(env, u.id) };
  return `window.CBE_FORMS_${fy}=${JSON.stringify(data, hideRows)};\nwindow.CBE_API=${JSON.stringify(api)};`;
}
// FY2569 (closed year) and the indicator seed: the data.js built by tools/forms-to-json.ps1, kept as a Drive file
// history.js (past TRIS assessment results, row code HISTORY in the forms tab) is served the same way
async function archive(req, env, code = 'ARCHIVE') {
  await me(req, env);
  const f = (await system(env)).forms.find(x => x.code === code);
  return f ? cached(code + ':' + f.id, 3600e3, async () => (await g(env, `${DRIVE}${f.id}?alt=media&supportsAllDrives=true`)).text()) : '';
}

const own = (u, key) => { const [ind, part] = key.split('|'); return u.role === 'reporter' && ind === u.ind && (!u.part || part === u.part); };
const editable = (st, ind) => ['draft', 'returned'].includes(st.wf[ind] || 'draft');
// Plan-entry windows (store cfg, set by กปม.): missing = open; dates are Bangkok calendar days YYYY-MM-DD
const planClosed = (st, k) => { const c = st.cfg[k] || {}, d = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); return c.open === false || (c.from && d < c.from) || (c.to && d > c.to); };
const same12 = (a, b) => { for (let i = 0; i < 12; i++) if ((+(a || [])[i] || 0) !== (+(b || [])[i] || 0)) return false; return true; };
async function check(env, fy, u, st, op) {
  if (!STORES.includes(op.s) || typeof op.k !== 'string' || !op.k || op.k.length > 200) fail(400, 'คำขอไม่ถูกต้อง');
  if (op.v != null && JSON.stringify(op.v).length > 45000) fail(413, 'ข้อความยาวเกินไป');
  const audit = u.role === 'audit', reporter = u.role === 'reporter';
  if (op.s === 'patch') {
    // กปม. writes only the remark: keep everything else as the reporter saved it
    if (audit && isSelf(u, op.k.split('|')[0])) fail(403, SELF_MSG);
    if (audit && !op.k.endsWith('|self')) { op.v = Object.assign({}, st.patch[op.k] || {}, { remark: String((op.v || {}).remark || '').slice(0, 5000) }); return; }
    if (!own(u, op.k)) fail(403, 'แก้ไขได้เฉพาะส่วนที่รับผิดชอบ');
    if (!editable(st, u.ind)) fail(409, 'รายงานนี้ส่งตรวจแล้ว แก้ไขได้เมื่อ กปม. ส่งกลับ');
    if (op.v && Array.isArray(op.v.res) && !op.k.endsWith('|self') && !st.unlock[op.k]) {
      const old = st.patch[op.k] && st.patch[op.k].res || ((await findLevel(env, fy, op.k)).L || { steps: [] }).steps.map(x => x.result), from = openFrom();
      op.v.res.forEach((r, si) => { for (let i = 0; i < from; i++) if ((+(r || [])[i] || 0) !== (+((old[si] || [])[i]) || 0)) fail(409, `ผลเดือน ${MONTHS[i]} ปิดรอบแล้ว ขอให้ กปม. ปลดล็อกเพื่อแก้ย้อนหลัง`); });
    }
    const prev = st.patch[op.k] || {};
    if (op.v && Array.isArray(op.v.plan) && planClosed(st, 'plan')) {
      const old = prev.plan || ((await findLevel(env, fy, op.k)).L || { steps: [] }).steps.map(x => x.plan);
      if (op.v.plan.some((a, si) => !same12(a, old[si]))) fail(409, 'ปิดรับการแก้ไขแผนการดำเนินงานแล้ว');
    }
    if (op.v && Array.isArray(op.v.gapPlan) && planClosed(st, 'gap') && !same12(op.v.gapPlan, prev.gapPlan)) fail(409, 'ปิดรับการแก้ไขแผนปรับปรุง GAP แล้ว');
    // sub-plans: steps the unit added (cs) and GAP steps (gs) keep their monthly plans while the window is closed; results stay open
    const plans = a => JSON.stringify((a || []).map(x => (x.p || []).slice(0, 12).map(v => +v || 0)));
    if (op.v && Array.isArray(op.v.cs) && planClosed(st, 'plan') && plans(op.v.cs) !== plans(prev.cs)) fail(409, 'ปิดรับการแก้ไขแผนการดำเนินงานแล้ว');
    if (op.v && Array.isArray(op.v.gs) && planClosed(st, 'gap') && plans(op.v.gs) !== plans(prev.gs || (Array.isArray(prev.gapPlan) && prev.gapPlan.some(Number) ? [{ p: prev.gapPlan }] : []))) fail(409, 'ปิดรับการแก้ไขแผนปรับปรุง GAP แล้ว');
  } else if (op.s === 'ai') {
    fail(403, 'ผล AI บันทึกโดยระบบเท่านั้น');
  } else if (audit && (op.s === 'wf' ? isSelf(u, op.k) : op.s === 'wfnote' ? isSelf(u, op.k.split(':')[0]) : op.s === 'tri' || op.s === 'trinote' ? isSelf(u, op.k.split('|')[1]) : op.s === 'unlock' ? isSelf(u, op.k.split('|')[0]) : false)) {
    fail(403, SELF_MSG);
  } else if (op.s === 'wf') {
    if (audit ? !WF.includes(op.v) : !(reporter && op.k === u.ind && op.v === 'submitted' && editable(st, u.ind))) fail(403, 'ไม่มีสิทธิ์เปลี่ยนสถานะรายงานนี้');
  } else if (op.s === 'wfnote') {
    if (!audit && !(reporter && op.k === u.ind + ':sent')) fail(403, 'ไม่มีสิทธิ์แก้หมายเหตุนี้');
  } else if (op.s === 'unlock') {
    if (!audit && !(reporter && op.v == null && op.k.startsWith(u.ind + '|'))) fail(403, 'เฉพาะ กปม. ปลดล็อกได้');
  } else if (!audit) fail(403, 'เฉพาะ กปม.');
}
// Results, narrative and evidence go back into the part's form so the sheet stays readable on its own
async function mirror(env, fy, ops) {
  const byForm = {};
  for (const op of ops) {
    const { f, L } = await findLevel(env, fy, op.k), v = op.v;
    if (!L) continue;
    const d = byForm[f.id] = byForm[f.id] || [];
    if (Array.isArray(v.plan) && v.plan[0] && L.steps.length) d.push({ range: `${FORM_TAB}!G${L.row}:R${L.row}`, values: [v.plan[0].map(x => +x || '')] });
    if (v.res && v.res[0] && L.steps.length) d.push({ range: `${FORM_TAB}!G${L.row + 1}:R${L.row + 1}`, values: [v.res[0].map(x => +x || '')] });
    if (typeof v.narrative === 'string') d.push({ range: `${FORM_TAB}!V${L.row}`, values: [[v.narrative]] });
    (v.mr || []).forEach((x, i) => { if (L.mrRows[i]) d.push({ range: `${FORM_TAB}!X${L.mrRows[i]}:Y${L.mrRows[i]}`, values: [[x[0] ? '✓' : '', x[1] || '']] }); });
  }
  await Promise.all(Object.keys(byForm).map(id => putRanges(env, id, byForm[id])));
}
async function writeState(env, fy, at, ops, u) {
  const when = stamp(), updates = [], appends = [];
  ops.forEach(op => {
    const vals = [fy, op.s, op.k, op.v == null ? '' : JSON.stringify(op.v), u.id, when], row = at[op.s + '\n' + op.k];
    if (row) updates.push({ range: `state!A${row}:F${row}`, values: [vals] }); else if (op.v != null) appends.push(vals);
  });
  await putRanges(env, env.SYSTEM_SHEET_ID, updates);
  await appendRows(env, env.SYSTEM_SHEET_ID, 'state!A:F', appends);
  return when;
}
async function save(req, env, fy, ctx) {
  sameOrigin(req);
  const u = await me(req, env), body = await req.json().catch(() => ({}));
  if (+body.fy !== fy) fail(409, 'ปีบัญชีนี้ปิดรอบแล้ว แก้ไขไม่ได้');
  if (u.role === 'exec') fail(403, 'ผู้บริหารดูได้อย่างเดียว');
  const byKey = {};
  (Array.isArray(body.ops) ? body.ops : []).slice(0, 300).forEach(op => { if (op) byKey[op.s + '\n' + op.k] = { s: op.s, k: op.k, v: op.v == null ? null : op.v }; });
  const ops = Object.values(byKey), logs = (Array.isArray(body.log) ? body.log : []).slice(0, 30).map(s => String(s).slice(0, 500));
  const { st, at } = await loadState(env, fy);
  for (const op of ops) await check(env, fy, u, st, op); // all or nothing
  const cfgBefore = JSON.parse(JSON.stringify(st.cfg));
  // Submitting closes every past-month unlock of that indicator
  ops.filter(op => op.s === 'wf' && op.v === 'submitted').forEach(op => Object.keys(st.unlock).forEach(k => {
    if (k.startsWith(op.k + '|') && !byKey['unlock\n' + k]) ops.push(byKey['unlock\n' + k] = { s: 'unlock', k, v: null });
  }));
  const when = await writeState(env, fy, at, ops, u);
  await appendRows(env, env.SYSTEM_SHEET_ID, 'log!A:D', logs.map(w => [when, u.id, label(u), w]));
  let mirrored = true;
  try { await mirror(env, fy, ops.filter(op => op.s === 'patch' && op.v && !op.k.endsWith('|self'))); } catch (e) { mirrored = false; console.error('mirror', e.stack || e); }
  const tell = onCfgChange(env, new URL(req.url).origin, cfgBefore, ops).catch(e => console.error('line cfg', e.stack || e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(tell); else await tell;
  return { ok: true, at: when, mirrored };
}
/* ---------- AI pre-check for กปม. (Workers AI): suggestions only, กปม. confirms or dismisses each one ---------- */
const AI_DEFAULT = '@cf/google/gemma-4-26b-a4b-it';
// Neurons per million tokens [input, output] from the Workers AI pricing page; unknown models use a cautious rate
const AI_RATES = { '@cf/google/gemma-4-26b-a4b-it': [9091, 27273], '@cf/qwen/qwen3-30b-a3b-fp8': [4625, 30475], '@cf/aisingapore/gemma-sea-lion-v4-27b-it': [31876, 50488], '@cf/google/gemma-3-12b-it': [31371, 50560] };
const AI_KEY = /^[A-Z]{2,5}\|[A-Z]{2,5}\|\d{1,2}(\.\d{1,2}){1,2}\|[1-5]$/;
const AI_TYPES = ['criteria', 'evidence', 'gap'];
const cut = (v, n) => str(v).slice(0, n);
// Same signature on the page and here: a level is re-checked only when what the AI reads has changed
function aiSig(x) {
  const t = [x.crit, x.narr, (x.mr || []).map(m => m.join('~')).join('^'), x.gap, x.action, x.gapNote].join('\u0001');
  let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '.' + t.length;
}
function aiItem(raw) {
  const x = raw || {};
  return { k: str(x.k), label: cut(x.label, 80), crit: cut(x.crit, 3000), narr: cut(x.narr, 3000), gap: cut(x.gap, 1200), action: cut(x.action, 1200), gapNote: cut(x.gapNote, 1500),
    mr: (Array.isArray(x.mr) ? x.mr : []).slice(0, 8).map(m => [cut(m && m[0], 300), m && m[1] ? '1' : '', cut(m && m[2], 200), cut(m && m[3], 300)]) };
}
function aiPrompt(x) {
  const mr = x.mr.length ? x.mr.map((m, i) => `${i + 1}. ข้อกำหนด: ${m[0]}\n   ติ๊กว่ามีเอกสาร: ${m[1] ? 'มี' : 'ไม่มี'} · ชื่อหลักฐาน: ${m[2] || '(ไม่ระบุ)'} · ไฟล์แนบ: ${m[3] || '(ไม่มี)'}`).join('\n') : '(ไม่มี)';
  return [
    { role: 'system', content: 'คุณเป็นผู้ช่วยตรวจเบื้องต้นของกองประเมินผล (กปม.) ตรวจรายงานผลการดำเนินงานของรัฐวิสาหกิจตามค่าเกณฑ์ SE-AM ' +
      'ชี้เฉพาะจุดที่เห็นได้ชัดจากข้อความที่ให้มา ห้ามเดาหรือแต่งข้อเท็จจริง ถ้าไม่แน่ใจให้ไม่รายงาน ตอบเป็นภาษาไทย และตอบเป็น JSON อย่างเดียว' },
    { role: 'user', content: `ประเด็น ${x.label}\n\n[ค่าเกณฑ์]\n${x.crit || '(ไม่มี)'}\n\n[ผลการดำเนินงานที่ผู้รายงานเขียน]\n${x.narr || '(ว่าง)'}\n\n[Minimum Requirement และหลักฐาน]\n${mr}\n\n` +
      `[ข้อเสนอแนะ สคร. (GAP ปีก่อน)]\n${x.gap || '(ไม่มี)'}\n\n[แนวทางปรับปรุงที่ส่วนงานกำหนด]\n${x.action || '(ไม่มี)'}\n\n[ผลการดำเนินงานตามแนวทางปรับปรุง]\n${x.gapNote || '(ว่าง)'}\n\n` +
      'ตรวจ 3 เรื่อง:\n' +
      'criteria = ผลการดำเนินงานไม่ครอบคลุมองค์ประกอบของค่าเกณฑ์ (ระบุองค์ประกอบที่ขาด)\n' +
      'evidence = ชื่อหลักฐาน/ไฟล์ไม่ตรงกับ Minimum Requirement ข้อนั้น (เฉพาะข้อที่มีชื่อหรือไฟล์)\n' +
      'gap = มีข้อเสนอแนะ สคร. แต่ผลตามแนวทางปรับปรุงไม่ตอบข้อเสนอแนะครบทุกข้อ\n' +
      'ตอบ JSON รูปแบบนี้เท่านั้น ไม่เกิน 4 ข้อค้นพบ ถ้าไม่พบให้ findings เป็น []:\n' +
      '{"findings":[{"type":"criteria|evidence|gap","severity":"warning|info","title":"หัวข้อสั้นไม่เกิน 60 ตัวอักษร","detail":"ขาดอะไร อ้างข้อความจากค่าเกณฑ์หรือข้อเสนอแนะ","fix":"สิ่งที่ผู้รายงานควรทำ"}],' +
      '"return_note":"ร่างข้อความถึงผู้รายงาน 1-3 ประโยค หรือ \\"\\" ถ้าไม่มีประเด็น"}' }
  ];
}
function aiParse(text) {
  const t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o; try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  const items = (Array.isArray(o.findings) ? o.findings : []).filter(f => f && AI_TYPES.includes(f.type) && str(f.title)).slice(0, 4)
    .map(f => ({ type: f.type, sev: f.severity === 'info' ? 'info' : 'warning', title: cut(f.title, 120), detail: cut(f.detail, 600), fix: cut(f.fix, 400) }));
  return { items, note: cut(o.return_note, 600) };
}
function aiNeurons(model, usage, x) {
  const r = AI_RATES[model] || [50000, 100000], u = usage || {};
  const pin = +u.prompt_tokens || Math.ceil(JSON.stringify(x).length / 2), pout = +u.completion_tokens || 1500;
  return Math.ceil((pin * r[0] + pout * r[1]) / 1e6);
}
async function aiCall(env, model, messages, maxTokens) {
  // thinking off: a reasoning pass costs output Neurons and time and can use up max tokens before the JSON
  const base = { messages, temperature: 0.2, max_completion_tokens: maxTokens || 1200, chat_template_kwargs: { enable_thinking: false } };
  let r;
  try { r = await env.AI.run(model, { ...base, response_format: { type: 'json_object' } }); } catch (e) { r = await env.AI.run(model, base); } // not every model takes response_format
  const c = r && r.choices && r.choices[0] && r.choices[0].message;
  const text = c ? c.content : r && r.response;
  return { text: typeof text === 'string' ? text : JSON.stringify(text || ''), usage: (r && r.usage) || null, finish: r && r.choices && r.choices[0] && r.choices[0].finish_reason };
}
async function aiAlert(env, used, limit) {
  if (!env.LINE_CHANNEL_TOKEN) return;
  const sys = await system(env), links = (await lineRows(env)).filter(r => r.user && sys.users[r.id] && rolesOf(sys.users[r.id]).some(x => x.role === 'audit'));
  const msg = { type: 'text', text: `AI ช่วยตรวจ: วันนี้ใช้โควตาฟรีไปแล้ว ${Math.min(100, Math.round(used / limit * 100))}% (${used.toLocaleString()} / ${limit.toLocaleString()} Neurons) · เต็มแล้วจะใช้ได้อีกครั้ง 07:00 น.` };
  for (const r of links) await linePush(env, r.user, [msg], 'ai80|' + new Date().toISOString().slice(0, 10) + '|' + r.id);
}
async function aiCheck(req, env, fy, ctx) {
  sameOrigin(req);
  const u = await me(req, env), body = await req.json().catch(() => ({}));
  if (u.role !== 'audit') fail(403, 'เฉพาะ กปม.');
  if (!env.AI) fail(501, 'ยังไม่ได้เปิด Workers AI (เพิ่ม binding ชื่อ AI ในการตั้งค่า Pages)');
  if (+body.fy !== fy) fail(409, 'ตรวจได้เฉพาะปีบัญชีปัจจุบัน');
  const model = env.AI_MODEL || AI_DEFAULT, limit = +env.AI_DAILY_NEURONS || 8000, day = new Date().toISOString().slice(0, 10), ukey = 'usage|' + day; // free quota resets 00:00 UTC
  // one level per request: a Thai level takes ~5–20 s and long requests are cut by the platform
  const list = (Array.isArray(body.items) ? body.items : []).slice(0, 1).map(aiItem).filter(x => AI_KEY.test(x.k));
  if (list.some(x => isSelf(u, x.k.split('|')[0]))) fail(403, SELF_MSG);
  const { st, at } = await loadState(env, fy), ops = [], results = {};
  const before = (st.ai[ukey] || {}).n || 0;
  let used = before, quota = false;
  for (const x of list) {
    const sig = aiSig(x), old = st.ai[x.k];
    if (old && old.sig === sig && !old.err) { results[x.k] = old; continue; }
    if (used >= limit) { quota = true; break; }
    let rec;
    try {
      const out = await aiCall(env, model, aiPrompt(x)), parsed = aiParse(out.text);
      used += aiNeurons(model, out.usage, x);
      rec = parsed ? { sig, at: stamp(), model, items: parsed.items, note: parsed.note } : { sig, at: stamp(), model, items: [], note: '', err: 'AI ตอบในรูปแบบที่อ่านไม่ได้', raw: cut(out.text, 300), finish: str(out.finish), usage: out.usage };
    } catch (e) {
      console.error('ai', e.stack || e);
      if (/limit|quota|neuron|429|capacity/i.test(String(e.message))) { quota = true; break; }
      rec = { sig, at: stamp(), model, items: [], note: '', err: 'เรียก AI ไม่สำเร็จ' };
    }
    results[x.k] = rec; ops.push({ s: 'ai', k: x.k, v: rec });
  }
  if (used !== before) ops.push({ s: 'ai', k: ukey, v: { n: used, limit } });
  if (ops.length) await writeState(env, fy, at, ops, u);
  if (before < limit * 0.8 && used >= limit * 0.8) { const p = aiAlert(env, used, limit).catch(e => console.error('ai alert', e.stack || e)); if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p; }
  return { results, used, limit, quota, model, day };
}
/* ---------- last year's results as a writing guide (read-only, from the consolidated 2569 report) ---------- */
const GUIDE_DEFAULT = '1k5D_YOgOx-e8f6QYOzUvJYsVSTRkY9388fyeI_PqrXs', GUIDE_FY = 2569;
const gNum = v => { const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; };
// Tabs differ per indicator, so columns are found by their header text
function parseGuide(rows) {
  const cell = (r, c) => c < 0 ? '' : str((r || [])[c]).replace(/\r/g, '');
  const h = rows.findIndex((r, i) => i < 20 && (r || []).some(x => /^รายละเอียดผลการดำเนินงาน/.test(str(x))));
  if (h < 0) return {};
  const head = rows[h].map(x => str(x).replace(/\s+/g, ' ')), col = re => head.findIndex(x => re.test(x));
  const C = { crit: col(/^ค่าเกณฑ์/), lv: col(/^ระดับ$/), narr: col(/^รายละเอียดผลการดำเนินงาน/), req: col(/^Min/i), has: col(/^ถ้ามีเอกสาร/), ev: col(/^ชื่อหลักฐาน/), rmk: col(/^ข้อสังเกต/), pr: col(/^แผนผล$/) };
  if (C.ev < 0 && C.has >= 0 && /^หมายเหตุ/.test(head[C.has + 1] || '')) C.ev = C.has + 1; // HCM keeps evidence names under "หมายเหตุ"
  const out = {}; let sub = null, lv = null;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i], a = cell(r, 0), b = cell(r, C.lv < 0 ? 1 : C.lv), m = /^ระดับ(?:ที่)?\s*(\d)/.exec(b);
    if (/^\d{1,2}(\.\d{1,2}){1,2}$/.test(a)) { sub = a; lv = null; continue; }
    if (!sub) continue;
    if (m) { lv = out[sub + '|' + m[1]] = { narr: '', mr: [], remark: '', plan: null, res: null, crit: cell(r, C.crit).slice(0, 600) }; } // crit: to match renumbered sub-issues
    if (!lv) continue;
    const n = cell(r, C.narr); if (n) lv.narr = lv.narr ? lv.narr + '\n' + n : n;
    const k = cell(r, C.rmk); if (k && !lv.remark) lv.remark = k;
    const q = cell(r, C.req); if (q) lv.mr.push([q, /^(true|✓|1)$/i.test(cell(r, C.has)), cell(r, C.ev)]);
    if (C.pr >= 0) { const t = cell(r, C.pr), v = Array.from({ length: 12 }, (_, j) => gNum((r || [])[C.pr + 1 + j])); if (t === 'แผน' && !lv.plan) lv.plan = v; if (t === 'ผล' && !lv.res) lv.res = v; }
  }
  return out;
}
async function guide(req, env) {
  const u = await me(req, env), part = str(new URL(req.url).searchParams.get('part')).toUpperCase();
  if (!Object.values(IND_PARTS).some(p => p.includes(part))) fail(400, 'ไม่รู้จักส่วนนี้');
  if (u.role === 'reporter' && !(IND_PARTS[u.ind] || []).includes(part)) fail(403, 'ดูได้เฉพาะตัวชี้วัดของตน');
  const id = env.GUIDE_SHEET_ID || GUIDE_DEFAULT;
  const levels = await cached('guide:' + id + ':' + part, 10 * 60e3, async () => {
    try { const [rows] = await getRanges(env, id, [`'${part}'!A1:BE1000`]); return parseGuide(rows); }
    catch (e) { if (e.google === 400) return {}; throw e; } // no tab for this part (e.g. CM)
  });
  return { fy: GUIDE_FY, part, levels };
}
/* ---------- writing assistant for reporters (Gemini): drafts only, the reporter reviews and saves ---------- */
const GEM_DEFAULT = 'gemini-flash-latest', GEM_FALLBACK = 'gemini-2.5-flash', GEM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const WRITE_MODES = {
  draft: 'เรียบเรียงข้อความของผู้รายงานใหม่ให้ตอบค่าเกณฑ์ครบทุกองค์ประกอบ เรียงตามลำดับข้อของค่าเกณฑ์',
  guide: 'ปรับผลการดำเนินงานปีก่อนให้เป็นร่างของปีบัญชีนี้ คงโครงสร้างที่ดีไว้ แต่วันที่ ครั้งที่ประชุม เลขคำสั่ง ตัวเลข และชื่อเอกสารของปีก่อนต้องเปลี่ยนเป็นช่องให้ระบุทั้งหมด',
  gaps: 'ไม่ต้องเขียนใหม่ ให้ตรวจว่าข้อความปัจจุบันตอบองค์ประกอบใดของค่าเกณฑ์แล้ว และยังขาดอะไร'
};
function writePrompt(mode, x, fy) {
  return {
    system: `คุณเป็นผู้ช่วยเรียบเรียงรายงานผลการดำเนินงานของรัฐวิสาหกิจตามเกณฑ์ SE-AM ปีบัญชี ${fy} ` +
      'กฎ: (1) ใช้เฉพาะข้อเท็จจริงที่ให้มา ห้ามแต่งวันที่ ตัวเลข ครั้งที่ประชุม เลขคำสั่ง หรือชื่อเอกสารขึ้นเอง ' +
      '(2) ข้อมูลที่จำเป็นแต่ไม่มี ให้ใส่ช่องว่างในรูปแบบ 【ระบุ ...】 เช่น 【ระบุวันที่ประชุม】 ' +
      '(3) ภาษาราชการ กระชับ เป็นข้อ ๆ ตามองค์ประกอบของค่าเกณฑ์ อ้างชื่อหลักฐานเมื่อมี (4) ตอบเป็น JSON อย่างเดียว',
    user: `งาน: ${WRITE_MODES[mode]}\n\n[ประเด็น] ${x.label}\n\n[ค่าเกณฑ์]\n${x.crit || '(ไม่มี)'}\n\n[ข้อความปัจจุบันของผู้รายงาน]\n${x.narr || '(ว่าง)'}\n\n` +
      (mode === 'guide' ? `[ผลการดำเนินงานปีก่อน]\n${x.prev || '(ไม่มี)'}\n\n` : '') +
      `[ชื่อหลักฐานที่มี]\n${x.ev.length ? x.ev.map((e, i) => (i + 1) + '. ' + e).join('\n') : '(ไม่มี)'}\n\n` +
      'ตอบรูปแบบนี้: {"draft":"ข้อความร่างทั้งหมด (โหมดตรวจให้เป็น \\"\\")","items":[{"item":"องค์ประกอบของค่าเกณฑ์ (สั้น)","status":"covered|partial|missing","note":"สั้น ๆ ว่าขาดอะไร"}],"tips":["คำแนะนำสั้น ๆ ไม่เกิน 3 ข้อ"]}'
  };
}
async function gemCall(env, p) {
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: p.system }] }, contents: [{ role: 'user', parts: [{ text: p.user }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' } });
  for (const model of [env.GEMINI_MODEL || GEM_DEFAULT, GEM_FALLBACK]) {
    const r = await fetch(GEM_URL + model + ':generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && model !== GEM_FALLBACK) continue; // alias not available: try the fallback model
    if (r.status === 429) fail(429, 'Gemini ถูกใช้เกินโควตาของบัญชี ลองใหม่ภายหลัง');
    if (!r.ok) { console.error('gemini', model, r.status, JSON.stringify(j).slice(0, 400)); fail(502, 'เรียก Gemini ไม่สำเร็จ ลองใหม่อีกครั้ง'); }
    const c = (j.candidates || [])[0] || {};
    return { model, text: ((c.content || {}).parts || []).map(x => x.text || '').join(''), finish: c.finishReason || '', usage: j.usageMetadata || null };
  }
}
function writeParse(text) {
  const t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  let o; try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  return { draft: cut(o.draft, 6000), items: (Array.isArray(o.items) ? o.items : []).slice(0, 12).map(i => ({ item: cut(i && i.item, 200), status: ['covered', 'partial', 'missing'].includes(i && i.status) ? i.status : 'partial', note: cut(i && i.note, 300) })).filter(i => i.item),
    tips: (Array.isArray(o.tips) ? o.tips : []).slice(0, 3).map(x => cut(x, 300)).filter(Boolean) };
}
async function aiWrite(req, env, fy) {
  sameOrigin(req);
  const u = await me(req, env), b = await req.json().catch(() => ({}));
  if (!env.GEMINI_API_KEY && !env.AI) fail(501, 'ยังไม่ได้ตั้งค่า AI สำหรับผู้ช่วยเขียน');
  const k = str(b.k), mode = str(b.mode);
  if (!AI_KEY.test(k) || !WRITE_MODES[mode]) fail(400, 'คำขอไม่ถูกต้อง');
  if (!own(u, k)) fail(403, 'ใช้ผู้ช่วยเขียนได้เฉพาะตัวชี้วัดของตน');
  const x = { label: cut(b.label, 120), crit: cut(b.crit, 3000), narr: cut(b.narr, 5000), prev: cut(b.prev, 5000), ev: (Array.isArray(b.ev) ? b.ev : []).slice(0, 10).map(e => cut(e, 200)).filter(Boolean) };
  if (mode === 'draft' && !x.narr) fail(400, 'เขียนข้อเท็จจริงสั้น ๆ ก่อน แล้วให้ผู้ช่วยเรียบเรียง');
  if (mode === 'guide' && !x.prev) fail(400, 'ไม่มีผลปีก่อนของระดับนี้');
  // daily caps: whole system and per person (kept in the ai store, which reporters cannot read or write)
  const day = todayIso(), key = 'gem|' + day, cap = +env.GEMINI_DAILY_CALLS || 800, { st, at } = await loadState(env, fy), c = st.ai[key] || { n: 0, by: {} };
  if ((c.by[u.id] || 0) >= 40) fail(429, 'วันนี้ท่านใช้ผู้ช่วยเขียนครบ 40 ครั้งแล้ว ใช้ได้อีกครั้งพรุ่งนี้');
  const p = writePrompt(mode, x, fy), ops = [];
  let parsed = null, engine = '', model = '', err = null;
  // Gemini first; no key, its daily cap reached, or any failure → Workers AI does the same job
  if (env.GEMINI_API_KEY && c.n < cap) {
    try {
      const out = await gemCall(env, p); model = out.model; parsed = writeParse(out.text);
      if (!parsed) throw Object.assign(new Error(out.finish === 'MAX_TOKENS' ? 'ข้อความยาวเกินไป ลองแบ่งให้สั้นลง' : 'Gemini ตอบในรูปแบบที่อ่านไม่ได้ ลองใหม่อีกครั้ง'), { status: 502 });
      engine = 'gemini'; c.n++;
    } catch (e) { err = e; parsed = null; console.error('gemini → workers ai', e.status || '', e.message); }
  } else if (env.GEMINI_API_KEY) err = Object.assign(new Error('ผู้ช่วยเขียนถูกใช้ครบโควตาของวันนี้แล้ว ใช้ได้อีกครั้งพรุ่งนี้'), { status: 429 });
  if (!parsed && env.AI) {
    const ukey = 'usage|' + new Date().toISOString().slice(0, 10), limit = +env.AI_DAILY_NEURONS || 8000, before = (st.ai[ukey] || {}).n || 0;
    if (before >= limit) fail(429, 'โควตา AI ของวันนี้หมดแล้ว ใช้ได้อีกครั้ง 07:00 น.');
    model = env.AI_MODEL || AI_DEFAULT;
    let r;
    try { r = await aiCall(env, model, [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], 2400); }
    catch (e) { console.error('workers ai write', e.stack || e); fail(502, 'ผู้ช่วยเขียนไม่ตอบ ลองใหม่อีกครั้ง'); }
    ops.push({ s: 'ai', k: ukey, v: { n: before + aiNeurons(model, r.usage, x), limit } });
    parsed = writeParse(r.text); engine = 'workers';
    if (!parsed) { console.error('workers ai write parse', String(r.text).slice(0, 300)); await writeState(env, fy, at, ops, u); fail(502, 'ผู้ช่วยเขียนตอบในรูปแบบที่อ่านไม่ได้ ลองใหม่อีกครั้ง'); }
  }
  if (!parsed) throw err;
  c.by[u.id] = (c.by[u.id] || 0) + 1; ops.push({ s: 'ai', k: key, v: c });
  await writeState(env, fy, at, ops, u);
  return Object.assign(parsed, { mode, model, engine, left: 40 - c.by[u.id] });
}
const extOf = name => (String(name).split('.').pop() || '').toLowerCase();
async function upload(req, env, fy) {
  sameOrigin(req);
  const u = await me(req, env), q = new URL(req.url).searchParams, key = q.get('key') || '', name = str(q.get('name')).slice(0, 200), ext = extOf(name);
  if (!env.FILES_FOLDER_ID) fail(501, 'ยังไม่ได้ตั้งค่าโฟลเดอร์เก็บไฟล์หลักฐาน');
  if (!own(u, key)) fail(403, 'แนบไฟล์ได้เฉพาะส่วนที่รับผิดชอบ');
  if (!FILE_TYPES[ext]) fail(415, 'ไม่รองรับไฟล์ .' + ext);
  if (!editable((await loadState(env, fy)).st, u.ind)) fail(409, 'รายงานนี้ส่งตรวจแล้ว แก้ไขได้เมื่อ กปม. ส่งกลับ');
  const data = await req.arrayBuffer();
  if (data.byteLength > MAX_FILE) fail(413, 'ไฟล์ใหญ่กว่า 10 MB');
  const b = 'cbe' + crypto.randomUUID(), meta = { name, parents: [await levelFolder(env, fy, key)], mimeType: FILE_TYPES[ext], description: key + ' · ' + u.id };
  const r = await g(env, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', { method: 'POST', drive: true,
    headers: { 'content-type': 'multipart/related; boundary=' + b },
    body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${FILE_TYPES[ext]}\r\n\r\n`, data, `\r\n--${b}--`]) })
    .catch(e => { if (/storageQuota/.test(e.message)) fail(507, 'Drive ไม่มีพื้นที่ให้บัญชีระบบ ต้องตั้งค่า DRIVE_OAUTH ของเจ้าของโฟลเดอร์'); throw e; });
  const { id } = await r.json();
  return { id, url: '/api/file/' + id };
}
// Files are served only to people who can see the indicator that references them
async function download(req, env, fy, id) {
  const u = await me(req, env), { st } = await loadState(env, fy);
  let file = null, key = null;
  Object.keys(st.patch).some(k => (st.patch[k].mr || []).some(m => (m[2] || []).some(f => { if (f && f.id === id) { file = f; key = k; } return file; })));
  if (!file || (u.role === 'reporter' && key.split('|')[0] !== u.ind)) fail(404, 'ไม่พบไฟล์');
  const r = await g(env, `${DRIVE}${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { drive: true }).catch(e => { if (e.google === 404) fail(404, 'ไฟล์ถูกลบออกจาก Drive แล้ว'); throw e; });
  const ext = extOf(file.name);
  return new Response(r.body, { headers: { 'content-type': INLINE.includes(ext) ? FILE_TYPES[ext] : 'application/octet-stream', 'x-content-type-options': 'nosniff',
    'content-disposition': (INLINE.includes(ext) ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(file.name), 'cache-control': 'private, no-store' } });
}

/* ---------- LINE notifications (Messaging API) ----------
   Linking: a signed-in user asks for a 6-digit code (10 minutes, single use), adds the OA as a friend and sends the code
   in the chat; the webhook stores the LINE user ID. Tab "line": A id | B line_user | C linked_at | D code | E code_exp (ms).
   Jobs (POST /api/notify, header x-cron-key = CRON_KEY), run daily at 08:00 by .github/workflows/line-notify.yml:
     day 1  reporters: levels planned for last month (due on the 5th) + levels behind plan
     day 6  กปม.: monthly summary of every indicator + overdue levels
     daily  reporters: plan-entry window closes in 3 days
   Event: กปม. opens/closes a plan-entry window → reporters are told at once. */
const LINE_API = 'https://api.line.me/v2/bot/message/', CODE_MIN = 10, THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WIN_NAME = { plan: 'แผนการดำเนินงาน', gap: 'แผนปรับปรุง GAP' };
const C = { navy: '#0B2E9E', blue: '#1F5BFF', ink: '#0E1A3A', mute: '#5E6B88', line: '#E3E8F3', ok: '#0B8A60', bad: '#C4253F', warn: '#B86E00', gap: '#D9730D', soft: '#F3F6FC' };
const thDay = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`; };
const todayIso = (plus = 0) => new Date(Date.now() + 7 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);

async function lineRows(env) {
  const [rows] = await getRanges(env, env.SYSTEM_SHEET_ID, ['line!A2:E']);
  return rows.map((r, i) => ({ row: i + 2, id: str(r[0]), user: str(r[1]), at: str(r[2]), code: str(r[3]), exp: +r[4] || 0 })).filter(r => r.id);
}
const lineSet = (env, r) => putRanges(env, env.SYSTEM_SHEET_ID, [{ range: `line!A${r.row}:E${r.row}`, values: [[r.id, r.user, r.at, r.code, r.exp ? String(r.exp) : '']] }]);
async function lineUpsert(env, rows, id, patch) {
  const r = rows.find(x => x.id === id);
  if (r) return lineSet(env, Object.assign(r, patch));
  const n = Object.assign({ id, user: '', at: '', code: '', exp: 0 }, patch);
  return appendRows(env, env.SYSTEM_SHEET_ID, 'line!A:E', [[n.id, n.user, n.at, n.code, n.exp ? String(n.exp) : '']]);
}
async function lineStatus(env, id) {
  if (!env.LINE_CHANNEL_TOKEN) return { enabled: false };
  let r; try { r = (await lineRows(env)).find(x => x.id === id); } catch (e) { console.error('line tab', e.message); return { enabled: false }; }
  return { enabled: true, linked: !!(r && r.user), at: r && r.user ? r.at : '', addUrl: env.LINE_ADD_URL || '' };
}
async function lineApi(req, env, path) {
  sameOrigin(req);
  const u = await me(req, env);
  if (!env.LINE_CHANNEL_TOKEN) fail(503, 'ยังไม่ได้ตั้งค่า LINE ในระบบ ติดต่อ กปม.');
  if (path === 'status') return lineStatus(env, u.id);
  const rows = await lineRows(env);
  if (path === 'code') {
    const live = new Set(rows.filter(r => r.exp > Date.now()).map(r => r.code));
    let code; do { code = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000); } while (live.has(code));
    const exp = Date.now() + CODE_MIN * 60e3;
    await lineUpsert(env, rows, u.id, { code, exp });
    return { code, expiresAt: exp, addUrl: env.LINE_ADD_URL || '' };
  }
  if (path === 'unlink') { await lineUpsert(env, rows, u.id, { user: '', at: '', code: '', exp: 0 }); await logLine(env, u, 'ยกเลิกการเชื่อมต่อ LINE'); return { ok: true }; }
  if (path === 'test') {
    const r = rows.find(x => x.id === u.id);
    if (!r || !r.user) fail(409, 'ยังไม่ได้เชื่อมต่อ LINE');
    await linePush(env, r.user, [flex('ทดสอบการแจ้งเตือน CBE', bubble({ tag: 'ทดสอบ', eyebrow: label(u), title: 'ทดสอบการแจ้งเตือน',
      body: [txt('การแจ้งเตือนผ่าน LINE ใช้งานได้แล้ว คุณจะได้รับสรุปงานทุกวันที่ 1 ของเดือน', { wrap: true, color: C.ink })], url: new URL(req.url).origin }))], 'test|' + u.id + '|' + Date.now());
    return { ok: true };
  }
  fail(404, 'Not found');
}
const logLine = (env, u, what) => appendRows(env, env.SYSTEM_SHEET_ID, 'log!A:D', [[stamp(), u.id, label(u), what]]);

// Webhook: signature check, then link by code / greet / help
async function lineWebhook(req, env, fy) {
  const raw = await req.text(), sig = req.headers.get('x-line-signature') || '';
  if (!env.LINE_CHANNEL_SECRET) fail(503, 'LINE not configured');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.LINE_CHANNEL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)))));
  if (!sig || sig !== want) fail(401, 'bad signature');
  const events = (JSON.parse(raw || '{}').events || []), origin = new URL(req.url).origin;
  for (const ev of events) {
    const uid = ev.source && ev.source.userId; if (!uid || !ev.replyToken) continue;
    try { await lineEvent(env, fy, origin, ev, uid); } catch (e) {
      console.error('line webhook', e.stack || e);
      try { await lineReply(env, ev.replyToken, [plain('ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรือติดต่อ กองประเมินผล 343')]); } catch (e2) { console.error('line reply', e2.message); }
    }
  }
  return json({ ok: true });
}
// Rich menu sends these words; anything else that is not a 6-digit code gets the help card
const KEYWORDS = [[/^(สถานะ|สถานะของฉัน|status)$/i, 'status'], [/^(กำหนดส่ง|ปฏิทิน|deadline)$/i, 'deadline'], [/^(ช่วยเหลือ|help|เมนู|menu)$/i, 'help']];
async function lineEvent(env, fy, origin, ev, uid) {
  if (ev.type === 'follow') return lineReply(env, ev.replyToken, [helpMsg('ยินดีต้อนรับสู่การแจ้งเตือน CBE Reporting System', origin)]);
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
  const text = ev.message.text.replace(/\s/g, ''), kw = (KEYWORDS.find(k => k[0].test(text)) || [])[1];
  if (kw === 'help') return lineReply(env, ev.replyToken, [helpMsg('ช่วยเหลือ', origin)]);
  if (kw === 'deadline') return lineReply(env, ev.replyToken, [await deadlineMsg(env, fy, origin)]);
  if (kw === 'status') {
    const sys = await system(env), r = (await lineRows(env)).find(x => x.user === uid && sys.users[x.id]);
    if (!r) return lineReply(env, ev.replyToken, [helpMsg('ยังไม่ได้เชื่อมต่อบัญชี', origin)]);
    const u = sys.users[r.id], { st } = await loadState(env, fy), m = openFrom();
    const rs = rolesOf(u), msgs = [];
    for (const x of rs.filter(x => x.role === 'reporter')) msgs.push(await reporterMsg(env, fy, st, Object.assign({}, u, x), m, origin, 'status')); // every indicator the person reports
    if (!msgs.length || rs.some(x => x.role !== 'reporter')) msgs.push(await summaryMsg(env, fy, st, m, origin, 'status'));
    return lineReply(env, ev.replyToken, msgs.slice(0, 5));
  }
  if (!/^\d{6}$/.test(text)) return lineReply(env, ev.replyToken, [helpMsg('พิมพ์รหัส 6 หลักเพื่อเชื่อมต่อบัญชี', origin)]);
  const rows = await lineRows(env), r = rows.find(x => x.code === text);
  if (!r || r.exp < Date.now()) return lineReply(env, ev.replyToken, [plain(r ? 'รหัสนี้หมดอายุแล้ว กรุณาขอรหัสใหม่จากเมนูบัญชีในระบบ' : 'ไม่พบรหัสนี้ ตรวจสอบตัวเลขอีกครั้ง หรือขอรหัสใหม่จากเมนูบัญชีในระบบ')]);
  for (const o of rows) if (o.user === uid && o.id !== r.id) await lineSet(env, Object.assign(o, { user: '', at: '' })); // one LINE account ↔ one employee
  await lineSet(env, Object.assign(r, { user: uid, at: stamp(), code: '', exp: 0 }));
  const u = (await system(env)).users[r.id] || { id: r.id, role: '' };
  await logLine(env, u, 'เชื่อมต่อ LINE');
  return lineReply(env, ev.replyToken, [flex('เชื่อมต่อ LINE สำเร็จ', bubble({ tag: 'เชื่อมต่อสำเร็จ', eyebrow: 'รหัสพนักงาน ' + r.id, title: label(u), url: origin + '/?tab=dash', button: 'เปิดงานของฉัน',
    body: [txt('คุณจะได้รับการแจ้งเตือนจาก CBE Reporting System ทาง LINE นี้', { wrap: true, color: C.ink }), txt('กดเมนูด้านล่างเพื่อดูสถานะงานหรือกำหนดส่งได้ทุกเมื่อ', { size: 'xs', color: C.mute, margin: 'md', wrap: true }), txt('ยกเลิกได้ที่เมนูบัญชีในระบบ', { size: 'xs', color: C.mute, margin: 'sm' })] }))]);
}
const helpMsg = (title, url) => flex(title, bubble({ tag: 'ช่วยเหลือ', eyebrow: 'CBE Reporting System', title, panels: [[
  txt('วิธีเชื่อมต่อ', { weight: 'bold', color: C.ink }),
  txt('1. เข้าระบบ CBE แล้วกดชื่อของคุณที่มุมขวาบน', { wrap: true, size: 'sm', color: C.ink, margin: 'sm' }),
  txt('2. เลือก "เชื่อมต่อ LINE" แล้วกด "รับรหัส"', { wrap: true, size: 'sm', color: C.ink }),
  txt('3. ส่งรหัส 6 หลักในแชทนี้ (ใช้ได้ภายใน 10 นาที)', { wrap: true, size: 'sm', color: C.ink })], [
  txt('คำสั่งในแชท', { weight: 'bold', color: C.ink }),
  row('สถานะ', 'สรุปงานที่ต้องรายงานและงานล่าช้า'), row('กำหนดส่ง', 'วันส่งรายงานและช่วงกรอกแผน')]],
  body: [txt('ติดต่อสอบถาม กองประเมินผล โทร 343', { wrap: true, size: 'sm', color: C.ink, align: 'center' })], url }));
const plain = text => ({ type: 'text', text });

async function lineCall(env, path, body, retryKey) {
  const r = await fetch(LINE_API + path, { method: 'POST', headers: { authorization: 'Bearer ' + env.LINE_CHANNEL_TOKEN, 'content-type': 'application/json', ...(retryKey ? { 'x-line-retry-key': await uuidFrom(retryKey) } : {}) }, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 409) throw new Error('LINE ' + r.status + ': ' + (await r.text()).slice(0, 300)); // 409 = already sent with this retry key
}
const lineReply = (env, token, messages) => lineCall(env, 'reply', { replyToken: token, messages });
const linePush = (env, to, messages, key) => lineCall(env, 'push', { to, messages }, key);
// Same job + day + person → same retry key, so a repeated cron run does not send twice
async function uuidFrom(s) {
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* Flex building blocks: blue→white gradient, logo header, frosted-glass panels (translucent white + white edge) */
const flex = (altText, contents) => ({ type: 'flex', altText: altText.slice(0, 400), contents });
const txt = (text, o = {}) => ({ type: 'text', text: String(text).slice(0, 2000) || ' ', size: 'sm', ...o });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents: contents.length ? contents : [{ type: 'filler' }], ...o });
const row = (left, right, o = {}) => box('horizontal', [txt(left, { flex: 0, color: o.lc || C.blue, weight: 'bold', size: 'xs' }), txt(right, { flex: 1, wrap: true, color: C.ink, size: 'sm' })], { spacing: 'md', margin: 'sm' });
const glass = (contents, o = {}) => box('vertical', contents, { backgroundColor: '#FFFFFFA6', borderWidth: '1px', borderColor: '#FFFFFF', cornerRadius: '14px', paddingAll: '12px', ...o });
const stat = (n, label, color) => glass([txt(String(n), { size: 'xxl', weight: 'bold', color, align: 'center' }), txt(label, { size: 'xxs', color: C.mute, align: 'center', wrap: true })], { flex: 1, paddingAll: '10px' });
const sep = () => ({ type: 'separator', margin: 'lg', color: '#D6E4FA' });
const chip = (text, color) => box('vertical', [txt(text, { size: 'xxs', weight: 'bold', color, align: 'center' })], { flex: 0, backgroundColor: color + '1F', cornerRadius: '10px', paddingStart: '8px', paddingEnd: '8px', paddingTop: '1px', paddingBottom: '1px' });
const pct = x => Math.max(0, Math.min(100, Math.round(x)));
// Progress / bar track: width in %, gradient or solid fill
function bar(p, color, h = '9px') {
  const fill = p > 0 ? [box('vertical', [], { width: Math.max(4, pct(p)) + '%', height: h, cornerRadius: '6px', ...(color ? { backgroundColor: color } : { background: { type: 'linearGradient', angle: '90deg', startColor: '#3F8CFF', endColor: C.blue } }) })] : [];
  return box('horizontal', fill, { height: h, cornerRadius: '6px', backgroundColor: '#D6E4FA' });
}
// 12 small columns (fiscal months), the current one highlighted
function columns(vals, cur) {
  const max = Math.max(1, ...vals);
  return [box('horizontal', vals.map((v, i) => box('vertical', [box('vertical', [], { height: Math.max(3, Math.round(v / max * 46)) + 'px', cornerRadius: '3px', backgroundColor: i === cur ? C.blue : i < cur ? '#1F5BFF66' : '#BFD6FB' })], { flex: 1, justifyContent: 'flex-end' })), { height: '48px', spacing: '4px', margin: 'md' }),
    box('horizontal', MONTHS.map((m, i) => txt(m.replace(/\./g, ''), { size: 'xxs', color: i === cur ? C.blue : C.mute, align: 'center', flex: 1, weight: i === cur ? 'bold' : 'regular' })), { spacing: '4px', margin: 'xs' })];
}
const TONES = { [C.blue]: ['#1F5BFF', '#3F8CFF', '#7CC0FF'], [C.navy]: ['#0B2E9E', '#1F5BFF', '#5FA8FF'], [C.ok]: ['#0B6E50', '#0B8A60', '#4CC79A'], [C.warn]: ['#B05A00', '#E07F00', '#FFC266'], [C.mute]: ['#36405A', '#5E6B88', '#9AA6C0'], [C.bad]: ['#8C1028', '#C4253F', '#F06C80'] };
function bubble({ tone = C.blue, tag, eyebrow, title, sub, stats, panels = [], body = [], url, button = 'เปิดระบบรายงานผล' }) {
  const g = TONES[tone] || TONES[C.blue], origin = url ? new URL(url).origin : '';
  const top = box('horizontal', [].concat(origin ? [{ type: 'image', url: origin + '/assets/line-logo.png', size: '86px', aspectRatio: '900:314', aspectMode: 'fit', flex: 0, align: 'start' }] : [txt('CBE', { weight: 'bold', color: '#FFFFFF', size: 'md', flex: 0 })], [{ type: 'filler' }],
    tag ? [box('vertical', [txt(tag, { size: 'xxs', weight: 'bold', color: '#FFFFFF', align: 'center' })], { flex: 0, backgroundColor: '#FFFFFF33', borderWidth: '1px', borderColor: '#FFFFFF99', cornerRadius: '12px', paddingStart: '10px', paddingEnd: '10px', paddingTop: '3px', paddingBottom: '3px' })] : []), { alignItems: 'center' });
  const b = { type: 'bubble', size: 'mega',
    header: box('vertical', [top].concat(eyebrow ? [txt(eyebrow, { size: 'xs', color: '#FFFFFFD9', margin: 'lg' })] : [], [txt(title, { size: 'lg', color: '#FFFFFF', weight: 'bold', wrap: true, margin: eyebrow ? 'none' : 'lg' })], sub ? [txt(sub, { size: 'xs', color: '#FFFFFFD9', wrap: true })] : []),
      { paddingAll: '16px', paddingBottom: '18px', background: { type: 'linearGradient', angle: '135deg', startColor: g[0], centerColor: g[1], endColor: g[2] } }),
    body: box('vertical', [].concat(stats ? [box('horizontal', stats, { spacing: 'sm' })] : [], panels.map(x => glass(x)), body.length ? [glass(body)] : []),
      { paddingAll: '14px', spacing: 'md', background: { type: 'linearGradient', angle: '180deg', startColor: '#D3E5FF', centerColor: '#EAF3FF', endColor: '#F5F9FF' } }),
    styles: { footer: { backgroundColor: '#F5F9FF' } } };
  if (url) b.footer = box('vertical', [box('vertical', [txt(button, { color: '#FFFFFF', weight: 'bold', align: 'center', size: 'md' })], { paddingAll: '11px', cornerRadius: '12px', background: { type: 'linearGradient', angle: '90deg', startColor: C.blue, endColor: '#3F8CFF' }, action: { type: 'uri', label: button.slice(0, 20), uri: url } })], { paddingAll: '14px', paddingTop: '0px' });
  return b;
}
function listBlock(head, color, items, max = 8, first) {
  if (!items.length) return [];
  return [txt(head, { weight: 'bold', color, margin: first ? 'none' : 'lg' })].concat(items.slice(0, max).map(x => row(x[0], x[1], { lc: color })))
    .concat(items.length > max ? [txt(`และอีก ${items.length - max} รายการ`, { size: 'xs', color: C.mute, margin: 'sm' })] : []);
}

/* What each level holds after the users' edits (same rules as the app) */
const sum12 = a => (a || []).reduce((x, y) => x + (+y || 0), 0);
const cum = (a, m) => { let s = 0; for (let i = 0; i <= m; i++) s += +((a || [])[i]) || 0; return s; };
const stTarget = st => st.mode === 'pct' ? 100 : (+st.target || sum12(st.plan) || 1);
const hasPlan = st => sum12(st.plan) > 0 || (!st.custom && +st.target > 0);
async function levelsOf(env, fy, st, ind, onlyPart) {
  const out = [];
  for (const part of IND_PARTS[ind]) {
    if (onlyPart && part !== onlyPart) continue;
    const f = await form(env, fy, part); if (!f) continue;
    for (const s of f.data.subs) for (const L of s.levels) {
      const key = [ind, part, s.code, L.level].join('|'), p = st.patch[key] || {};
      const steps = L.steps.map((x, i) => ({ plan: (p.plan || [])[i] || x.plan, result: (p.res || [])[i] || x.result, target: x.target }))
        .concat((p.cs || []).map(x => ({ custom: true, plan: x.p, result: x.r, target: x.t, mode: x.mo })));
      const gsteps = (p.gs || []).map(x => ({ custom: true, plan: x.p, result: x.r, target: x.t, mode: x.mo }));
      out.push({ part, code: s.code, name: s.name, level: L.level, label: (IND_PARTS[ind].length > 1 ? part + ' ' : '') + s.code + ' ระดับ ' + L.level, steps, gsteps,
        mrMissing: L.mr.filter((r, i) => !/^เอกสารประกอบอื่น/.test(r.req) && !((p.mr || [])[i] ? p.mr[i][0] : r.has)).length });
    }
  }
  return out;
}
const dueIn = (list, m) => list.some(st => hasPlan(st) && (+((st.plan || [])[m]) || 0) > 0);
const behind = (list, m) => m >= 0 && list.some(st => hasPlan(st) && cum(st.result, m) < Math.min(cum(st.plan, m), stTarget(st)));

/* Jobs */
async function notify(req, env, fy) {
  const key = req.headers.get('x-cron-key') || '';
  if (!env.CRON_KEY || key !== env.CRON_KEY) fail(401, 'unauthorized');
  if (!env.LINE_CHANNEL_TOKEN) fail(503, 'LINE not configured');
  const q = new URL(req.url).searchParams, dry = q.get('dry') === '1', day = +(q.get('day') || bkk().getUTCDate()), jobs = q.get('job') ? [q.get('job')] : ['daily'];
  const origin = new URL(req.url).origin, sys = await system(env), links = (await lineRows(env)).filter(r => r.user && sys.users[r.id]);
  const { st } = await loadState(env, fy), out = [];
  const send = async (r, msg, tag) => { out.push({ id: r.id, alt: msg.altText, contents: msg.contents }); if (!dry) await linePush(env, r.user, [msg], tag + '|' + todayIso() + '|' + r.id); };
  const want = j => jobs.includes(j) || (jobs.includes('daily') && ((j === 'monthly' && day === 1) || (j === 'summary' && day === 6) || j === 'closing'));
  const rm = (fyMonth(bkk()) + 11) % 12;
  if (want('monthly')) for (const r of links) {
    for (const x of rolesOf(sys.users[r.id]).filter(x => x.role === 'reporter')) { // one card per indicator the person reports
      const u = Object.assign({}, sys.users[r.id], x);
      await send(r, await reporterMsg(env, fy, st, u, rm, origin, 'monthly'), 'monthly-' + u.ind);
    }
  }
  if (want('summary')) {
    const msg = await summaryMsg(env, fy, st, rm, origin, 'monthly');
    for (const r of links) if (rolesOf(sys.users[r.id]).some(x => x.role === 'audit')) await send(r, msg, 'summary');
  }
  if (want('closing')) for (const k of Object.keys(WIN_NAME)) {
    const c = st.cfg[k] || {}; if (c.open === false || c.to !== todayIso(3)) continue;
    await broadcastWindow(env, sys, links, k, c, 'closing', origin, send);
  }
  return { ok: true, dry, sent: out.length, messages: dry ? out : undefined };
}
// Report for fiscal month m is due on the 5th of the following calendar month
function dueOf(fy, m) { const d = new Date(Date.UTC(fy - 543 - (m < 3 ? 1 : 0), (m + 9) % 12 + 1, 5)); return { iso: d.toISOString().slice(0, 10), th: `5 ${THAI_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}` }; }
const daysTo = iso => Math.round((Date.parse(iso) - Date.parse(todayIso())) / 864e5);
const WFT = { draft: ['ยังไม่ส่ง', C.mute], submitted: ['รอ กปม. ตรวจ', C.blue], approved: ['อนุมัติแล้ว', C.ok], returned: ['ส่งกลับให้แก้ไข', C.bad] };
const allPlanned = L => L.steps.concat(L.gsteps).filter(hasPlan);
const levelDone = L => { const a = allPlanned(L); return a.length > 0 && a.every(st => cum(st.result, 11) >= stTarget(st)); };
// One reporter's month: levels planned this month + late ones, year progress and a 12-month plan chart.
// mode 'monthly' (day-1 push) or 'status' (rich menu)
async function reporterMsg(env, fy, st, u, rm, origin, mode) {
  const lv = await levelsOf(env, fy, st, u.ind, u.part), due = dueOf(fy, rm), status = mode === 'status';
  const now = lv.filter(L => dueIn(L.steps, rm) || dueIn(L.gsteps, rm)).map(L => [L.label, (dueIn(L.gsteps, rm) && !dueIn(L.steps, rm) ? '[GAP] ' : '') + L.name]);
  const late = lv.filter(L => behind(L.steps, rm - 1) || behind(L.gsteps, rm - 1)).map(L => [L.label, L.name + (behind(L.gsteps, rm - 1) ? ' · แผน GAP' : '')]);
  const planned = lv.filter(L => allPlanned(L).length), done = planned.filter(levelDone).length;
  const perMonth = MONTHS.map((_, m) => lv.filter(L => dueIn(L.steps, m) || dueIn(L.gsteps, m)).length);
  const wf = st.wf[u.ind] || 'draft', left = daysTo(due.iso), overdue = left < 0 && wf !== 'approved' && wf !== 'submitted';
  const progress = [box('horizontal', [txt('ความคืบหน้าทั้งปี', { weight: 'bold', color: C.ink, flex: 1 }), txt(`${done} / ${planned.length} ระดับ`, { weight: 'bold', color: C.blue, flex: 0, size: 'sm' })]),
    box('vertical', [bar(planned.length ? done / planned.length * 100 : 0)], { margin: 'md' })].concat(columns(perMonth, rm), [txt('จำนวนระดับที่มีแผนแต่ละเดือน', { size: 'xxs', color: C.mute, margin: 'sm' })]);
  const lists = listBlock('มีแผนเดือน ' + MONTHS[rm], C.ink, now, 8, true).concat(listBlock('ล่าช้า / เลยกำหนด', C.bad, late, 8, !now.length));
  return flex(`${status ? 'สถานะ' : ''}รายงานผลเดือน ${MONTHS[rm]} ครบกำหนด ${due.th}`, bubble({ tag: status ? 'สถานะของฉัน' : 'แจ้งเตือนรายเดือน',
    eyebrow: label(u) + ' · ' + thDay(todayIso()), title: `รายงานผลเดือน ${MONTHS[rm]}`,
    sub: `ครบกำหนด ${due.th} · ` + (status ? WFT[wf][0] + (overdue ? ` · เลยกำหนด ${-left} วัน` : left >= 0 && wf !== 'approved' && wf !== 'submitted' ? ` · เหลือ ${left} วัน` : '') : wf === 'returned' ? 'กปม. ส่งกลับให้แก้ไข' : 'ส่งผลภายในวันที่ 5'),
    panels: [progress], stats: [stat(now.length, 'ต้องรายงานเดือนนี้', C.blue), stat(late.length, 'ล่าช้า', late.length ? C.bad : C.ok)],
    body: lists.length ? lists : [txt('ไม่มีแผนที่ต้องรายงานในเดือนนี้', { color: C.ok, align: 'center' })],
    url: origin + '/?tab=' + (status ? 'dash' : 'report'), button: status ? 'เปิดงานของฉัน' : 'เปิดหน้ารายงานผล' }));
}
// All indicators for กปม./ผู้บริหาร: share of levels on plan (not behind) as horizontal bars, coloured by report status
async function summaryMsg(env, fy, st, rm, origin, mode) {
  const rowsI = [];
  for (const ind of Object.keys(IND_PARTS)) {
    const lv = await levelsOf(env, fy, st, ind), due = lv.filter(L => allPlanned(L).some(x => cum(x.plan, rm) > 0)), late = due.filter(L => behind(L.steps, rm) || behind(L.gsteps, rm)).length;
    rowsI.push({ ind, wf: st.wf[ind] || 'draft', late, p: due.length ? (due.length - late) / due.length * 100 : null });
  }
  const n = rowsI.length, sent = rowsI.filter(x => x.wf === 'submitted' || x.wf === 'approved').length, lateTotal = rowsI.reduce((a, x) => a + x.late, 0), status = mode === 'status';
  const CHIP = { draft: ['ยังไม่ส่ง', C.mute], submitted: ['รอตรวจ', C.blue], approved: ['อนุมัติ', C.ok], returned: ['ส่งกลับ', C.bad] };
  const table = [box('horizontal', [txt('ระดับที่เป็นไปตามแผน', { weight: 'bold', color: C.ink, flex: 1 }), txt('%', { size: 'xs', color: C.mute, flex: 0 })])].concat(rowsI.map(x =>
    box('horizontal', [box('vertical', [txt(x.ind, { weight: 'bold', color: C.ink, size: 'xs' })], { width: '44px', flex: 0 }),
      box('vertical', [bar(x.p || 0, CHIP[x.wf][1] === C.mute ? '#8D99B3' : CHIP[x.wf][1], '8px')], { flex: 1, justifyContent: 'center' }),
      box('vertical', [txt(x.p == null ? '–' : String(pct(x.p)), { size: 'xxs', color: C.mute, align: 'end' })], { width: '26px', flex: 0 }), chip(CHIP[x.wf][0], CHIP[x.wf][1])],
      { spacing: 'sm', margin: 'md', alignItems: 'center' })));
  return flex(`สรุปผลรายเดือน ${MONTHS[rm]}: ส่งแล้ว ${sent}/${n} · เลยกำหนด ${lateTotal} ระดับ`, bubble({ tone: C.navy, tag: status ? 'ภาพรวม' : 'สรุปสำหรับ กปม.',
    eyebrow: (status ? 'กำหนดส่ง ' : 'หลังครบกำหนด ') + dueOf(fy, rm).th, title: `ภาพรวมรายงานเดือน ${MONTHS[rm]}`,
    stats: [stat(sent + '/' + n, 'ตัวชี้วัดที่ส่งแล้ว', C.blue), stat(lateTotal, 'ระดับเลยกำหนด', lateTotal ? C.bad : C.ok)], body: table, url: origin + '/?tab=score', button: 'เปิดภาพรวม CBE' }));
}
// Rich menu "กำหนดส่ง": countdown, where today sits in the reporting cycle, and the plan-entry windows
async function deadlineMsg(env, fy, origin) {
  const { st } = await loadState(env, fy), m = openFrom(), due = dueOf(fy, m), left = daysTo(due.iso), t = todayIso(), day = +t.slice(8);
  const seg = day <= 5 ? 3 : day <= 10 ? 0 : day <= 20 ? 1 : 2, nextM = THAI_MONTHS[(+due.iso.slice(5, 7)) - 1];
  const tl = box('horizontal', ['1–10', '11–20', '21–สิ้นเดือน', '1–5 ' + nextM].map((lb, i) => box('vertical', [box('vertical', [], { height: '8px', cornerRadius: '3px', backgroundColor: i === 3 ? (seg === 3 ? '#F06A1D' : '#FFB27A') : i === seg ? C.blue : i < seg ? '#1F5BFF66' : '#D6E4FA' }),
    txt(lb, { size: 'xxs', align: 'center', color: i === 3 ? '#E2600F' : i === seg ? C.blue : C.mute, weight: i === 3 || i === seg ? 'bold' : 'regular', margin: 'xs' })], { flex: 1 })), { spacing: '3px', margin: 'lg' });
  const winRow = k => {
    const c = st.cfg[k] || {}, open = c.open !== false && (!c.from || t >= c.from) && (!c.to || t <= c.to), soon = c.open !== false && c.from && t < c.from;
    const when = c.open === false ? 'ปิดรับการแก้ไข' : soon ? 'เปิด ' + thDay(c.from) + (c.to ? ' – ' + thDay(c.to) : '') : c.to && t > c.to ? 'ปิดแล้วเมื่อ ' + thDay(c.to) : c.to ? 'ถึง ' + thDay(c.to) : 'ไม่กำหนดวันปิด';
    return box('horizontal', [box('vertical', [txt(WIN_NAME[k], { color: C.ink, weight: 'bold' }), txt(when, { size: 'xxs', color: C.mute, wrap: true })], { flex: 1 }),
      chip(open ? 'เปิดอยู่' : soon ? 'ยังไม่เปิด' : 'ปิดแล้ว', open ? C.ok : C.mute)], { margin: 'md', alignItems: 'center', spacing: 'md' });
  };
  return flex(`กำหนดส่งรายงานเดือน ${MONTHS[m]}: ${due.th}`, bubble({ tag: 'กำหนดส่ง', eyebrow: thDay(t), title: `ส่งรายงานเดือน ${MONTHS[m]}`, sub: 'ภายใน ' + due.th,
    panels: [[box('horizontal', [txt(String(Math.max(0, left)), { size: '3xl', weight: 'bold', color: left <= 2 ? '#E2600F' : C.blue, flex: 0 }), txt(left > 0 ? 'วันก่อนครบกำหนด' : 'ครบกำหนดวันนี้', { size: 'sm', color: C.ink, weight: 'bold', flex: 0, gravity: 'bottom', margin: 'md' })], { justifyContent: 'center' }),
      tl, txt('รายงานผลทุกเดือน ภายในวันที่ 5 ของเดือนถัดไป', { size: 'xxs', color: C.mute, align: 'center', margin: 'md' })]],
    body: [txt('ช่วงกรอกแผน', { weight: 'bold', color: C.ink })].concat(Object.keys(WIN_NAME).map(winRow)), url: origin + '/?tab=report', button: 'เปิดหน้ารายงานผล' }));
}
// Plan-entry window message to every linked reporter: kind = open | close | closing
async function broadcastWindow(env, sys, links, k, c, kind, origin, send) {
  const range = c.from || c.to ? (c.from ? thDay(c.from) : '') + (c.to ? ' – ' + thDay(c.to) : '') : 'ไม่กำหนดวันปิด';
  const T = { open: [C.ok, 'เปิดให้กรอก' + WIN_NAME[k], 'ช่วงเวลา: ' + range], close: [C.mute, 'ปิดรับการกรอก' + WIN_NAME[k], 'ดูแผนได้อย่างเดียว · ลงผลรายเดือนได้ตามปกติ'], closing: [C.warn, 'อีก 3 วันปิดรับ' + WIN_NAME[k], 'ปิดรับวันที่ ' + (c.to ? thDay(c.to) : '')] }[kind];
  const msg = flex(T[1], bubble({ tone: T[0], tag: 'ช่วงกรอกแผน', eyebrow: 'กองประเมินผล', title: T[1], sub: T[2], body: [txt(kind === 'close' ? 'หากต้องแก้ไขแผนหลังปิดรับ ติดต่อ กองประเมินผล 343' : 'กรอกหรือแก้ไขแผนได้ที่หน้า ' + WIN_NAME[k] + ' ในระบบ', { wrap: true, color: C.ink })], url: origin }));
  for (const r of links) if (rolesOf(sys.users[r.id]).some(x => x.role === 'reporter')) await send(r, msg, 'win-' + k + '-' + kind + '-' + (c.from || '') + (c.to || ''));
}
// Called after กปม. saves a Config change: tell reporters when a window opens/closes or its dates change
async function onCfgChange(env, origin, before, ops) {
  if (!env.LINE_CHANNEL_TOKEN) return;
  const changed = ops.filter(op => op.s === 'cfg' && WIN_NAME[op.k] && op.v);
  if (!changed.length) return;
  const sys = await system(env), links = (await lineRows(env)).filter(r => r.user && sys.users[r.id]);
  const send = (r, msg, tag) => linePush(env, r.user, [msg], tag + '|' + r.id);
  for (const op of changed) {
    const a = before[op.k] || {}, b = op.v, wasOpen = a.open !== false, isOpen = b.open !== false;
    if (wasOpen !== isOpen || a.from !== b.from || a.to !== b.to) await broadcastWindow(env, sys, links, op.k, b, isOpen ? 'open' : 'close', origin, send);
  }
}
