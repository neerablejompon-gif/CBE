// เรียก Google Sheets API และ Drive API ด้วย service account (JWT → OAuth access token) ใช้ได้ทั้งใน Worker และ Node 20+
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const ALL = 'supportsAllDrives=true';
const FOLDER = 'application/vnd.google-apps.folder';

export class GoogleError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const enc = new TextEncoder();

export function parseServiceAccount(json) {
  let sa;
  try { sa = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ไม่ใช่ JSON ที่ถูกต้อง'); }
  if (!sa || !sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ต้องมี client_email และ private_key');
  return sa;
}

export function createGoogle(saJson, fetchImpl = fetch) {
  const sa = parseServiceAccount(saJson);
  let token = null, tokenExp = 0, keyP = null;

  function key() {
    if (!keyP) {
      const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
      const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
      keyP = crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    }
    return keyP;
  }

  async function accessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (token && now < tokenExp - 60) return token;
    const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claim = b64url(enc.encode(JSON.stringify({ iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key(), enc.encode(head + '.' + claim)));
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64url(sig)
    });
    if (!res.ok) throw new GoogleError(res.status, 'ขอ access token จาก Google ไม่สำเร็จ (' + res.status + ')');
    const j = await res.json();
    token = j.access_token; tokenExp = now + (j.expires_in || 3600);
    return token;
  }

  /** เรียก API พร้อมลองใหม่เมื่อเจอ 429/5xx; คืน null เมื่อ 404 */
  async function call(method, url, { json, body, headers = {}, raw = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const h = { Authorization: 'Bearer ' + await accessToken(), ...headers };
      if (json !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetchImpl(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body });
      if (res.status === 404) return null;
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json()).error.message; } catch (e) { /* ไม่มีรายละเอียด */ }
        throw new GoogleError(res.status, `Google API ${method} ${url.split('?')[0]} ตอบ ${res.status}: ${msg}`);
      }
      if (raw) return new Uint8Array(await res.arrayBuffer());
      return res.status === 204 ? {} : res.json();
    }
  }
  const q = s => encodeURIComponent(s);

  const sheets = {
    async meta(id) {
      return call('GET', SHEETS + q(id) + '?fields=' + q('spreadsheetId,properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'));
    },
    async values(id, titles) {
      if (!titles.length) return [];
      const r = await call('GET', SHEETS + q(id) + '/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS&' + titles.map(t => 'ranges=' + q(quoteTitle(t))).join('&'));
      return (r.valueRanges || []).map(v => v.values || []);
    },
    batchUpdate: (id, requests) => call('POST', SHEETS + q(id) + ':batchUpdate', { json: { requests } }),
    writeValues: (id, data) => call('POST', SHEETS + q(id) + '/values:batchUpdate', { json: { valueInputOption: 'RAW', data } }),
    clearValues: (id, ranges) => call('POST', SHEETS + q(id) + '/values:batchClear', { json: { ranges } })
  };

  const FIELDS = 'id,name,mimeType,size,createdTime,trashed';
  const drive = {
    meta: id => call('GET', `${DRIVE}/${q(id)}?${ALL}&fields=${q(FIELDS)}`),
    async list(folderId) {
      const out = [];
      let page = '';
      do {
        const r = await call('GET', `${DRIVE}?${ALL}&includeItemsFromAllDrives=true&pageSize=1000&fields=${q('nextPageToken,files(' + FIELDS + ')')}&q=${q(`'${folderId.replace(/'/g, '')}' in parents and trashed=false`)}${page ? '&pageToken=' + q(page) : ''}`);
        if (!r) return null;
        out.push(...r.files);
        page = r.nextPageToken || '';
      } while (page);
      return out;
    },
    content(id, mimeType) {
      if (String(mimeType).startsWith('application/vnd.google-apps')) return call('GET', `${DRIVE}/${q(id)}/export?mimeType=application%2Fpdf`, { raw: true });
      return call('GET', `${DRIVE}/${q(id)}?${ALL}&alt=media`, { raw: true });
    },
    async generateIds(n) { return (await call('GET', `${DRIVE}/generateIds?count=${n}&space=drive&type=files`)).ids; },
    createFolder: (id, name, parent) => call('POST', `${DRIVE}?${ALL}&fields=id`, { json: { id, name, mimeType: FOLDER, parents: [parent] } }),
    upload(id, name, mimeType, bytes, parent) {
      const boundary = 'cbe' + crypto.randomUUID().replace(/-/g, '');
      const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ id, name, mimeType, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
      const tail = enc.encode(`\r\n--${boundary}--`);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
      return call('POST', `${UPLOAD}?uploadType=multipart&${ALL}&fields=id`, { body, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary } });
    },
    trash: id => call('PATCH', `${DRIVE}/${q(id)}?${ALL}&fields=id`, { json: { trashed: true } })
  };

  return { sheets, drive, email: sa.client_email };
}

export function quoteTitle(t) { return "'" + String(t).replace(/'/g, "''") + "'"; }
export { FOLDER };
