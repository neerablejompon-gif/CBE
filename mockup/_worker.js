// Cloudflare Pages worker (advanced mode) for the CBE report system.
// Serves the static app plus an API that reads and writes Google Sheets with a Google Cloud service account.
// Users sign in with their 4-digit employee ID; the password is "cbe@" + ID (organisation's choice). Roles come from the "users" tab.
//
// Pages → Settings → Variables and Secrets:
//   GOOGLE_SA        (secret) service account JSON key
//   SESSION_SECRET   (secret) 32+ random characters for signing the session cookie
//   SYSTEM_SHEET_ID  spreadsheet with tabs users, forms, state, log (see mockup/DEPLOY.md)
//   FILES_FOLDER_ID  Shared Drive folder for evidence files (optional)
//   CUR_FY           current fiscal year (default 2570)

const IND_PARTS = { CG: ['CG'], SP: ['SP'], RM: ['RM'], SCM: ['SM', 'CM'], DT: ['DT'], HCM: ['HCM'], KMIM: ['KM', 'IM'], IA: ['IA'] };
const STORES = ['patch', 'wf', 'wfnote', 'tri', 'trinote', 'unlock'];
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
  async fetch(req, env) {
    const path = new URL(req.url).pathname, fy = +(env.CUR_FY || 2570);
    try {
      if (path.startsWith('/tools/') || path.startsWith('/.test/')) return new Response('Not found', { status: 404 });
      if (path === `/data-${fy}.js`) {
        try { return js(await boot(req, env, fy)); } catch (e) { if (!e.status) throw e; return js('window.CBE_API=' + JSON.stringify(e.status === 401 ? { login: true, error: '' } : { error: e.message }) + ';'); }
      }
      if (path === '/data.js') { try { return js(await archive(req, env)); } catch (e) { if (e.status !== 401) throw e; return js(''); } }
      if (path === '/api/login' && req.method === 'POST') return await login(req, env);
      if (path === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': SESSION + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
      if (path === '/api/save' && req.method === 'POST') return json(await save(req, env, fy));
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
// Months before this one are closed; last month stays open until the 10th, its reporting deadline
function openFrom() { const d = bkk(), m = fyMonth(d); return d.getUTCDate() <= 10 ? Math.max(0, m - 1) : m; }

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
  return body.id;
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
  const p = b64url(enc.encode(JSON.stringify({ id, exp: now + SESSION_HOURS * 3600e3 })));
  const token = p + '.' + b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(p)));
  await appendRows(env, env.SYSTEM_SHEET_ID, 'log!A:D', [[stamp(), id, label(u), 'เข้าสู่ระบบ']]);
  return json({ ok: true }, 200, { 'set-cookie': `${SESSION}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}` });
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
async function g(env, url, { json: body, headers, ...init } = {}) {
  const r = await fetch(url, { ...init, body: body ? JSON.stringify(body) : init.body,
    headers: { authorization: 'Bearer ' + await gToken(env), ...(body ? { 'content-type': 'application/json' } : {}), ...headers } });
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
    users.forEach(r => { const id = str(r[0]); if (id) byId[id] = { id, role: str(r[1]), ind: str(r[2]) || null, part: str(r[3]) || null, name: str(r[4]) }; });
    return { users: byId, forms: forms.filter(r => str(r[1]) && str(r[2])).map(r => ({ fy: +r[0] || 0, code: str(r[1]), id: str(r[2]) })) };
  });
}
function checkUser(u) {
  const ok = u.role === 'audit' || u.role === 'exec' || (u.role === 'reporter' && IND_PARTS[u.ind] && (!u.part || IND_PARTS[u.ind].includes(u.part)));
  if (!ok) fail(403, `รหัสพนักงาน ${u.id} ยังไม่ได้กำหนดสิทธิ์ในระบบ ติดต่อ กปม.`);
}
// A user removed from the "users" tab loses access within a minute (system() cache), even with a valid cookie
async function me(req, env) {
  const id = await sessionId(req, env), u = (await system(env)).users[id];
  if (!u) fail(401, 'บัญชีนี้ถูกยกเลิกแล้ว');
  checkUser(u);
  return u;
}
const label = u => u.name || (u.role === 'audit' ? 'กปม.' : u.role === 'exec' ? 'ผู้บริหาร' : 'ผู้รายงาน ' + (u.part || u.ind));
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
  return { f, L: s && s.levels.find(x => x.level === +lv) };
}

