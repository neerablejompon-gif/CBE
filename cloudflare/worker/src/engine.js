/**
 * รันตรรกะชุดเดียวกับ Apps Script (gen/core.js) บน Google Sheets/Drive API แบบ async
 *
 * โค้ดเดิมเรียก SpreadsheetApp/DriveApp แบบ synchronous จึงรันแบบ "ลองแล้วเติมข้อมูล":
 * 1. รันคำสั่งกับข้อมูลที่โหลดไว้ในหน่วยความจำ ถ้าต้องใช้ข้อมูลที่ยังไม่มี (โฟลเดอร์ ไฟล์ session) จะจดไว้เป็น miss
 * 2. ถ้ามี miss: ทิ้งผลรอบนั้น ดึงข้อมูลที่ขาดจาก API แล้วรันใหม่ (การเขียนทั้งหมดยังไม่ถูกส่งออกไป)
 * 3. ถ้าไม่มี miss: ส่งการเขียนออกไปตามลำดับ Drive → Sheets (เฉพาะแถวที่เปลี่ยน) → session
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { makeCore } from '../gen/core.js';
import { quoteTitle, FOLDER } from './google.js';

const MAX_ROUNDS = 12;
const enc = new TextEncoder();

class Miss extends Error {
  constructor(kind, key) { super('miss ' + kind + ' ' + key); this.kind = kind; this.key = key; }
}

/* ---------- Utilities ---------- */
function utf8(s) { return enc.encode(String(s)); }
function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray ? bytes.subarray(i, i + 0x8000) : bytes.slice(i, i + 0x8000));
  return btoa(s);
}
function b64decode(s) {
  const bin = atob(String(s).replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function sha256hex(s) { return Array.from(sha256(utf8(s)), b => (b + 0x100).toString(16).slice(1)).join(''); }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function trimRow(r) { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] === null || r[n - 1] === undefined)) n--; return r.slice(0, n); }
const rowKey = r => JSON.stringify(trimRow(r));

const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
  computeDigest: (alg, s) => Array.from(sha256(utf8(s))),
  getUuid: () => crypto.randomUUID(),
  base64Encode: b => b64encode(b instanceof Uint8Array ? b : Uint8Array.from(b, x => x & 255)),
  base64Decode: b64decode,
  newBlob: (bytes, type, name) => ({ getBytes: () => bytes, getContentType: () => type, getName: () => name }),
  formatDate: d => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10)
};

/* ---------- ชีทในหน่วยความจำ (พฤติกรรมเดียวกับ Apps Script ที่โค้ดใช้) ---------- */
class Sheet {
  constructor(base) { this.title = base.title; this.sheetId = base.sheetId; this.rowCount = base.rowCount; this.data = base.data.map(r => r.slice()); }
  getName() { return this.title; }
  setFrozenRows() {}
  getLastRow() { let n = this.data.length; while (n && this.data[n - 1].every(v => v === '')) n--; return n; }
  appendRow(row) { this.data.splice(this.getLastRow(), 0, row.slice()); }
  getDataRange() { const w = this.data.reduce((m, r) => Math.max(m, r.length), 0); return this.getRange(1, 1, Math.max(1, this.data.length), Math.max(1, w)); }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = sh.data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues(v) { for (let i = 0; i < nr; i++) { while (sh.data.length < r + i) sh.data.push([]); const row = sh.data[r - 1 + i]; for (let j = 0; j < nc; j++) { while (row.length < c - 1 + j) row.push(''); row[c - 1 + j] = v[i][j] === undefined || v[i][j] === null ? '' : v[i][j]; } } },
      clearContent() { for (let i = 0; i < nr; i++) { const row = sh.data[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) if (c - 1 + j < row.length) row[c - 1 + j] = ''; } }
    };
  }
}
class Book {
  constructor(base) { this.id = base.id; this.sheets = base.sheets.map(s => new Sheet(s)); this.dirty = false; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.title === n) || null; }
  insertSheet(n) { const s = new Sheet({ title: n, sheetId: null, rowCount: 0, data: [] }); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets.splice(this.sheets.indexOf(s), 1); }
}

