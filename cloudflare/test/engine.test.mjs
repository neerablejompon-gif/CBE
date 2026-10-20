// ทดสอบ worker engine กับ Google API จำลอง: node test/engine.test.mjs (รัน node build.mjs ก่อน)
import { createGoogle } from '../worker/src/google.js';
import { createEngine, diffBook } from '../worker/src/engine.js';
import { createFakeGoogle, fakeServiceAccount } from './fake-google.mjs';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + String(e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'ควรเป็นจริง'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'ไม่เท่ากัน') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); };

export function memoryStore() {
  const m = new Map();
  return {
    m,
    async get(k) { const v = m.get(k); if (!v) return null; if (v.exp < Date.now()) { m.delete(k); return null; } return v.v; },
    async put(k, v, ttl) { m.set(k, { v, exp: Date.now() + ttl * 1000 }); },
    async remove(k) { m.delete(k); }
  };
}

const DB = 'db-sheet', ROOT = '1HivoxPWFgQ3DH5ZmNOqYZshCUh59_VGN', SRC = '1k5D_YOgOx-e8f6QYOzUvJYsVSTRkY9388fyeI_PqrXs';
const fake = createFakeGoogle();
fake.addBook(DB, { Sheet1: [] });
fake.addFolder(ROOT, 'Core Business Enablers 2569', null);
const sa = await fakeServiceAccount();
const store = memoryStore();
const logs = [];
// สร้าง engine ใหม่ทุกครั้งเหมือนแต่ละคำขอใน Worker (ไม่มีข้อมูลค้างในหน่วยความจำ)
const engine = (props = {}) => createEngine({ google: createGoogle(sa, fake.fetch), store, props: { DB_SPREADSHEET_ID: DB, ...props }, log: (lv, x) => logs.push(x) });
const call = async (tok, a, p = {}) => { const r = await engine().api(tok, a, p); if (process.env.DEBUG && !r.ok) console.log(logs.slice(-3).join('\n')); return r; };
const sheet = name => fake.books.get(DB).sheets.find(s => s.title === name);
const rows = name => { const s = sheet(name); const head = s.data[0]; return s.data.slice(1).filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]]))); };
const pdf = Buffer.from('%PDF-1.4 ทดสอบ').toString('base64');

console.log('diff');
await t('diffBook เขียนเฉพาะแถวที่เปลี่ยน และล้างแถวที่หายไป', () => {
  const base = { sheets: [{ sheetId: 1, title: 'x', rowCount: 5, data: [['h'], ['a', 1], ['b', 2], ['c', 3]] }] };
  const work = { sheets: [{ sheetId: 1, title: 'x', data: [['h'], ['a', 1], ['B', 2]] }] };
  const d = diffBook(base, work);
  eq(d.data, [{ range: "'x'!A3:B3", values: [['B', 2]] }]);
  eq(d.clears, ["'x'!A4:B4"]);
  eq(d.requests, []);
});
await t('diffBook ขยายจำนวนแถวของชีทเมื่อข้อมูลเกิน', () => {
  const base = { sheets: [{ sheetId: 1, title: 'x', rowCount: 2, data: [['h']] }] };
  const d = diffBook(base, { sheets: [{ sheetId: 1, title: 'x', data: [['h'], ['a'], ['b']] }] });
  eq(d.requests, [{ appendDimension: { sheetId: 1, dimension: 'ROWS', length: 201 } }]);
});

console.log('ติดตั้ง');
let adminPw;
await t('setup สร้างตารางในสเปรดชีตเปล่าและแอดมินคนแรก', async () => {
  const r = await engine({ ADMIN_EMAIL: 'Admin@Example.org' }).setup();
  eq(r.admin, 'admin@example.org');
  adminPw = /รหัสผ่านชั่วคราว: (\S+)/.exec(logs.join('\n'))[1];
  ok(!fake.books.get(DB).sheets.some(s => s.title === 'Sheet1'), 'ควรลบ Sheet1');
  eq(rows('subtopics').length, 134);
  eq(rows('users').length, 1);
});
await t('setup รันซ้ำไม่สร้างข้อมูลซ้ำ', async () => {
  await engine({ ADMIN_EMAIL: 'admin@example.org' }).setup();
  eq(rows('subtopics').length, 134); eq(rows('users').length, 1);
});