/* ---------- routes ---------- */
// The app loads this as a plain script: current-year forms + who is signed in + saved state
async function boot(req, env, fy) {
  const u = await me(req, env), codes = u.role === 'reporter' ? IND_PARTS[u.ind] : Object.values(IND_PARTS).flat();
  const [forms, { st }, log] = await Promise.all([Promise.all(codes.map(c => form(env, fy, c))), loadState(env, fy),
    getRanges(env, env.SYSTEM_SHEET_ID, ['log!A2:D']).then(([rows]) => rows.slice(-60).reverse().map(r => ({ t: str(r[0]), who: str(r[2]), what: str(r[3]) })))]);
  const data = {};
  codes.forEach((c, i) => { if (forms[i]) data[c] = forms[i].data; });
  const api = { me: { role: u.role, ind: u.ind, part: u.part, name: u.name, id: u.id }, state: stateFor(u, st), log, openFrom: openFrom() };
  return `window.CBE_FORMS_${fy}=${JSON.stringify(data, hideRows)};\nwindow.CBE_API=${JSON.stringify(api)};`;
}
// FY2569 (closed year) and the indicator seed: the data.js built by tools/forms-to-json.ps1, kept as a Drive file
async function archive(req, env) {
  await me(req, env);
  const f = (await system(env)).forms.find(x => x.code === 'ARCHIVE');
  return f ? cached('archive:' + f.id, 3600e3, async () => (await g(env, `${DRIVE}${f.id}?alt=media&supportsAllDrives=true`)).text()) : '';
}