/** คำนวณคำขอเขียนเฉพาะส่วนที่เปลี่ยนจาก base → work */
export function diffBook(base, work) {
  const requests = [], data = [], clears = [];
  for (const s of work.sheets) if (s.sheetId === null) requests.push({ addSheet: { properties: { title: s.title, gridProperties: { rowCount: Math.max(1000, s.data.length + 200), columnCount: 26 } } } });
  for (const b of base.sheets) if (!work.sheets.some(s => s.sheetId === b.sheetId)) requests.push({ deleteSheet: { sheetId: b.sheetId } });
  for (const s of work.sheets) {
    const b = s.sheetId === null ? null : base.sheets.find(x => x.sheetId === s.sheetId);
    const old = b ? b.data : [];
    const neu = s.data;
    if (b && neu.length > b.rowCount) requests.push({ appendDimension: { sheetId: s.sheetId, dimension: 'ROWS', length: neu.length - b.rowCount + 200 } });
    const n = Math.max(old.length, neu.length);
    let seg = null;
    const close = () => {
      if (!seg) return;
      const w = Math.max(1, ...seg.rows.map(r => r.length));
      data.push({ range: `${quoteTitle(s.title)}!A${seg.start}:${colName(w)}${seg.start + seg.rows.length - 1}`, values: seg.rows.map(r => r.concat(Array(w - r.length).fill(''))) });
      seg = null;
    };
    for (let i = 0; i < n; i++) {
      const o = old[i] || [], v = neu[i] || [];
      if (rowKey(o) === rowKey(v)) { close(); continue; }
      const tv = trimRow(v);
      if (!tv.length) { close(); clears.push(`${quoteTitle(s.title)}!A${i + 1}:${colName(Math.max(1, o.length))}${i + 1}`); continue; }
      const row = tv.concat(Array(Math.max(0, trimRow(o).length - tv.length)).fill(''));
      if (seg && seg.start + seg.rows.length === i + 1) seg.rows.push(row);
      else { close(); seg = { start: i + 1, rows: [row] }; }
    }
    close();
  }
  return { requests, data, clears };
}

/**
 * @param {object} o
 * @param {object} o.google   ผลจาก createGoogle()
 * @param {object} o.store    ที่เก็บ session: get(key) / put(key, value, ttlSec) / remove(key) แบบ async
 * @param {object} o.props    Script Properties เช่น DB_SPREADSHEET_ID, ADMIN_EMAIL
 * @param {function} [o.log]  รับข้อความ log (level, text)
 */