console.log('เข้าสู่ระบบและ session');
let admin, rep;
await t('รหัสผิดถูกปฏิเสธและนับจำนวนครั้ง', async () => {
  const r = await call(null, 'login', { email: 'admin@example.org', password: 'wrong-pass1' });
  ok(!r.ok && /ไม่ถูกต้อง/.test(r.error)); eq(rows('users')[0].failed, 1);
});
await t('เข้าสู่ระบบได้ token และ session เก็บเฉพาะแฮช', async () => {
  const r = await call(null, 'login', { email: 'admin@example.org', password: adminPw });
  ok(r.ok, r.error); admin = r.data.token; ok(r.data.mustChange);
  ok([...store.m.keys()].every(k => !k.includes(admin)), 'ไม่ควรเก็บ token ตรง ๆ');
});
await t('คำขอถัดไป (engine ใหม่) ใช้ session เดิมได้ และต้องเปลี่ยนรหัสก่อน', async () => {
  const r = await call(admin, 'listUsers'); ok(!r.ok && /เปลี่ยนรหัสผ่าน/.test(r.error));
  ok((await call(admin, 'changePassword', { oldPw: adminPw, newPw: 'Admin-Pass-2569' })).ok);
  const b = await call(admin, 'bootstrap'); ok(b.ok, b.error); eq(b.data.enablers.length, 9);
});
await t('token ปลอมเป็น auth error', async () => { const r = await call('x'.repeat(64), 'bootstrap'); ok(!r.ok && r.auth); });
await t('เพิ่มผู้รายงานและเข้าสู่ระบบ', async () => {
  const u = await call(admin, 'saveUser', { email: 'sp@example.org', name: 'ผู้รายงาน SP', role: 'reporter', enablers: ['SP'] }); ok(u.ok, u.error);
  const l = await call(null, 'login', { email: 'sp@example.org', password: u.data.tempPassword }); ok(l.ok, l.error);
  ok((await call(l.data.token, 'changePassword', { oldPw: u.data.tempPassword, newPw: 'Report-Pass-2569' })).ok);
  rep = l.data.token;
});

