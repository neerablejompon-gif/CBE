/**
 * ติดตั้งครั้งแรก: รันฟังก์ชัน setup() จาก Apps Script editor หนึ่งครั้ง (รันซ้ำได้ ไม่ลบข้อมูลเดิม)
 * 1. สร้างสเปรดชีตฐานข้อมูล (หรือใช้ DB_SPREADSHEET_ID ที่ตั้งไว้) พร้อมตารางทั้งหมด
 * 2. ใส่โครงสร้างตัวชี้วัด หัวข้อ ประเด็นย่อย ตามคู่มือ SE-AM 2569
 * 3. สร้างแอดมินคนแรกจาก Script Property ADMIN_EMAIL และแสดงรหัสผ่านชั่วคราวใน Execution log
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_SPREADSHEET_ID');
  var ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('CBE Reporting Database');
    props.setProperty('DB_SPREADSHEET_ID', ss.getId());
  }
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABLES[name];
    var head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
    if (head.join('') === '') sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    else if (head.join('|') !== cols.join('|')) throw new Error('หัวตาราง ' + name + ' ไม่ตรงกับโครงสร้างที่คาดไว้');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  Db.reset();
  seedStructure_();
  var admin = createFirstAdmin_();
  Db.reset();
  console.log('ฐานข้อมูล: ' + ss.getUrl());
  if (admin) console.log('แอดมินคนแรก: ' + admin.email + ' รหัสผ่านชั่วคราว: ' + admin.password + ' (ต้องเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก)');
  return { db: ss.getId(), admin: admin ? admin.email : null };
}

function seedStructure_() {
  var hasE = {};
  Db.all('enablers').forEach(function (e) { hasE[e.code] = true; });
  var hasT = {}, hasS = {};
  Db.all('topics').forEach(function (t) { hasT[t.id] = true; });
  Db.all('subtopics').forEach(function (s) { hasS[s.key] = true; });
  var E = [], T = [], S = [];
  SEED_ENABLERS.forEach(function (e, ei) {
    if (!hasE[e.code]) E.push({ code: e.code, no: e.no, drive: e.drive, name: e.name, en: e.en, owner: e.owner, budget: '', target: e.target === null ? '' : e.target, incomplete: e.incomplete ? 'TRUE' : 'FALSE', folder_id: e.folderId, report_file_id: '', sort: ei });
    e.topics.forEach(function (t, ti) {
      var tid = e.code + '-' + t[0];
      if (!hasT[tid]) T.push({ id: tid, enabler: e.code, no: t[0], name: t[1], weight: t[2], sort: ti });
      t[3].forEach(function (s, si) {
        var key = e.code + '-' + s[0];
        if (!hasS[key]) S.push({ key: key, enabler: e.code, topic_id: tid, no: s[0], name: s[1], weight: s[2], self_score: '', audit_score: '', status: 'draft', submitted_at: '', updated_at: '', updated_by: '', folder_id: '', sort: ti * 100 + si });
      });
    });
  });
  Db.insertMany('enablers', E);
  Db.insertMany('topics', T);
  Db.insertMany('subtopics', S);
}

function createFirstAdmin_() {
  if (Db.find('users', function (u) { return u.role === 'admin'; })) return null;
  var email = String(prop_('ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!email) throw new Error('ตั้ง Script Property ADMIN_EMAIL ก่อนรัน setup');
  var u = Db.insert('users', { id: id_(), email: email, name: 'ผู้ดูแลระบบ', role: 'admin', enablers: '', active: 'TRUE', failed: 0, locked_until: '', created_at: nowIso_(), last_login: '' });
  var pw = Auth.tempPassword();
  Auth.setPassword(u, pw, true);
  return { email: email, password: pw };
}

/** กรณีแอดมินลืมรหัสผ่าน: ตั้ง Script Property RESET_EMAIL แล้วรันฟังก์ชันนี้จาก editor */
function resetPasswordFromEditor() {
  var email = String(prop_('RESET_EMAIL') || '').trim().toLowerCase();
  var u = Db.find('users', function (x) { return String(x.email).toLowerCase() === email; });
  if (!u) throw new Error('ไม่พบผู้ใช้ ' + email);
  var pw = Auth.tempPassword();
  Auth.setPassword(u, pw, true);
  PropertiesService.getScriptProperties().deleteProperty('RESET_EMAIL');
  console.log('รหัสผ่านชั่วคราวของ ' + email + ': ' + pw);
}
