// ชุดทดสอบฝั่งเซิร์ฟเวอร์: node tests/run.js
const load = require('./load');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
}
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'ไม่เท่ากัน') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, m) { if (!v) throw new Error(m || 'ควรเป็นจริง'); }
function err(res, re) { ok(!res.ok, 'ควรล้มเหลว แต่สำเร็จ'); ok(re.test(res.error), 'ข้อความผิดพลาดไม่ตรง: ' + res.error); }

const G = load();
G.PropertiesService.getScriptProperties().setProperty('ADMIN_EMAIL', 'Admin@Example.org');
const root = G.DriveApp._root('1HivoxPWFgQ3DH5ZmNOqYZshCUh59_VGN', 'Core Business Enablers 2569');
const call = (tok, a, p) => G.api(tok, a, p);
const today = new Date();
const ymd = d => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const day = n => ymd(new Date(today.getTime() + n * 86400000));
const pdf = G.Utilities.base64Encode([37, 80, 68, 70, 45, 49]);

console.log('ติดตั้งและโครงสร้าง');
let adminPw;
t('setup สร้างตาราง โครงสร้าง SE-AM และแอดมินคนแรก', () => {
  const origLog = G.console.log; let out = '';
  G.console.log = s => { out += s + '\n'; };
  const r = G.setup();
  G.console.log = origLog;
  adminPw = /รหัสผ่านชั่วคราว: (\S+)/.exec(out)[1];
  eq(r.admin, 'admin@example.org');
  eq(G.Db.all('enablers').length, 9);
  eq(G.Db.all('subtopics').length, 134);
  eq(G.Db.all('topics').length, 53);
  ok(adminPw.length === 12);
});
t('setup รันซ้ำได้โดยไม่สร้างข้อมูลซ้ำ', () => {
  G.setup();
  eq(G.Db.all('subtopics').length, 134);
  eq(G.Db.all('users').length, 1);
});

console.log('เข้าสู่ระบบ');
let admin, rep, rep2;
t('รหัสผ่านผิดได้ข้อความกลาง ๆ', () => err(call(null, 'login', { email: 'admin@example.org', password: 'wrong' }), /อีเมลหรือรหัสผ่านไม่ถูกต้อง/));
t('อีเมลที่ไม่มีในระบบได้ข้อความเดียวกัน', () => err(call(null, 'login', { email: 'x@y.z', password: 'wrong' }), /อีเมลหรือรหัสผ่านไม่ถูกต้อง/));
t('เข้าสู่ระบบด้วยรหัสชั่วคราว (ไม่สนตัวพิมพ์ของอีเมล) และต้องเปลี่ยนรหัส', () => {
  const r = call(null, 'login', { email: ' ADMIN@example.org ', password: adminPw });
  ok(r.ok, r.error); ok(r.data.mustChange); admin = r.data.token;
});
t('ก่อนเปลี่ยนรหัสผ่านใช้งานอื่นไม่ได้', () => err(call(admin, 'listUsers', {}), /เปลี่ยนรหัสผ่าน/));
t('รหัสผ่านใหม่ที่อ่อนถูกปฏิเสธ', () => err(call(admin, 'changePassword', { oldPw: adminPw, newPw: 'short1' }), /อย่างน้อย 10/));
t('เปลี่ยนรหัสผ่านสำเร็จ', () => { const r = call(admin, 'changePassword', { oldPw: adminPw, newPw: 'Admin-Pass-2569' }); ok(r.ok, r.error); });
t('token ปลอมถูกปฏิเสธเป็น auth error', () => { const r = call('fake', 'bootstrap', {}); ok(!r.ok && r.auth); });
t('คำสั่งที่ไม่รู้จักถูกปฏิเสธ', () => err(call(admin, 'eval', {}), /ไม่รู้จักคำสั่ง/));