export function createEngine({ google, store, props, log = () => {} }) {
  async function resolve(state, misses) {
    const seen = new Set();
    const jobs = [];
    for (const m of misses) {
      const id = m.kind + ':' + m.key;
      if (seen.has(id)) continue;
      seen.add(id);
      jobs.push(m);
    }
    const one = async m => {
      const d = state.drive;
      if (m.kind === 'book') {
        try {
          const meta = await google.sheets.meta(m.key);
          if (!meta) { state.books.set(m.key, null); return; }
          const sheets = meta.sheets.map(s => s.properties);
          const values = await google.sheets.values(m.key, sheets.map(s => s.title));
          state.books.set(m.key, { id: m.key, sheets: sheets.map((s, i) => ({ title: s.title, sheetId: s.sheetId, rowCount: s.gridProperties.rowCount, data: values[i] })) });
        } catch (e) {
          if (e.status === 403) { state.books.set(m.key, null); return; }
          throw e;
        }
      } else if (m.kind === 'list') {
        const list = await google.drive.list(m.key).catch(e => { if (e.status === 403) return null; throw e; });
        if (!list) { d.lists.set(m.key, null); return; }
        list.forEach(f => d.meta.set(f.id, f));
        d.lists.set(m.key, list.map(f => f.id));
      } else if (m.kind === 'meta') {
        const f = await google.drive.meta(m.key).catch(e => { if (e.status === 403) return null; throw e; });
        d.meta.set(m.key, f && !f.trashed ? f : null);
      } else if (m.kind === 'content') {
        d.content.set(m.key, await google.drive.content(m.key, d.meta.get(m.key).mimeType));
      } else if (m.kind === 'ids') {
        d.pool.push(...await google.drive.generateIds(20));
      } else if (m.kind === 'cache') {
        state.cache.set(m.key, await store.get(m.key));
      }
    };
    // จำกัดจำนวนคำขอพร้อมกันเพื่อไม่ชนโควตา API
    for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(one));
  }

  function attempt(state, fn) {
    const ctx = { misses: [], driveFx: [], cacheFx: [], books: new Map(), pool: 0, meta: new Map(), lists: new Map(), cache: new Map(), logs: [], core: null };
    const miss = (kind, key) => { const e = new Miss(kind, key); ctx.misses.push(e); return e; };
    const d = state.drive;
    const metaOf = id => {
      if (ctx.meta.has(id)) return ctx.meta.get(id);
      if (!d.meta.has(id)) throw miss('meta', id);
      const f = d.meta.get(id);
      if (!f) throw new Error('ไม่พบไฟล์หรือโฟลเดอร์ใน Google Drive หรือ service account ไม่มีสิทธิ์: ' + id);
      return f;
    };
    const listOf = id => {
      if (ctx.lists.has(id)) return ctx.lists.get(id);
      if (!d.lists.has(id)) throw miss('list', id);
      const l = d.lists.get(id);
      if (!l) throw new Error('เปิดโฟลเดอร์ไม่ได้ หรือ service account ไม่มีสิทธิ์: ' + id);
      return l;
    };
    const newId = () => {
      if (ctx.pool >= d.pool.length) throw miss('ids', String(d.pool.length));
      return d.pool[ctx.pool++];
    };
    const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
    const add = (parent, f) => { const l = listOf(parent).slice(); l.push(f.id); ctx.lists.set(parent, l); ctx.meta.set(f.id, f); };

    function folder(id) {
      return {
        getId: () => id,
        getName: () => metaOf(id).name,
        getFolders: () => iter(listOf(id).map(metaOf).filter(f => f.mimeType === FOLDER).map(f => folder(f.id))),
        getFoldersByName: n => iter(listOf(id).map(metaOf).filter(f => f.mimeType === FOLDER && f.name === n).map(f => folder(f.id))),
        getFiles: () => iter(listOf(id).map(metaOf).filter(f => f.mimeType !== FOLDER).map(f => file(f.id))),
        createFolder(name) {
          const f = { id: newId(), name, mimeType: FOLDER, createdTime: new Date().toISOString() };
          add(id, f);
          ctx.lists.set(f.id, []);
          ctx.driveFx.push({ type: 'folder', id: f.id, name, parent: id });
          return folder(f.id);
        },
        createFile(blob) {
          const bytes = blob.getBytes();
          const f = { id: newId(), name: blob.getName(), mimeType: blob.getContentType(), size: String(bytes.length), createdTime: new Date().toISOString() };
          add(id, f);
          ctx.driveFx.push({ type: 'file', id: f.id, name: f.name, mime: f.mimeType, bytes, parent: id });
          return file(f.id);
        }
      };
    }
    function file(id) {
      return {
        getId: () => id,
        getName: () => metaOf(id).name,
        getSize: () => Number(metaOf(id).size) || 0,
        getMimeType: () => metaOf(id).mimeType,
        getDateCreated: () => new Date(metaOf(id).createdTime),
        getUrl: () => 'https://drive.google.com/file/d/' + id + '/view',
        getBlob() {
          const f = metaOf(id);
          if (!d.content.has(id)) throw miss('content', id);
          const google = String(f.mimeType).startsWith('application/vnd.google-apps');
          return Utilities.newBlob(d.content.get(id), google ? 'application/pdf' : f.mimeType, f.name);
        },
        setTrashed(v) { if (v) ctx.driveFx.push({ type: 'trash', id }); }
      };
    }

    const G = {
      SpreadsheetApp: {
        openById(id) {
          if (ctx.books.has(id)) return ctx.books.get(id);
          if (!state.books.has(id)) throw miss('book', id);
          const base = state.books.get(id);
          if (!base && id === props.DB_SPREADSHEET_ID) throw new Error('เปิดสเปรดชีตฐานข้อมูลไม่ได้ ตรวจ DB_SPREADSHEET_ID และการแชร์ให้ ' + google.email);
          if (!base) throw new ctx.core.UserError('เปิดสเปรดชีต ' + id + ' ไม่ได้ ตรวจว่าแชร์ให้ service account (' + google.email + ') แล้ว');
          const b = new Book(base);
          ctx.books.set(id, b);
          return b;
        },
        create() { throw new Error('สร้างสเปรดชีตใหม่ด้วย service account ไม่ได้ ให้สร้างเองแล้วตั้งค่า DB_SPREADSHEET_ID'); }
      },
      DriveApp: { getFolderById: id => { metaOf(id); return folder(id); }, getFileById: id => { metaOf(id); return file(id); } },
      CacheService: {
        getScriptCache: () => ({
          get(k) {
            if (ctx.cache.has(k)) return ctx.cache.get(k);
            if (!state.cache.has(k)) throw miss('cache', k);
            return state.cache.get(k);
          },
          put(k, v, ttl) { ctx.cache.set(k, String(v)); ctx.cacheFx.push({ k, v: String(v), ttl: ttl || 600 }); },
          remove(k) { ctx.cache.set(k, null); ctx.cacheFx.push({ k, v: null }); }
        })
      },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props[k] === undefined || props[k] === '' ? null : props[k]), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      Utilities,
      HtmlService: {},
      console: { log: (...a) => ctx.logs.push(['info', a.join(' ')]), warn: (...a) => ctx.logs.push(['warn', a.join(' ')]), error: (...a) => ctx.logs.push(['error', a.join(' ')]) }
    };
    ctx.core = makeCore(G);
    try {
      ctx.result = fn(ctx.core);
    } catch (e) {
      if (!ctx.misses.length) throw e;
    }
    return ctx;
  }

  async function commit(state, ctx) {
    for (const fx of ctx.driveFx) {
      if (fx.type === 'folder') await google.drive.createFolder(fx.id, fx.name, fx.parent);
      else if (fx.type === 'file') await google.drive.upload(fx.id, fx.name, fx.mime, fx.bytes instanceof Uint8Array ? fx.bytes : Uint8Array.from(fx.bytes), fx.parent);
      else if (fx.type === 'trash') await google.drive.trash(fx.id).catch(e => log('warn', 'trash ' + fx.id + ': ' + e.message));
    }
    for (const [id, work] of ctx.books) {
      const { requests, data, clears } = diffBook(state.books.get(id), work);
      if (requests.length) await google.sheets.batchUpdate(id, requests);
      if (clears.length) await google.sheets.clearValues(id, clears);
      if (data.length) await google.sheets.writeValues(id, data);
    }
    for (const c of ctx.cacheFx) {
      if (c.v === null) await store.remove(c.k);
      else await store.put(c.k, c.v, c.ttl);
    }
  }

  async function run(fn, prefetch) {
    const state = { books: new Map(), cache: new Map(), drive: { meta: new Map(), lists: new Map(), content: new Map(), pool: [] } };
    if (prefetch.length) await resolve(state, prefetch);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const ctx = attempt(state, fn);
      if (ctx.misses.length) { await resolve(state, ctx.misses); continue; }
      await commit(state, ctx);
      ctx.logs.forEach(([lv, t]) => log(lv, t));
      return ctx.result;
    }
    throw new Error('ข้อมูลที่ต้องโหลดซับซ้อนเกินไป (เกิน ' + MAX_ROUNDS + ' รอบ)');
  }

  const dbMiss = () => props.DB_SPREADSHEET_ID ? [{ kind: 'book', key: props.DB_SPREADSHEET_ID }] : [];

  return {
    /** เทียบเท่า api(token, action, payload) ของ Apps Script */
    api(token, action, payload) {
      const pre = dbMiss();
      if (typeof token === 'string' && token && token.length <= 100) pre.push({ kind: 'cache', key: 'sess:' + sha256hex(token) });
      return run(core => core.api(token, action, payload), pre);
    },
    /** ติดตั้งตาราง โครงสร้าง และแอดมินคนแรก (คืนข้อความ log ซึ่งมีรหัสชั่วคราว ใช้จากเครื่องผู้ดูแลเท่านั้น) */
    setup() { return run(core => core.setup(), dbMiss()); },
    resetPassword() { return run(core => core.resetPasswordFromEditor(), dbMiss()); }
  };
}