const own = (u, key) => { const [ind, part] = key.split('|'); return u.role === 'reporter' && ind === u.ind && (!u.part || part === u.part); };
const editable = (st, ind) => ['draft', 'returned'].includes(st.wf[ind] || 'draft');
async function check(env, fy, u, st, op) {
  if (!STORES.includes(op.s) || typeof op.k !== 'string' || !op.k || op.k.length > 200) fail(400, 'คำขอไม่ถูกต้อง');
  if (op.v != null && JSON.stringify(op.v).length > 45000) fail(413, 'ข้อความยาวเกินไป');
  const audit = u.role === 'audit', reporter = u.role === 'reporter';
  if (op.s === 'patch') {
    if (!own(u, op.k)) fail(403, 'แก้ไขได้เฉพาะส่วนที่รับผิดชอบ');
    if (!editable(st, u.ind)) fail(409, 'รายงานนี้ส่งตรวจแล้ว แก้ไขได้เมื่อ กปม. ส่งกลับ');
    if (op.v && Array.isArray(op.v.res) && !op.k.endsWith('|self') && !st.unlock[op.k]) {
      const old = st.patch[op.k] && st.patch[op.k].res || ((await findLevel(env, fy, op.k)).L || { steps: [] }).steps.map(x => x.result), from = openFrom();
      op.v.res.forEach((r, si) => { for (let i = 0; i < from; i++) if ((+(r || [])[i] || 0) !== (+((old[si] || [])[i]) || 0)) fail(409, `ผลเดือน ${MONTHS[i]} ปิดรอบแล้ว ขอให้ กปม. ปลดล็อกเพื่อแก้ย้อนหลัง`); });
    }
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
    if (v.res && v.res[0] && L.steps.length) d.push({ range: `${FORM_TAB}!G${L.row + 1}:R${L.row + 1}`, values: [v.res[0].map(x => +x || '')] });
    if (typeof v.narrative === 'string') d.push({ range: `${FORM_TAB}!V${L.row}`, values: [[v.narrative]] });
    (v.mr || []).forEach((x, i) => { if (L.mrRows[i]) d.push({ range: `${FORM_TAB}!X${L.mrRows[i]}:Y${L.mrRows[i]}`, values: [[x[0] ? '✓' : '', x[1] || '']] }); });
  }
  await Promise.all(Object.keys(byForm).map(id => putRanges(env, id, byForm[id])));
}
async function save(req, env, fy) {
  sameOrigin(req);
  const u = await me(req, env), body = await req.json().catch(() => ({}));
  if (+body.fy !== fy) fail(409, 'ปีบัญชีนี้ปิดรอบแล้ว แก้ไขไม่ได้');
  if (u.role === 'exec') fail(403, 'ผู้บริหารดูได้อย่างเดียว');
  const byKey = {};
  (Array.isArray(body.ops) ? body.ops : []).slice(0, 300).forEach(op => { if (op) byKey[op.s + '\n' + op.k] = { s: op.s, k: op.k, v: op.v == null ? null : op.v }; });
  const ops = Object.values(byKey), logs = (Array.isArray(body.log) ? body.log : []).slice(0, 30).map(s => String(s).slice(0, 500));
  const { st, at } = await loadState(env, fy);
  for (const op of ops) await check(env, fy, u, st, op); // all or nothing
  // Submitting closes every past-month unlock of that indicator
  ops.filter(op => op.s === 'wf' && op.v === 'submitted').forEach(op => Object.keys(st.unlock).forEach(k => {
    if (k.startsWith(op.k + '|') && !byKey['unlock\n' + k]) ops.push(byKey['unlock\n' + k] = { s: 'unlock', k, v: null });
  }));
  const when = stamp(), updates = [], appends = [];
  ops.forEach(op => {
    const vals = [fy, op.s, op.k, op.v == null ? '' : JSON.stringify(op.v), u.id, when], row = at[op.s + '\n' + op.k];
    if (row) updates.push({ range: `state!A${row}:F${row}`, values: [vals] }); else if (op.v != null) appends.push(vals);
  });
  await putRanges(env, env.SYSTEM_SHEET_ID, updates);
  await appendRows(env, env.SYSTEM_SHEET_ID, 'state!A:F', appends);
  await appendRows(env, env.SYSTEM_SHEET_ID, 'log!A:D', logs.map(w => [when, u.id, label(u), w]));
  let mirrored = true;
  try { await mirror(env, fy, ops.filter(op => op.s === 'patch' && op.v && !op.k.endsWith('|self'))); } catch (e) { mirrored = false; console.error('mirror', e.stack || e); }
  return { ok: true, at: when, mirrored };
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
  const b = 'cbe' + crypto.randomUUID(), meta = { name, parents: [env.FILES_FOLDER_ID], mimeType: FILE_TYPES[ext], description: key + ' · ' + u.id };
  const r = await g(env, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', { method: 'POST',
    headers: { 'content-type': 'multipart/related; boundary=' + b },
    body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${FILE_TYPES[ext]}\r\n\r\n`, data, `\r\n--${b}--`]) });
  const { id } = await r.json();
  return { id, url: '/api/file/' + id };
}
// Files are served only to people who can see the indicator that references them
async function download(req, env, fy, id) {
  const u = await me(req, env), { st } = await loadState(env, fy);
  let file = null, key = null;
  Object.keys(st.patch).some(k => (st.patch[k].mr || []).some(m => (m[2] || []).some(f => { if (f && f.id === id) { file = f; key = k; } return file; })));
  if (!file || (u.role === 'reporter' && key.split('|')[0] !== u.ind)) fail(404, 'ไม่พบไฟล์');
  const r = await g(env, `${DRIVE}${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`).catch(e => { if (e.google === 404) fail(404, 'ไฟล์ถูกลบออกจาก Drive แล้ว'); throw e; });
  const ext = extOf(file.name);
  return new Response(r.body, { headers: { 'content-type': INLINE.includes(ext) ? FILE_TYPES[ext] : 'application/octet-stream', 'x-content-type-options': 'nosniff',
    'content-disposition': (INLINE.includes(ext) ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(file.name), 'cache-control': 'private, no-store' } });
}