console.log('ผู้ใช้และสิทธิ์');
let repPw;
t('แอดมินเพิ่มผู้รายงาน CG ได้รหัสชั่วคราว', () => {
  const r = call(admin, 'saveUser', { email: 'cg@example.org', name: 'ผู้รายงาน CG', role: 'reporter', enablers: ['CG', 'XX'] });
  ok(r.ok, r.error); repPw = r.data.tempPassword;
  eq(G.Db.find('users', u => u.email === 'cg@example.org').enablers, 'CG');
});
t('อีเมลซ้ำถูกปฏิเสธ', () => err(call(admin, 'saveUser', { email: 'CG@example.org', name: 'x', role: 'reporter', enablers: ['CG'] }), /มีในระบบแล้ว/));
t('ผู้รายงานต้องมีตัวชี้วัด', () => err(call(admin, 'saveUser', { email: 'n@example.org', name: 'x', role: 'reporter', enablers: [] }), /อย่างน้อย 1/));
t('ผู้รายงานเข้าสู่ระบบและเปลี่ยนรหัส', () => {
  let r = call(null, 'login', { email: 'cg@example.org', password: repPw }); ok(r.ok, r.error); rep = r.data.token;
  r = call(rep, 'changePassword', { oldPw: repPw, newPw: 'Reporter-2569x' }); ok(r.ok, r.error);
  const r2 = call(admin, 'saveUser', { email: 'rm@example.org', name: 'ผู้รายงาน RM', role: 'reporter', enablers: ['RM'] });
  r = call(null, 'login', { email: 'rm@example.org', password: r2.data.tempPassword }); rep2 = r.data.token;
  call(rep2, 'changePassword', { oldPw: r2.data.tempPassword, newPw: 'Reporter-RM-01' });
});
t('ผู้รายงานเห็นเฉพาะตัวชี้วัดที่รับผิดชอบ', () => {
  const r = call(rep, 'bootstrap', {}); ok(r.ok, r.error);
  eq(r.data.enablers.map(e => e.code), ['CG']); eq(r.data.me.role, 'reporter');
});
t('แอดมินเห็นทั้ง 9 ตัวชี้วัด', () => eq(call(admin, 'bootstrap', {}).data.enablers.length, 9));
t('ผู้รายงานเปิดประเด็นของตัวชี้วัดอื่นไม่ได้', () => err(call(rep, 'getSub', { key: 'RM-1.1' }), /ไม่มีสิทธิ์/));
t('ผู้รายงานเรียกคำสั่งแอดมินไม่ได้', () => { err(call(rep, 'listUsers', {}), /เฉพาะแอดมิน/); err(call(rep, 'approve', { key: 'CG-1.1', score: 5 }), /เฉพาะแอดมิน/); });
t('แอดมินแก้รายละเอียดผลไม่ได้ (ดูอย่างเดียว)', () => {
  err(call(admin, 'saveLevel', { key: 'CG-1.1', level: 1, narrative: 'x' }), /ดูรายละเอียดผลการดำเนินงานได้อย่างเดียว/);
  err(call(admin, 'uploadFile', { key: 'CG-1.1', level: 1, name: 'a.pdf', data: pdf }), /ดูรายละเอียด/);
});
t('แอดมินปิดบัญชีตัวเองไม่ได้', () => {
  const me = G.Db.find('users', u => u.role === 'admin');
  err(call(admin, 'saveUser', { id: me.id, email: me.email, name: me.name, role: 'admin', active: false }), /ของตัวเอง/);
});

