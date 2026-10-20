/**
 * คลังเอกสารบน Google Drive ตามโครงสร้างเดิม:
 * โฟลเดอร์หลัก → "{3.x} {CODE}" → "{3.x}.{ประเด็นย่อย} {ชื่อ}" → "เอกสารแนบค่าเกณฑ์ระดับ N" → ไฟล์
 * ไฟล์เป็นของบัญชีที่ deploy ระบบ ผู้ใช้เปิด/ดาวน์โหลดผ่านระบบซึ่งตรวจสิทธิ์ก่อนทุกครั้ง
 */
var LEVEL_FOLDER = 'เอกสารแนบค่าเกณฑ์ระดับ ';

function childFolder_(parent, name, create) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return create ? parent.createFolder(name) : null;
}

/** หาโฟลเดอร์ลูกที่ชื่อขึ้นต้นด้วย prefix ตามด้วยช่องว่าง (เช่น "3.3 " หรือ "3.3.1.1 ") */
function childByPrefix_(parent, prefix) {
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(prefix + ' ') === 0) return f;
  }
  return null;
}

/** เปิดโฟลเดอร์จาก ID ที่เก็บไว้ คืน null ถ้าถูกลบ ย้าย หรือไม่มีสิทธิ์ (จะค้นหาจากชื่อแทน) */
function folderById_(id) {
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (err) { return null; }
}

function enablerFolder_(e, create) {
  var known = folderById_(e.folder_id);
  if (known) return known;
  var root = DriveApp.getFolderById(settings_().root_folder_id);
  var f = childByPrefix_(root, e.drive) || (create ? root.createFolder(e.drive + ' ' + e.code) : null);
  if (f) Db.update('enablers', e, { folder_id: f.getId() });
  return f;
}

function subFolder_(s, create) {
  var known = folderById_(s.folder_id);
  if (known) return known;
  var e = Db.find('enablers', function (x) { return x.code === s.enabler; });
  var ef = enablerFolder_(e, create);
  if (!ef) return null;
  var prefix = e.drive + '.' + s.no;
  var f = childByPrefix_(ef, prefix) || (create ? ef.createFolder(prefix + ' ' + String(s.name).slice(0, 120)) : null);
  if (f) Db.update('subtopics', s, { folder_id: f.getId() });
  return f;
}

function levelFolder_(s, n, create) {
  var L = levelRow_(s.key, n, create);
  var known = folderById_(L && L.folder_id);
  if (known) return known;
  var sf = subFolder_(s, create);
  if (!sf) return null;
  var f = childFolder_(sf, LEVEL_FOLDER + n, create);
  if (f && L) Db.update('levels', L, { folder_id: f.getId() });
  return f;
}

/** ตัดนามสกุลไฟล์ที่รู้จัก (ชื่อไฟล์ในชีทมักไม่มีนามสกุล และมีจุดในเลขประเด็น เช่น 1.1_L1) */
function stripExt_(name) {
  return String(name).trim().replace(new RegExp('\\.(' + APP.allowedExt.join('|') + ')$', 'i'), '');
}

function cleanName_(name) {
  var n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!n || n === '.' || n === '..') throw new UserError('ชื่อไฟล์ไม่ถูกต้อง');
  return n.slice(0, 180);
}

function uploadFile_(u, p) {
  var s = sub_(p.key);
  assertEditableSub_(u, s);
  var n = levelNo_(p.level);
  var name = cleanName_(p.name);
  var ext = name.split('.').pop().toLowerCase();
  if (name.indexOf('.') < 0 || APP.allowedExt.indexOf(ext) < 0) throw new UserError('รองรับเฉพาะไฟล์ ' + APP.allowedExt.join(', '));
  if (typeof p.data !== 'string' || p.data.length > Math.ceil(APP.maxUploadBytes * 4 / 3) + 8) throw new UserError('ไฟล์ใหญ่เกิน ' + (APP.maxUploadBytes / 1048576) + ' MB');
  var bytes = Utilities.base64Decode(p.data);
  if (!bytes.length) throw new UserError('ไฟล์ว่างเปล่า');
  if (bytes.length > APP.maxUploadBytes) throw new UserError('ไฟล์ใหญ่เกิน ' + (APP.maxUploadBytes / 1048576) + ' MB');
  var req = '';
  if (p.reqId) {
    var r = Db.find('requirements', function (x) { return x.id === p.reqId && x.sub_key === s.key && Number(x.level) === n; });
    if (!r) throw new UserError('ไม่พบรายการ Minimum Requirement');
    req = r.id;
    Db.update('requirements', r, { has: 'TRUE' });
  }
  var mime = String(p.mime || 'application/octet-stream').slice(0, 100);
  var file = levelFolder_(s, n, true).createFile(Utilities.newBlob(bytes, mime, name));
  var row = Db.insert('evidence', { id: id_(), sub_key: s.key, level: n, req_id: req, name: name, drive_id: file.getId(), mime: mime, size: bytes.length, uploaded_by: u.name, uploaded_at: nowIso_(), deleted: 'FALSE' });
  touchSub_(u, s);
  audit_(u, 'upload', s.enabler, 'แนบไฟล์ ' + name + ' (' + s.key + ' ระดับ ' + n + ')');
  return fileOut_(row);
}

