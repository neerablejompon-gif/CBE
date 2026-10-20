/* จำลองบริการของ Google Apps Script ในหน่วยความจำ ใช้ได้ทั้งใน Node และเบราว์เซอร์ (หน้า dev/harness) */
(function (G) {
  function sha256(bytes) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, m = bytes.slice();
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    var bits = l * 8;
    for (var i = 7; i >= 0; i--) m.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    var w = new Array(64);
    for (var o = 0; o < m.length; o += 64) {
      for (i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        var s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h].map(function (x) { return x | 0; });
    }
    var out = [];
    H.forEach(function (x) { for (var k = 3; k >= 0; k--) { var v = (x >>> (k * 8)) & 255; out.push(v > 127 ? v - 256 : v); } });
    return out;
  }
  function utf8(s) { var u = unescape(encodeURIComponent(s)); var a = []; for (var i = 0; i < u.length; i++) a.push(u.charCodeAt(i)); return a; }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64enc(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var n = ((bytes[i] & 255) << 16) | (((bytes[i + 1] || 0) & 255) << 8) | ((bytes[i + 2] || 0) & 255);
      s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
    }
    return s;
  }
  function b64dec(s) {
    s = s.replace(/[^A-Za-z0-9+/]/g, '');
    var out = [], buf = 0, bitsN = 0;
    for (var i = 0; i < s.length; i++) { buf = (buf << 6) | B64.indexOf(s[i]); bitsN += 6; if (bitsN >= 8) { bitsN -= 8; out.push((buf >> bitsN) & 255); } }
    return out;
  }
  var seq = 0;
  function uuid() { seq++; var r = ''; for (var i = 0; i < 32; i++) r += Math.floor(Math.random() * 16).toString(16); return r.slice(0, 8) + '-' + r.slice(8, 12) + '-' + r.slice(12, 16) + '-' + r.slice(16, 20) + '-' + r.slice(20); }

  /* ---------- Sheets ---------- */
  function Sheet(name, data) { this.name = name; this.data = data || []; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () { var n = this.data.length; while (n && this.data[n - 1].every(function (v) { return v === ''; })) n--; return n; };
  Sheet.prototype.setFrozenRows = function () {};
  Sheet.prototype.appendRow = function (row) { this.data.splice(this.getLastRow(), 0, row.slice()); };
  Sheet.prototype.getDataRange = function () { var w = this.data.reduce(function (m, r) { return Math.max(m, r.length); }, 0); return this.getRange(1, 1, Math.max(1, this.data.length), Math.max(1, w)); };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    var sh = this; nr = nr || 1; nc = nc || 1;
    return {
      getValues: function () { var out = []; for (var i = 0; i < nr; i++) { var row = sh.data[r - 1 + i] || []; var o = []; for (var j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues: function (v) { for (var i = 0; i < nr; i++) { while (sh.data.length < r + i) sh.data.push([]); var row = sh.data[r - 1 + i]; for (var j = 0; j < nc; j++) row[c - 1 + j] = v[i][j]; } },
      clearContent: function () { for (var i = 0; i < nr; i++) { var row = sh.data[r - 1 + i]; if (row) for (var j = 0; j < nc; j++) row[c - 1 + j] = ''; } }
    };
  };
  function Book(id, name) { this.id = id; this.name = name; this.sheets = []; }
  Book.prototype.getId = function () { return this.id; };
  Book.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
  Book.prototype.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
  Book.prototype.insertSheet = function (n) { var s = new Sheet(n); this.sheets.push(s); return s; };
  Book.prototype.getSheets = function () { return this.sheets; };
  Book.prototype.deleteSheet = function (s) { this.sheets.splice(this.sheets.indexOf(s), 1); };
  var books = {};
  G.SpreadsheetApp = {
    create: function (name) { var id = 'ss' + (++seq); var b = new Book(id, name); b.insertSheet('Sheet1'); books[id] = b; return b; },
    openById: function (id) { if (!books[id]) throw new Error('no spreadsheet ' + id); return books[id]; },
    _add: function (id, sheets) { var b = new Book(id, 'src'); Object.keys(sheets).forEach(function (k) { b.sheets.push(new Sheet(k, sheets[k])); }); books[id] = b; return b; }
  };

  /* ---------- Drive ---------- */
  var nodes = {};
  function Folder(name, parent) { this.id = 'fo' + (++seq); this.name = name; this.parent = parent; nodes[this.id] = this; }
  Folder.prototype.getId = function () { return this.id; };
  Folder.prototype.getName = function () { return this.name; };
  function it(list) { var i = 0; return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } }; }
  function kids(f, type) { return Object.keys(nodes).map(function (k) { return nodes[k]; }).filter(function (n) { return n.parent === f && n instanceof type && !n.trashed; }); }
  Folder.prototype.getFolders = function () { return it(kids(this, Folder)); };
  Folder.prototype.getFoldersByName = function (n) { return it(kids(this, Folder).filter(function (x) { return x.name === n; })); };
  Folder.prototype.getFiles = function () { return it(kids(this, File)); };
  Folder.prototype.createFolder = function (n) { return new Folder(n, this); };
  Folder.prototype.createFile = function (blob) { return new File(blob, this); };
  function File(blob, parent) { this.id = 'fi' + (++seq); this.blob = blob; this.parent = parent; this.created = new Date(); nodes[this.id] = this; }
  File.prototype.getId = function () { return this.id; };
  File.prototype.getName = function () { return this.blob.getName(); };
  File.prototype.getSize = function () { return this.blob.getBytes().length; };
  File.prototype.getMimeType = function () { return this.blob.getContentType(); };
  File.prototype.getBlob = function () { return this.blob; };
  File.prototype.getUrl = function () { return 'https://drive.google.com/file/d/' + this.id + '/view'; };
  File.prototype.getDateCreated = function () { return this.created; };
  File.prototype.setTrashed = function (v) { this.trashed = v; };
  function byId(id) { if (!nodes[id]) throw new Error('not found ' + id); return nodes[id]; }
  G.DriveApp = { getFolderById: byId, getFileById: byId, _root: function (id, name) { var f = new Folder(name, null); delete nodes[f.id]; f.id = id; nodes[id] = f; return f; }, _nodes: nodes };

  function Blob(bytes, type, name) { this.b = bytes; this.t = type; this.n = name; }
  Blob.prototype.getBytes = function () { return this.b; };
  Blob.prototype.getContentType = function () { return this.t; };
  Blob.prototype.getName = function () { return this.n; };

  /* ---------- อื่น ๆ ---------- */
  var cacheStore = {};
  G.CacheService = { getScriptCache: function () { return { get: function (k) { return cacheStore[k] === undefined ? null : cacheStore[k]; }, put: function (k, v) { cacheStore[k] = String(v); }, remove: function (k) { delete cacheStore[k]; } }; }, _store: cacheStore };
  var propStore = {};
  G.PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return propStore[k] === undefined ? null : propStore[k]; }, setProperty: function (k, v) { propStore[k] = String(v); }, deleteProperty: function (k) { delete propStore[k]; } }; }, _store: propStore };
  G.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  G.Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: function (alg, s) { return sha256(utf8(s)); },
    getUuid: uuid,
    base64Encode: b64enc, base64Decode: b64dec,
    newBlob: function (bytes, type, name) { return new Blob(bytes, type, name); },
    formatDate: function (d, tz, fmt) { var t = new Date(d.getTime() + 7 * 3600000); return t.toISOString().slice(0, 10); }
  };
  G.HtmlService = {};
  G.__gasMock = { reset: function () { Object.keys(cacheStore).forEach(function (k) { delete cacheStore[k]; }); } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