console.log('รายงานผลและขั้นตอนอนุมัติ');
let stepId, reqId, fileId;
t('ผู้รายงานเพิ่มขั้นตอนพร้อมแผนรายเดือน', () => {
  const r = call(rep, 'saveStep', { key: 'CG-1.1', level: 1, step: 'ทบทวนนโยบาย', unit: 'ครั้ง', target: 1, plan: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0] });
  ok(r.ok, r.error); stepId = r.data.levels[0].steps[0].id; eq(r.data.levels[0].steps[0].plan[9], 1);
});
t('แผนต้องมี 12 เดือนและเป็นตัวเลข', () => err(call(rep, 'saveStep', { key: 'CG-1.1', level: 1, step: 'x', plan: [1, 2] }), /12 เดือน/));
t('บันทึกรายละเอียดผลและผลรายเดือน', () => {
  const r = call(rep, 'saveLevel', { key: 'CG-1.1', level: 1, narrative: '  ทบทวนแล้ว  ', results: { [stepId]: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0] } });
  ok(r.ok, r.error); eq(r.data.levels[0].narrative, 'ทบทวนแล้ว'); eq(r.data.levels[0].steps[0].result[10], 1);
});
t('บันทึกผลเดือนหลังรอบรายงานไม่ได้', () => {
  G.setSetting_('report_month', 5); G.Db.reset();
  err(call(rep, 'saveLevel', { key: 'CG-1.1', level: 1, results: { [stepId]: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1] } }), /ถึงเดือน มี.ค./);
  G.setSetting_('report_month', 11); G.Db.reset();
});
t('ระดับต้องเป็น 1–5', () => err(call(rep, 'saveLevel', { key: 'CG-1.1', level: 7, narrative: 'x' }), /1–5/));
t('เพิ่ม Minimum Requirement และติ๊กว่ามีเอกสาร', () => {
  let r = call(rep, 'addRequirement', { key: 'CG-1.1', level: 1, text: 'นโยบายฯ ครอบคลุม 3 ประเด็น' }); ok(r.ok, r.error);
  reqId = r.data.levels[0].reqs[0].id;
  r = call(rep, 'saveLevel', { key: 'CG-1.1', level: 1, reqHas: { [reqId]: true } }); ok(r.data.levels[0].reqs[0].has);
});
t('ส่งตรวจไม่ได้ถ้าติ๊กแล้วแต่ไม่แนบไฟล์', () => err(call(rep, 'submit', { key: 'CG-1.1' }), /ยังไม่แนบไฟล์/));
t('ไฟล์นามสกุลที่ไม่อนุญาตถูกปฏิเสธ', () => err(call(rep, 'uploadFile', { key: 'CG-1.1', level: 1, reqId, name: 'x.exe', data: pdf }), /รองรับเฉพาะ/));
t('ชื่อไฟล์ที่มี path ถูกทำให้ปลอดภัย', () => {
  const r = call(rep, 'uploadFile', { key: 'CG-1.1', level: 1, reqId, name: '../../เอกสารประกอบที่ 1 นโยบาย.pdf', mime: 'application/pdf', data: pdf });
  ok(r.ok, r.error); fileId = r.data.id; eq(r.data.name, '.._.._เอกสารประกอบที่ 1 นโยบาย.pdf');
});
t('อัปโหลดสร้างโฟลเดอร์ตามโครงสร้าง Drive', () => {
  const f = G.DriveApp.getFileById(G.Db.find('evidence', x => x.id === fileId).drive_id);
  eq([f.parent.name, f.parent.parent.name.slice(0, 7), f.parent.parent.parent.name], ['เอกสารแนบค่าเกณฑ์ระดับ 1', '3.1.1.1', '3.1 CG']);
});
t('ส่งตรวจต้องมีคะแนนประเมินตนเอง', () => err(call(rep, 'submit', { key: 'CG-1.1' }), /คะแนนประเมินตนเอง/));
t('คะแนนประเมินตนเองต้องอยู่ใน 0–5', () => { err(call(rep, 'setSelfScore', { key: 'CG-1.1', score: 6 }), /0–5/); ok(call(rep, 'setSelfScore', { key: 'CG-1.1', score: 2.2 }).ok); });
t('ส่งตรวจสำเร็จและข้อมูลถูกล็อก', () => {
  ok(call(rep, 'submit', { key: 'CG-1.1' }).ok);
  err(call(rep, 'saveLevel', { key: 'CG-1.1', level: 1, narrative: 'แก้' }), /แก้ไขไม่ได้/);
  err(call(rep, 'deleteFile', { id: fileId }), /แก้ไขไม่ได้/);
});
t('ส่งกลับต้องมีเหตุผลอย่างน้อย 10 ตัวอักษร', () => err(call(admin, 'returnSub', { key: 'CG-1.1', reason: 'สั้น' }), /10 ตัวอักษร/));
t('แอดมินส่งกลับ แล้วผู้รายงานแก้และตอบได้', () => {
  ok(call(admin, 'returnSub', { key: 'CG-1.1', reason: 'กรุณาแนบมติคณะกรรมการเพิ่มเติม' }).ok);
  const r = call(rep, 'getSub', { key: 'CG-1.1' }); eq(r.data.status, 'returned'); eq(r.data.comments.length, 1);
  ok(call(rep, 'addComment', { key: 'CG-1.1', text: 'แนบเพิ่มแล้วครับ' }).ok);
  ok(call(rep, 'submit', { key: 'CG-1.1' }).ok);
});
t('อนุมัติต้องมีคะแนน 0–5', () => err(call(admin, 'approve', { key: 'CG-1.1', score: '' }), /0–5/));
t('แอดมินอนุมัติและปลดล็อกได้', () => {
  ok(call(admin, 'approve', { key: 'CG-1.1', score: 2.2 }).ok);
  err(call(admin, 'approve', { key: 'CG-1.1', score: 2 }), /รอตรวจ/);
  ok(call(admin, 'returnSub', { key: 'CG-1.1', reason: 'ปลดล็อกเพื่อแก้คะแนนตามมติ', unlock: true }).ok);
  eq(G.Db.find('subtopics', s => s.key === 'CG-1.1').status, 'returned');
});
t('ปิดข้อสังเกตได้เฉพาะแอดมิน', () => {
  const c = call(rep, 'getSub', { key: 'CG-1.1' }).data.comments[0];
  err(call(rep, 'resolveComment', { id: c.id }), /เฉพาะแอดมิน/);
  ok(call(admin, 'resolveComment', { id: c.id }).data[0].resolved);
});
t('ผู้รายงาน RM ดาวน์โหลดไฟล์ CG ไม่ได้ แต่เจ้าของได้', () => {
  err(call(rep2, 'downloadFile', { id: fileId }), /ไม่มีสิทธิ์/);
  const r = call(rep, 'downloadFile', { id: fileId }); ok(r.ok, r.error); eq(r.data.data, pdf);
});
t('ลบไฟล์ย้ายไฟล์ไปถังขยะและหายจากรายการ', () => {
  ok(call(rep, 'deleteFile', { id: fileId }).ok);
  eq(call(rep, 'listFiles', { code: 'CG' }).data.length, 0);
  ok(G.DriveApp.getFileById(G.Db.find('evidence', x => x.id === fileId).drive_id).trashed);
});
t('สรุปผลรายเดือนในหน้าภาพรวมนับแผนและผล', () => {
  const m = call(admin, 'bootstrap', {}).data.enablers[0].monthly;
  eq(m.plan[9], 1); eq(m.done[9], 0);
});