function deleteFile_(u, p) {
  var f = Db.find('evidence', function (x) { return x.id === p.id && !bool_(x.deleted); });
  if (!f) throw new UserError('ไม่พบไฟล์');
  var s = sub_(f.sub_key);
  assertEditableSub_(u, s);
  if (f.drive_id) {
    try { DriveApp.getFileById(f.drive_id).setTrashed(true); } catch (e) { console.warn('trash failed ' + f.drive_id + ': ' + e); }
  }
  Db.update('evidence', f, { deleted: 'TRUE' });
  touchSub_(u, s);
  audit_(u, 'delete_file', s.enabler, 'ลบไฟล์ ' + f.name + ' (' + s.key + ' ระดับ ' + f.level + ')');
  return true;
}

/** ดาวน์โหลดผ่านระบบ (ไฟล์ไม่เกิน 20 MB) ไฟล์ที่ใหญ่กว่าคืนลิงก์ Drive ให้ผู้ที่มีสิทธิ์โฟลเดอร์เปิดเอง */
function downloadFile_(u, p) {
  var f = Db.find('evidence', function (x) { return x.id === p.id && !bool_(x.deleted); });
  if (!f) throw new UserError('ไม่พบไฟล์');
  assertSee_(u, f.sub_key.split('-')[0]);
  if (!f.drive_id) throw new UserError('ไฟล์นี้นำเข้ามาเฉพาะชื่อ ยังไม่ได้เชื่อมกับไฟล์ใน Drive');
  var file = DriveApp.getFileById(f.drive_id);
  if (file.getSize() > 20 * 1024 * 1024) return { url: file.getUrl(), name: f.name };
  var blob = file.getBlob();
  audit_(u, 'download', f.sub_key.split('-')[0], 'เปิดไฟล์ ' + f.name);
  return { name: f.name, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function listFiles_(u, p) {
  assertSee_(u, p.code);
  var keys = {};
  Db.where('subtopics', function (x) { return x.enabler === p.code; }).forEach(function (x) { keys[x.key] = true; });
  return Db.where('evidence', function (x) { return keys[x.sub_key] && !bool_(x.deleted); }).map(fileOut_);
}

/**
 * อ่านโครงสร้างโฟลเดอร์ใน Drive แล้วลงทะเบียนไฟล์ที่ยังไม่มีในตาราง evidence
 * จับคู่ไฟล์กับรายการที่นำเข้าเฉพาะชื่อ (ไม่มี drive_id) ถ้าชื่อตรงกัน
 */
function syncDrive_(u) {
  assertAdmin_(u);
  var known = {};
  Db.all('evidence').forEach(function (f) { if (f.drive_id) known[f.drive_id] = true; });
  var added = 0, linked = 0, missing = [];
  Db.all('enablers').forEach(function (e) {
    var ef;
    try { ef = enablerFolder_(e, false); } catch (err) { ef = null; }
    if (!ef) { missing.push(e.code); return; }
    Db.where('subtopics', function (s) { return s.enabler === e.code; }).forEach(function (s) {
      var sf = subFolder_(s, false);
      if (!sf) return;
      for (var n = 1; n <= 5; n++) {
        var lf = childFolder_(sf, LEVEL_FOLDER + n, false);
        if (!lf) continue;
        var L = levelRow_(s.key, n, true);
        if (L.folder_id !== lf.getId()) Db.update('levels', L, { folder_id: lf.getId() });
        var it = lf.getFiles();
        while (it.hasNext()) {
          var file = it.next();
          if (known[file.getId()]) continue;
          var nm = file.getName();
          var base = stripExt_(nm);
          var pending = Db.find('evidence', function (x) {
            return x.sub_key === s.key && Number(x.level) === n && !x.drive_id && !bool_(x.deleted) && stripExt_(x.name) === base;
          });
          if (pending) {
            Db.update('evidence', pending, { drive_id: file.getId(), size: file.getSize(), mime: file.getMimeType() });
            linked++;
          } else {
            Db.insert('evidence', { id: id_(), sub_key: s.key, level: n, req_id: '', name: nm, drive_id: file.getId(), mime: file.getMimeType(), size: file.getSize(), uploaded_by: 'Google Drive', uploaded_at: file.getDateCreated().toISOString(), deleted: 'FALSE' });
            added++;
          }
          known[file.getId()] = true;
        }
      }
    });
  });
  audit_(u, 'sync_drive', '', 'ซิงก์ Drive: เพิ่ม ' + added + ' ไฟล์ เชื่อม ' + linked + ' ไฟล์' + (missing.length ? ' ไม่พบโฟลเดอร์ ' + missing.join(', ') : ''));
  return { added: added, linked: linked, missingFolders: missing };
}