console.log('บันทึกผลและสิทธิ์');
const KEY = 'SP-1.1';
await t('บันทึกขั้นตอนและผล เก็บลงชีทจริง', async () => {
  const s = await call(rep, 'saveStep', { key: KEY, level: 1, step: 'ขั้นตอนทดสอบ', gap: '', unit: 'ครั้ง', target: 2, plan: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }); ok(s.ok, s.error);
  const stepId = s.data.levels[0].steps[0].id;
  const r = await call(rep, 'saveLevel', { key: KEY, level: 1, narrative: 'รายละเอียด "ทดสอบ" <b>', results: { [stepId]: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }); ok(r.ok, r.error);
  const fresh = await call(rep, 'getSub', { key: KEY });
  eq(fresh.data.levels[0].narrative, 'รายละเอียด "ทดสอบ" <b>');
  eq(fresh.data.levels[0].steps[0].result[0], 1);
});
await t('บันทึกครั้งหนึ่งเขียนเฉพาะแถวที่เปลี่ยน ไม่เขียนทั้งตาราง', async () => {
  fake.calls.length = 0;
  ok((await call(rep, 'setSelfScore', { key: KEY, score: 1.25 })).ok);
  const writes = fake.calls.filter(c => c.includes('values:batchUpdate')).length;
  eq(writes, 1);
  eq(fake.calls.filter(c => c.includes('values:batchClear')).length, 0);
});
await t('แอดมินแก้รายละเอียดผลไม่ได้ ผู้รายงานแก้ตัวชี้วัดอื่นไม่ได้', async () => {
  ok(/ดูรายละเอียด/.test((await call(admin, 'saveLevel', { key: KEY, level: 1, narrative: 'x' })).error));
  ok(/ไม่มีสิทธิ์/.test((await call(rep, 'getSub', { key: 'RM-1.1' })).error));
});

console.log('ไฟล์บน Google Drive');
let fileId;
await t('อัปโหลดสร้างโฟลเดอร์ตามโครงสร้างเดิมแล้วเก็บไฟล์', async () => {
  const r = await call(rep, 'uploadFile', { key: KEY, level: 1, name: 'เอกสารประกอบที่ 1.pdf', mime: 'application/pdf', data: pdf }); ok(r.ok, r.error);
  fileId = r.data.id;
  const ev = rows('evidence').find(x => x.id === fileId);
  const f = fake.files.get(ev.drive_id);
  ok(f, 'ไฟล์ควรอยู่ใน Drive');
  eq(Buffer.from(f.bytes).toString('base64'), pdf);
  const lv = fake.files.get(f.parents[0]), sub = fake.files.get(lv.parents[0]), en = fake.files.get(sub.parents[0]);
  eq([en.name, sub.name.split(' ')[0], lv.name], ['3.2 SP', '3.2.1.1', 'เอกสารแนบค่าเกณฑ์ระดับ 1']);
  eq(en.parents[0], ROOT);
});
await t('อัปโหลดไฟล์ที่สองใช้โฟลเดอร์เดิม', async () => {
  const before = [...fake.files.values()].filter(f => f.mimeType.endsWith('folder')).length;
  ok((await call(rep, 'uploadFile', { key: KEY, level: 1, name: 'b.png', mime: 'image/png', data: pdf })).ok);
  eq([...fake.files.values()].filter(f => f.mimeType.endsWith('folder')).length, before);
});
await t('ดาวน์โหลดได้ไฟล์เดิม แอดมินดาวน์โหลดได้', async () => {
  const r = await call(admin, 'downloadFile', { id: fileId }); ok(r.ok, r.error);
  eq(r.data.data, pdf); eq(r.data.mime, 'application/pdf');
});
await t('ลบไฟล์ย้ายไปถังขยะ', async () => {
  const ev = rows('evidence').find(x => x.id === fileId);
  ok((await call(rep, 'deleteFile', { id: fileId })).ok);
  ok(fake.files.get(ev.drive_id).trashed);
});
await t('ซิงก์ Drive ลงทะเบียนไฟล์ที่มีอยู่ (รวม Google Docs ซึ่งดาวน์โหลดเป็น PDF)', async () => {
  const en = fake.addFolder('rmF', '3.3 RM', ROOT), sub = fake.addFolder('rmS', '3.3.1.1 กระบวนการ', en), lv = fake.addFolder('rmL', 'เอกสารแนบค่าเกณฑ์ระดับ 2', sub);
  fake.addFile('หลักฐาน RM.pdf', lv, new Uint8Array([1, 2, 3]));
  const gd = fake.addFile('บันทึก', lv, new Uint8Array(), 'application/vnd.google-apps.document');
  const r = await call(admin, 'syncDrive'); ok(r.ok, r.error);
  ok(r.data.added >= 2, JSON.stringify(r.data));
  ok(!r.data.missingFolders.includes('RM') && r.data.missingFolders.includes('CG'));
  const ev = rows('evidence').find(x => x.drive_id === gd);
  const d = await call(admin, 'downloadFile', { id: ev.id }); ok(d.ok, d.error);
  eq(d.data.mime, 'application/pdf');
  eq((await call(admin, 'syncDrive')).data.added, 0);
});

console.log('นำเข้าจาก Google Sheet');
await t('สเปรดชีตต้นทางที่ไม่ได้แชร์ให้ service account แจ้งชัดเจน', async () => {
  fake.deny.add(SRC);
  const r = await call(admin, 'importSheet', {});
  ok(!r.ok && /service account/.test(r.error), r.error);
  fake.deny.delete(SRC);
});
await t('นำเข้าข้อมูลจากชีทต้นทาง', async () => {
  const head = ['ลำดับ', 'ระดับ', 'ค่าเกณฑ์วัดตาม SE-AM', '', '', '', '', 'วิเคราะห์ GAP', 'ขั้นตอนการดำเนินงาน', 'น้ำหนัก', 'เป้าหมาย', 'ถ่วงน้ำหนัก', 'หน่วยนับ', 'แผนผล', 'กำหนดระยะเวลา'];
  const months = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
  fake.addBook(SRC, { 'KM ': [['ผู้รับผิดชอบตัวชี้วัด', '', 'กองความรู้'], head, months, ['1', 'หัวข้อ'], ['1.1', 'ประเด็น'], ['', 'ระดับ 1', 'เกณฑ์ KM ระดับ 1', '', '', '', '', 'GAP', 'ขั้นตอน KM', '', 2, '', 'ครั้ง', 'แผน', '', 1, 1], ['', '', '', '', '', '', '', '', '', '', '', '', '', 'ผล', '', 1]] });
  const r = await call(admin, 'importSheet', {}); ok(r.ok, r.error);
  const km = r.data.find(x => x.code === 'KM'); eq(km.imported, 1);
  ok(r.data.find(x => x.code === 'CG').error);
  const lv = rows('levels').find(x => x.sub_key === 'KM-1.1' && Number(x.level) === 1);
  eq(lv.criteria, 'เกณฑ์ KM ระดับ 1');
});

console.log('อื่น ๆ');
await t('ตารางที่ใกล้เต็มจำนวนแถวถูกขยายอัตโนมัติ', async () => {
  const s = sheet('audit_log'); s.rowCount = s.data.length;
  ok((await call(admin, 'saveSettings', { fy: '2569', reportMonth: 11, deadline: '2026-10-31', contact: 'ทดสอบ' })).ok);
  ok(s.rowCount > s.data.length - 1);
});
await t('ข้อความที่เป็นตัวเลขหรือวันที่ไม่ถูกแปลงชนิด (เขียนแบบ RAW)', async () => {
  const st = rows('settings').find(x => x.key === 'report_deadline'); eq(st.value, '2026-10-31');
});
await t('ออกจากระบบแล้ว token ใช้ไม่ได้', async () => {
  ok((await call(rep, 'logout')).ok);
  ok((await call(rep, 'bootstrap')).auth);
});
await t('session หมดอายุตาม TTL', async () => {
  const l = await call(null, 'login', { email: 'admin@example.org', password: 'Admin-Pass-2569' });
  for (const v of store.m.values()) v.exp = Date.now() - 1;
  ok((await call(l.data.token, 'bootstrap')).auth);
});
await t('ข้อผิดพลาดภายในไม่เปิดเผยรายละเอียด', async () => {
  const bad = createEngine({ google: createGoogle(sa, fake.fetch), store, props: { DB_SPREADSHEET_ID: 'missing' } });
  let msg = '';
  try { const r = await bad.api(null, 'login', { email: 'a@b.c', password: 'x' }); msg = r.error; } catch (e) { msg = 'throw'; }
  ok(!/missing|spreadsheet/i.test(msg), msg);
});

console.log(`\n${pass} ผ่าน, ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