console.log('Timeline');
t('นอกช่วงเวลากรอกถูกปฏิเสธ', () => {
  ok(call(admin, 'saveWindow', { open: day(-30), close: day(-1), from: 0, to: 11 }).ok);
  err(call(rep, 'saveActivity', { sub: 'CG-1.1', lv: 1, name: 'ก', s: 0, e: 1, p: 0 }), /นอกช่วงเวลา/);
});
let actId;
t('ในช่วงเวลาเพิ่มกิจกรรมได้ และตรวจช่วงเดือน', () => {
  ok(call(admin, 'saveWindow', { open: day(-1), close: day(5), from: 1, to: 10 }).ok);
  err(call(rep, 'saveActivity', { sub: 'CG-1.1', lv: 1, name: 'ก', s: 0, e: 2, p: 0 }), /ช่วงเดือนไม่ถูกต้อง/);
  err(call(rep, 'saveActivity', { sub: 'CG-1.1', lv: 1, name: 'ก', s: 4, e: 3, p: 0 }), /ช่วงเดือน/);
  const r = call(rep, 'saveActivity', { sub: 'CG-1.1', lv: 1, name: 'ทบทวนนโยบาย', s: 2, e: 4, p: 10, out: 'นโยบาย' });
  ok(r.ok, r.error); actId = r.data.id;
});
t('ผู้รายงานเพิ่มกิจกรรมของตัวชี้วัดอื่นไม่ได้', () => err(call(rep, 'saveActivity', { sub: 'RM-1.1', lv: 1, name: 'ก', s: 2, e: 3, p: 0 }), /ไม่มีสิทธิ์/));
t('แอดมินเพิ่มกิจกรรมไม่ได้', () => err(call(admin, 'saveActivity', { sub: 'CG-1.1', lv: 1, name: 'ก', s: 2, e: 3, p: 0 }), /ดูรายละเอียด/));
t('ล็อกรายตัวชี้วัดแล้วแก้ไม่ได้', () => {
  ok(call(admin, 'setTimelineLock', { code: 'CG', locked: true }).ok);
  err(call(rep, 'saveActivity', { id: actId, sub: 'CG-1.1', lv: 1, name: 'x', s: 2, e: 3, p: 0 }), /ถูกล็อก/);
  ok(call(admin, 'setTimelineLock', { code: 'CG', locked: false }).ok);
});
t('ปรับช่วงเดือนจนกิจกรรมหลุดช่วงไม่ได้', () => err(call(admin, 'saveWindow', { open: day(-1), close: day(5), from: 3, to: 10 }), /นอกช่วงเดือนใหม่/));
t('ลบกิจกรรมได้', () => { ok(call(rep, 'deleteActivity', { id: actId }).ok); eq(G.Db.all('activities').length, 0); });

