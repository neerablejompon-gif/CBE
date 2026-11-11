const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, Response, URL, crypto, TextEncoder, TextDecoder });
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'mockup', '_worker.js'), 'utf8').replace('export default {', 'var __default = {'), ctx);
const E = o => { const r = Array(40).fill(''); Object.entries(o).forEach(([k, v]) => r[k] = v); return r; };
// CG layout: header row 8 (index 7), months at O..Z (14..25), narr AG(32) MR AH(33) tick AI(34) ev AJ(35) remark AK(36)
const head = ['ลำดับ','ระดับ','ค่าเกณฑ์วัดตาม SE-AM','','','','','วิเคราะห์ GAP','ขั้นตอนการดำเนินงาน','น้ำหนัก','เป้าหมาย','ถ่วงน้ำหนัก','หน่วยนับ','แผนผล', ...Array(18).fill(''), 'รายละเอียดผลการดำเนินงานตามแผนการดำเนินงาน','Mininum Requirement ตามที่ สคร.','ถ้ามีเอกสารให้ติ๊กถูก','ชื่อหลักฐานประกอบผลการดำเนินงาน','ข้อสังเกตของ กปม.'];
const rows = [['title'], [], [], [], [], [], ['ติดตาม'], head, [],
  E({ 0: '1', 1: 'การตอบสนองบทบาทภาครัฐ' }),
  E({ 0: '1.1', 1: 'การรายงานผล' }),
  E({ 1: 'ระดับที่ 1 ', 13: 'แผน', 23: '  1.00 ', 32: 'ผลระดับ 1', 33: 'MR ข้อ 1', 34: 'TRUE', 35: 'หลักฐาน 1' }),
  E({ 13: 'ผล', 24: '  1.00 ', 33: '' }),
  E({ 33: 'เอกสารประกอบอื่น (ถ้ามี)', 34: 'TRUE', 35: ' 1.แจ้งเวียน', 36: 'ข้อสังเกต x' }),
  E({ 1: 'ระดับ 2 ', 13: 'แผน', 15: '1.00', 32: 'ผลระดับ 2' }),
  E({ 0: '1.2', 1: 'ประเด็นถัดไป' }),
  E({ 1: 'ระดับ 1', 32: 'ผล 1.2' })];
const g = JSON.parse(JSON.stringify(vm.runInContext('parseGuide', ctx)(rows)));
assert.deepStrictEqual(Object.keys(g), ['1.1|1', '1.1|2', '1.2|1']);
assert.strictEqual(g['1.1|1'].narr, 'ผลระดับ 1'); assert.strictEqual(g['1.1|1'].mr.length, 2); assert.deepStrictEqual(g['1.1|1'].mr[1], ['เอกสารประกอบอื่น (ถ้ามี)', true, '1.แจ้งเวียน']);
assert.strictEqual(g['1.1|1'].remark, 'ข้อสังเกต x'); assert.strictEqual(g['1.1|1'].plan[9], 1); assert.strictEqual(g['1.1|1'].res[10], 1);
assert.strictEqual(g['1.1|2'].plan[1], 1); assert.strictEqual(g['1.2|1'].narr, 'ผล 1.2');
console.log('✓ CG layout: sub-issues, "ระดับที่ 1"/"ระดับ 2", narrative, MR tick+name, remark, plan/result rows');
// DT layout: no plan columns, narr at H
const dt = [[], [], [], [], [], [], ['ติดตาม'], ['ลำดับ','ระดับ','ค่าเกณฑ์วัดตาม SE-AM','','','','','รายละเอียดผลการดำเนินงานตามแผนการดำเนินงาน','Mininum Requirement ตามที่ สคร.','ถ้ามีเอกสารให้ติ๊กถูก','ชื่อหลักฐานประกอบผลการดำเนินงาน','หมายเหตุ'],
  ['1.1', 'x'], ['', 'ระดับ 1', 'เกณฑ์', '', '', '', '', 'ผล DT', 'MR', 'FALSE', 'ชื่อ']];
const d = JSON.parse(JSON.stringify(vm.runInContext('parseGuide', ctx)(dt)));
assert.deepStrictEqual(d['1.1|1'], { narr: 'ผล DT', mr: [['MR', false, 'ชื่อ']], remark: '', plan: null, res: null, crit: 'เกณฑ์' }); console.log('✓ DT layout (no plan columns)');
// HCM: evidence under "หมายเหตุ" right after the tick column
const hc = [['ลำดับ','ระดับ','c','','','','','','','','','','','','','รายละเอียดผลการดำเนินงานตามแผนการดำเนินงาน','Mininum Requirement ตามที่ สคร.','ถ้ามีเอกสารให้ติ๊กถูก','หมายเหตุ','ข้อสังเกตจาก กปม.','หมายเหตุ'], ['1.1'], ['', 'ระดับ 1', '', '', '', '', '', '', '', '', '', '', '', '', '', 'n', 'mr', 'TRUE', 'ไฟล์ HCM', 'rm']];
const hh = JSON.parse(JSON.stringify(vm.runInContext('parseGuide', ctx)(hc)));
assert.deepStrictEqual(hh['1.1|1'].mr, [['mr', true, 'ไฟล์ HCM']]); assert.strictEqual(hh['1.1|1'].remark, 'rm'); console.log('✓ HCM evidence names under "หมายเหตุ"');
console.log('ALL PASS');
