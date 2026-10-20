/**
 * ชั้นเข้าถึงข้อมูลบน Google Sheets: 1 ชีท = 1 ตาราง แถวที่ 1 เป็นหัวคอลัมน์
 * อ่านทั้งตารางครั้งเดียวต่อคำขอ (แคชในหน่วยความจำ) และเขียนกลับเฉพาะแถวที่เปลี่ยน
 */
var Db = (function () {
  var cache = {};

  function ss_() {
    var id = prop_('DB_SPREADSHEET_ID');
    if (!id) throw new Error('ยังไม่ได้ตั้งค่า DB_SPREADSHEET_ID (รัน setup ก่อน)');
    return SpreadsheetApp.openById(id);
  }

  function sheet_(name) {
    var sh = ss_().getSheetByName(name);
    if (!sh) throw new Error('ไม่พบตาราง ' + name);
    return sh;
  }

  function cols_(name) {
    var c = TABLES[name];
    if (!c) throw new Error('ไม่รู้จักตาราง ' + name);
    return c;
  }

  function toObj_(cols, row) {
    var o = {};
    for (var i = 0; i < cols.length; i++) o[cols[i]] = row[i] === undefined ? '' : row[i];
    return o;
  }

  function toRow_(cols, o) {
    return cols.map(function (c) {
      var v = o[c];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
      return v;
    });
  }

  /** คืนอาร์เรย์ของอ็อบเจกต์ พร้อม _row (เลขแถวในชีท) */
  function all(name) {
    if (cache[name]) return cache[name];
    var cols = cols_(name);
    var sh = sheet_(name);
    var n = sh.getLastRow();
    var rows = n > 1 ? sh.getRange(2, 1, n - 1, cols.length).getValues() : [];
    cache[name] = rows.map(function (r, i) {
      var o = toObj_(cols, r);
      o._row = i + 2;
      return o;
    }).filter(function (o) { return o[cols[0]] !== ''; });
    return cache[name];
  }

  function find(name, pred) {
    var list = all(name);
    for (var i = 0; i < list.length; i++) if (pred(list[i])) return list[i];
    return null;
  }

  function where(name, pred) {
    return all(name).filter(pred);
  }

  function insert(name, o) {
    var cols = cols_(name);
    var sh = sheet_(name);
    sh.appendRow(toRow_(cols, o));
    var copy = Object.assign({}, o);
    copy._row = sh.getLastRow();
    if (cache[name]) cache[name].push(copy);
    return copy;
  }

  /** เพิ่มหลายแถวในครั้งเดียว (ใช้ตอนนำเข้า) */
  function insertMany(name, list) {
    if (!list.length) return;
    var cols = cols_(name);
    var sh = sheet_(name);
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, list.length, cols.length).setValues(list.map(function (o) { return toRow_(cols, o); }));
    delete cache[name];
  }

  function update(name, o, patch) {
    if (!o || !o._row) throw new Error('ไม่พบแถวที่จะแก้ไข');
    var cols = cols_(name);
    Object.keys(patch).forEach(function (k) {
      if (cols.indexOf(k) < 0) throw new Error('ไม่มีคอลัมน์ ' + k + ' ในตาราง ' + name);
      o[k] = patch[k];
    });
    sheet_(name).getRange(o._row, 1, 1, cols.length).setValues([toRow_(cols, o)]);
    return o;
  }

  /** ลบทุกแถวที่ตรงเงื่อนไข (เขียนตารางใหม่ทั้งตาราง) */
  function removeWhere(name, pred) {
    var cols = cols_(name);
    var keep = all(name).filter(function (o) { return !pred(o); });
    var sh = sheet_(name);
    var n = sh.getLastRow();
    if (n > 1) sh.getRange(2, 1, n - 1, cols.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, cols.length).setValues(keep.map(function (o) { return toRow_(cols, o); }));
    delete cache[name];
  }

  function reset() { cache = {}; }

  return { all: all, find: find, where: where, insert: insert, insertMany: insertMany, update: update, removeWhere: removeWhere, reset: reset, ss: ss_ };
})();

function json_(v, fallback) {
  if (v === '' || v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

function bool_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(String(v).replace(/[,%\s]/g, ''));
  return isNaN(n) ? null : n;
}

function nowIso_() {
  return new Date().toISOString();
}

function id_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}