console.log('นำเข้าข้อมูลจาก Google Sheet และซิงก์ Drive');
const E = n => Array(n).fill('');
const head = ['ลำดับ', 'ระดับ', 'ค่าเกณฑ์วัดตาม SE-AM', '', '', '', '', 'วิเคราะห์ GAP', 'ขั้นตอนการดำเนินงาน', 'น้ำหนัก', 'เป้าหมาย', 'ถ่วงน้ำหนัก', 'หน่วยนับ', 'แผนผล', 'กำหนดระยะเวลา', ...E(11), 'ความก้าวหน้าเทียบ\nแผนสะสม', '', 'ความก้าวหน้าเทียบ\nแผนทั้งปี', '', 'คะแนน \nปัจจุบัน', 'คะแนนถ่วงน้ำหนัก', 'รายละเอียดผลการดำเนินงานตามแผนการดำเนินงาน', 'Mininum Requirement', 'ถ้ามีเอกสารให้ติ๊กถูก', 'ชื่อหลักฐานประกอบผลการดำเนินงาน', 'ข้อสังเกตของ กปม.'];
const mrow = [...E(14), 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
const row = o => { const r = E(37); Object.keys(o).forEach(k => { r[+k] = o[k]; }); return r; };
const SP = [
  ['รายงานผลการดำเนินงานตามตัวชี้วัดที่ 2'], ['ชื่อตัวชี้วัด', '', 'การวางแผนเชิงกลยุทธ์', '', '', '', '', '', '', 'หัวข้อ', '', 'คะแนนเป้าหมาย '],
  ['ผู้รับผิดชอบตัวชี้วัด', '', 'กองนโยบายและแผน', '', '', '', '', '', '', 'คะแนนเป้าหมาย 2569 ', '', '2.2420'], ['งบประมาณ'], [], [], ['ติดตาม'], head, mrow,
  row({ 0: '1', 1: 'การวิเคราะห์สภาพแวดล้อม', 9: '20' }),
  row({ 0: '1.1', 1: 'กระบวนการรวบรวมฯ', 9: '5', 30: '2.7500' }),
  row({ 1: 'ระดับ 1', 2: 'เกณฑ์ระดับ 1', 7: 'GAP 1', 8: 'ขั้นตอน 1', 10: '  1.00 ', 12: ' แผนงาน', 13: 'แผน', 16: '  1.00 ', 32: 'ผลระดับ 1', 33: '1. แนวทาง/กระบวนการ', 34: 'TRUE', 35: '1.1_L1_SIPOC70\n1.1_L1_แผนกอง69' }),
  row({ 13: 'ผล', 16: '  1.00 ' }),
  row({ 8: 'ขั้นตอน 2', 10: '  1.00 ', 12: ' บทวิเคราะห์', 13: 'แผน', 17: '1.00', 33: 'เอกสารประกอบอื่น (ถ้ามี)', 34: 'TRUE', 35: '1.1_L1_กษ0529' }),
  row({ 13: 'ผล', 17: '1.00' }),
  row({ 1: 'ระดับ 2', 2: 'เกณฑ์ระดับ 2', 8: 'ขั้นตอน L2', 13: 'แผน', 16: '1', 32: 'ผลระดับ 2', 33: '1. หลักฐาน', 34: 'FALSE', 36: 'ควรเพิ่มบทวิเคราะห์' }),
  row({ 1: 'ระดับ 3', 13: 'ผล', 16: '1' }),
  row({ 2: 'เกณฑ์ระดับ 3 (เซลล์เดียวกับระดับ 2)' }),
  row({ 0: '9.9', 1: 'ประเด็นที่ไม่มีในระบบ' })
];
const DT = [['ชื่อตัวชี้วัด', '', 'การพัฒนาเทคโนโลยีดิจิทัล (DT)'], ['ผู้รับผิดชอบตัวชี้วัด', '', 'นายนิลวัฒน์'], ['งบประมาณ'],
  ['ลำดับ', 'ระดับ', 'ค่าเกณฑ์วัดตาม SE-AM', '', '', '', '', 'รายละเอียดผลการดำเนินงานตามแผนการดำเนินงาน', 'Mininum Requirement ตามที่ สคร.', 'ถ้ามีเอกสารให้ติ๊กถูก', 'ชื่อหลักฐานประกอบผลการดำเนินงาน', 'หมายเหตุ'],
  ['1', 'การกำกับดูแลด้านเทคโนโลยีดิจิทัล'], ['1.1', 'กำหนดกรอบทิศทาง'],
  ['', 'ระดับ 1', 'เริ่มมีแนวทาง', '', '', '', '', 'มีกฎบัตร', 'กรอบ/แนวทาง', 'TRUE', '1.1.1.1 กฎบัตร.pdf\n1.1.1.2 EGIT.pdf']];
const HCMh = head.slice(0, 35).concat(['หมายเหตุ', 'ข้อสังเกตจาก กปม.', 'หมายเหตุ']);
HCMh[35] = 'หมายเหตุ';
const HCM = [['ชื่อตัวชี้วัด', '', 'การบริหารทุนมนุษย์'], ['ผู้รับผิดชอบตัวชี้วัด', '', 'ฝ่ายทรัพยากรมนุษย์', '', '', '', '', '', '', 'คะแนนเป้าหมาย 2569 ', '', '2.9525'],
  HCMh, mrow, row({ 0: '1.1', 1: 'คุณภาพของยุทธศาสตร์', 30: '2.6' }),
  (() => { const r = row({ 1: 'ระดับ 1', 2: 'วิเคราะห์ปัจจัย', 8: 'วิเคราะห์ SWOT', 13: 'แผน', 19: '1', 33: 'เอกสารประกอบที่ 1', 34: 'TRUE' }); r[36] = 'เอกสารประกอบอื่น 1.pdf'; r[37] = 'ต้องศึกษาแนวปฏิบัติที่ดี'; return r; })()];

t('parseSheet อ่านชีทมาตรฐาน (SP) ตามชื่อหัวคอลัมน์', () => {
  const p = G.parseSheet_(SP, 'SP');
  eq(p.target, 2.242); eq(p.owner, 'กองนโยบายและแผน'); eq(Object.keys(p.subs), ['1.1', '9.9']);
  const s = p.subs['1.1']; eq(s.score, 2.75);
  const L1 = s.levels[1];
  eq(L1.criteria, 'เกณฑ์ระดับ 1'); eq(L1.steps.length, 2); eq(L1.steps[0].unit, 'แผนงาน'); eq(L1.steps[0].plan[2], 1); eq(L1.steps[1].result[3], 1);
  eq(L1.reqs.map(r => [r.text, r.has, r.files.length]), [['1. แนวทาง/กระบวนการ', true, 2], ['เอกสารประกอบอื่น (ถ้ามี)', true, 1]]);
});
t('parseSheet: ป้าย "ระดับ 3" บนแถวผลของระดับ 2 ถูกนับเป็นผลของระดับ 2', () => {
  const s = G.parseSheet_(SP, 'SP').subs['1.1'];
  eq(s.levels[2].steps[0].result[2], 1); eq(s.levels[3].steps.length, 0); eq(s.levels[3].criteria, 'เกณฑ์ระดับ 3 (เซลล์เดียวกับระดับ 2)');
  eq(s.levels[2].comments, ['ควรเพิ่มบทวิเคราะห์']); eq(s.levels[2].reqs[0].has, false);
});
t('parseSheet: DT ไม่มีคอลัมน์แผน/ผลและเป้าหมาย', () => {
  const p = G.parseSheet_(DT, 'DT'); eq(p.target, null);
  const L = p.subs['1.1'].levels[1]; eq(L.narrative, 'มีกฎบัตร'); eq(L.steps.length, 0); eq(L.reqs[0].files.length, 2);
});
t('parseSheet: HCM ชื่อหลักฐานอยู่ใต้หัวข้อสังเกต', () => {
  const L = G.parseSheet_(HCM, 'HCM').subs['1.1'].levels[1];
  eq(L.reqs[0].files, ['เอกสารประกอบอื่น 1.pdf']); eq(L.comments, ['ต้องศึกษาแนวปฏิบัติที่ดี']); eq(L.steps[0].plan[5], 1);
});
t('importSheet นำเข้าและไม่ทับประเด็นที่มีข้อมูลแล้ว', () => {
  G.SpreadsheetApp._add('SRC', { SP, 'DT ': DT, HCM, 'CG': SP });
  G.setSetting_('source_sheet_id', 'SRC'); G.Db.reset();
  const r = call(admin, 'importSheet', {}); ok(r.ok, r.error);
  const sp = r.data.find(x => x.code === 'SP'); eq([sp.imported, sp.unknown], [1, ['9.9']]);
  eq(r.data.find(x => x.code === 'CG').skipped, 1);
  eq(r.data.find(x => x.code === 'RM').error, 'ไม่พบชีท');
  const d = call(admin, 'getSub', { key: 'SP-1.1' }).data;
  eq(d.self, 2.75); eq(d.levels[0].steps.length, 2); eq(d.levels[0].reqs[0].files.map(f => f.name), ['1.1_L1_SIPOC70', '1.1_L1_แผนกอง69']);
  eq(d.comments.length, 1);
  eq(call(admin, 'getSub', { key: 'DT-1.1' }).data.levels[0].reqs[0].files.length, 2);
});
t('นำเข้าซ้ำด้วย overwrite ไม่สร้างข้อมูลซ้ำ', () => {
  ok(call(admin, 'importSheet', { overwrite: true }).ok);
  eq(G.Db.where('steps', x => x.sub_key === 'SP-1.1').length, 3);
  eq(G.Db.where('comments', x => x.sub_key === 'SP-1.1').length, 1);
});
t('syncDrive เชื่อมไฟล์ที่นำเข้าเฉพาะชื่อ และเพิ่มไฟล์ใหม่', () => {
  const ef = root.createFolder('3.2 SP'); const sf = ef.createFolder('3.2.1.1 กระบวนการรวบรวม'); const lf = sf.createFolder('เอกสารแนบค่าเกณฑ์ระดับ 1');
  lf.createFile(G.Utilities.newBlob([1, 2, 3], 'application/pdf', '1.1_L1_SIPOC70.pdf'));
  lf.createFile(G.Utilities.newBlob([1], 'application/pdf', 'ไฟล์ใหม่.pdf'));
  const r = call(admin, 'syncDrive', {}); ok(r.ok, r.error);
  eq([r.data.added, r.data.linked], [1, 1]);
  const f = call(admin, 'getSub', { key: 'SP-1.1' }).data.levels[0].reqs[0].files[0]; ok(f.driveId); eq(f.size, 3);
  eq(call(admin, 'syncDrive', {}).data.added, 0);
});
t('ผู้รายงานสั่งนำเข้าหรือซิงก์ไม่ได้', () => { err(call(rep, 'importSheet', {}), /เฉพาะแอดมิน/); err(call(rep, 'syncDrive', {}), /เฉพาะแอดมิน/); });

console.log('ความปลอดภัยอื่น ๆ');
t('ใส่รหัสผิด 5 ครั้งบัญชีถูกล็อกชั่วคราว', () => {
  for (let i = 0; i < 5; i++) call(null, 'login', { email: 'rm@example.org', password: 'bad' });
  err(call(null, 'login', { email: 'rm@example.org', password: 'Reporter-RM-01' }), /ล็อกชั่วคราว/);
});
t('รีเซ็ตรหัสผ่านโดยแอดมินปลดล็อกบัญชี', () => {
  const u = G.Db.find('users', x => x.email === 'rm@example.org');
  const r = call(admin, 'resetPassword', { id: u.id }); ok(r.ok);
  ok(call(null, 'login', { email: 'rm@example.org', password: r.data.tempPassword }).data.mustChange);
});
t('ปิดบัญชีแล้ว token เดิมใช้ไม่ได้', () => {
  const u = G.Db.find('users', x => x.email === 'cg@example.org');
  ok(call(admin, 'saveUser', { id: u.id, email: u.email, name: u.name, role: 'reporter', enablers: ['CG'], active: false }).ok);
  ok(call(rep, 'bootstrap', {}).auth);
});
t('ออกจากระบบแล้ว token ใช้ไม่ได้', () => { ok(call(admin, 'logout', {}).ok); ok(call(admin, 'bootstrap', {}).auth); });
t('ข้อผิดพลาดภายในไม่เปิดเผยรายละเอียด', () => {
  const l = call(null, 'login', { email: 'admin@example.org', password: 'Admin-Pass-2569' }).data.token;
  const orig = G.Db.all; G.Db.all = () => { throw new Error('secret internals'); };
  const r = call(l, 'listUsers', {}); G.Db.all = orig;
  ok(!r.ok && !/secret/.test(r.error));
});

console.log(`\n${pass} ผ่าน, ${fail} ไม่ผ่าน`);
process.exit(fail ? 1 : 0);
