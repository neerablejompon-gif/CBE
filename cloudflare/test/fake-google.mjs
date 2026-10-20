// Google Sheets/Drive API จำลองในหน่วยความจำ (เฉพาะ endpoint ที่ worker ใช้) สำหรับทดสอบโดยไม่ต้องต่อ Google จริง
export async function fakeServiceAccount() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n');
  return JSON.stringify({ type: 'service_account', client_email: 'cbe@test.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` });
}

const FOLDER = 'application/vnd.google-apps.folder';
const resp = (status, body) => new Response(body === undefined ? null : body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createFakeGoogle() {
  const books = new Map();   // id -> { sheets: [{sheetId, title, rowCount, data}] }
  const files = new Map();   // id -> { id, name, mimeType, parents, bytes, createdTime, trashed }
  const calls = [];
  let seq = 100;
  const deny = new Set();    // id ที่ service account ไม่มีสิทธิ์

  function parseRange(r) {
    const m = /^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/.exec(r);
    if (!m) throw new Error('bad range ' + r);
    const col = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    return { title: m[1].replace(/''/g, "'"), c1: m[2] ? col(m[2]) : 1, r1: m[3] ? +m[3] : 1, c2: m[4] ? col(m[4]) : null, r2: m[5] ? +m[5] : null };
  }
  function sheetOf(b, title) { const s = b.sheets.find(x => x.title === title); if (!s) throw Object.assign(new Error('no sheet ' + title), { status: 400 }); return s; }

  async function fetchImpl(input, init = {}) {
    const url = new URL(input);
    const method = init.method || 'GET';
    const p = url.pathname;
    calls.push(method + ' ' + url.host + p);
    try {
      if (url.host === 'oauth2.googleapis.com') return resp(200, { access_token: 'tok', expires_in: 3600 });
      if (url.host === 'sheets.googleapis.com') {
        const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(p);
        const id = decodeURIComponent(m[1]), rest = m[2];
        if (deny.has(id)) return resp(403, { error: { message: 'denied' } });
        const b = books.get(id);
        if (!b) return resp(404, { error: { message: 'not found' } });
        if (rest === '' && method === 'GET') return resp(200, { spreadsheetId: id, sheets: b.sheets.map(s => ({ properties: { sheetId: s.sheetId, title: s.title, gridProperties: { rowCount: s.rowCount, columnCount: 26 } } })) });
        if (rest === '/values:batchGet') {
          return resp(200, { valueRanges: url.searchParams.getAll('ranges').map(r => {
            const s = sheetOf(b, parseRange(r).title);
            let n = s.data.length; while (n && !s.data[n - 1].some(v => v !== '')) n--;
            return { values: s.data.slice(0, n).map(row => { const x = row.slice(); while (x.length && x[x.length - 1] === '') x.pop(); return x; }) };
          }) });
        }
        const body = JSON.parse(init.body);
        if (rest === ':batchUpdate') {
          for (const q of body.requests) {
            if (q.addSheet) { if (b.sheets.some(s => s.title === q.addSheet.properties.title)) return resp(400, { error: { message: 'dup sheet' } }); b.sheets.push({ sheetId: seq++, title: q.addSheet.properties.title, rowCount: q.addSheet.properties.gridProperties.rowCount, data: [] }); }
            else if (q.deleteSheet) { if (b.sheets.length < 2) return resp(400, { error: { message: 'last sheet' } }); b.sheets = b.sheets.filter(s => s.sheetId !== q.deleteSheet.sheetId); }
            else if (q.appendDimension) b.sheets.find(s => s.sheetId === q.appendDimension.sheetId).rowCount += q.appendDimension.length;
            else return resp(400, { error: { message: 'unsupported request' } });
          }
          return resp(200, {});
        }
        if (rest === '/values:batchUpdate') {
          if (body.valueInputOption !== 'RAW') return resp(400, { error: { message: 'expect RAW' } });
          for (const d of body.data) {
            const r = parseRange(d.range), s = sheetOf(b, r.title);
            if (r.r1 + d.values.length - 1 > s.rowCount) return resp(400, { error: { message: 'exceeds grid limits' } });
            d.values.forEach((row, i) => { const t = s.data[r.r1 - 1 + i] || (s.data[r.r1 - 1 + i] = []); while (s.data.length < r.r1 + i) s.data.push([]); row.forEach((v, j) => { while (t.length < r.c1 - 1 + j) t.push(''); t[r.c1 - 1 + j] = v; }); });
            for (let i = 0; i < s.data.length; i++) if (!s.data[i]) s.data[i] = [];
          }
          return resp(200, {});
        }
        if (rest === '/values:batchClear') {
          for (const rg of body.ranges) {
            const r = parseRange(rg), s = sheetOf(b, r.title);
            for (let i = r.r1; i <= (r.r2 || s.data.length); i++) { const row = s.data[i - 1]; if (row) for (let j = r.c1; j <= (r.c2 || row.length); j++) if (j - 1 < row.length) row[j - 1] = ''; }
          }
          return resp(200, {});
        }
      }
      if (url.host === 'www.googleapis.com') {
        const up = p.startsWith('/upload/');
        const fm = /^\/(?:upload\/)?drive\/v3\/files(?:\/([^/]+))?(\/export)?$/.exec(p);
        const id = fm[1] && decodeURIComponent(fm[1]);
        if (id === 'generateIds') return resp(200, { ids: Array.from({ length: +url.searchParams.get('count') }, () => 'gen' + (seq++)) });
        if (id && deny.has(id)) return resp(403, { error: { message: 'denied' } });
        const meta = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.mimeType === FOLDER || f.mimeType.startsWith('application/vnd.google-apps') ? undefined : String(f.bytes.length), createdTime: f.createdTime, trashed: !!f.trashed });
        if (!id && method === 'GET') {
          const q = /'([^']+)' in parents/.exec(url.searchParams.get('q'))[1];
          if (deny.has(q)) return resp(403, { error: { message: 'denied' } });
          if (!files.has(q)) return resp(404, { error: { message: 'not found' } });
          return resp(200, { files: [...files.values()].filter(f => f.parents[0] === q && !f.trashed).map(meta) });
        }
        if (!id && method === 'POST') {
          let md, bytes = new Uint8Array();
          if (up) {
            const raw = new Uint8Array(init.body), txt = Buffer.from(raw).toString('latin1');
            const boundary = /boundary=(\S+)/.exec(init.headers['Content-Type'])[1];
            const parts = txt.split('--' + boundary);
            md = JSON.parse(Buffer.from(parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, ''), 'latin1').toString('utf8'));
            const p2 = parts[2], start = txt.indexOf(p2) + p2.indexOf('\r\n\r\n') + 4, end = txt.indexOf(p2) + p2.length - 2;
            bytes = raw.slice(start, end);
          } else md = JSON.parse(init.body);
          if (!files.has(md.parents[0])) return resp(404, { error: { message: 'parent not found' } });
          if (files.has(md.id)) return resp(409, { error: { message: 'exists' } });
          files.set(md.id, { id: md.id, name: md.name, mimeType: md.mimeType, parents: md.parents, bytes, createdTime: new Date().toISOString() });
          return resp(200, { id: md.id });
        }
        const f = files.get(id);
        if (!f) return resp(404, { error: { message: 'not found' } });
        if (method === 'PATCH') { Object.assign(f, JSON.parse(init.body)); return resp(200, { id }); }
        if (fm[2]) return resp(200, new TextEncoder().encode('%PDF export of ' + f.name));
        if (url.searchParams.get('alt') === 'media') return resp(200, f.bytes);
        return resp(200, meta(f));
      }
      return resp(400, { error: { message: 'unknown endpoint ' + p } });
    } catch (e) {
      return resp(e.status || 500, { error: { message: e.message } });
    }
  }

  return {
    fetch: fetchImpl, books, files, calls, deny,
    addBook(id, sheets) { books.set(id, { sheets: Object.entries(sheets).map(([title, data]) => ({ sheetId: seq++, title, rowCount: Math.max(1000, data.length), data: data.map(r => r.slice()) })) }); },
    addFolder(id, name, parent) { files.set(id, { id, name, mimeType: FOLDER, parents: parent ? [parent] : [], bytes: new Uint8Array(), createdTime: new Date().toISOString() }); return id; },
    addFile(name, parent, bytes, mimeType = 'application/pdf') { const id = 'f' + (seq++); files.set(id, { id, name, mimeType, parents: [parent], bytes, createdTime: new Date().toISOString() }); return id; }
  };
}
