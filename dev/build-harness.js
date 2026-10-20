// สร้าง dev/harness.html: รันหน้าเว็บจริงพร้อมเซิร์ฟเวอร์จำลองในเบราว์เซอร์ (ไม่ต้องใช้ Google)
// ใช้: node dev/build-harness.js แล้วเปิด dev/harness.html  (บัญชีทดลองอยู่ใน seed ด้านล่าง ใช้เฉพาะ dev)
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(f, 'utf8');
const gs = fs.readdirSync(src).filter(f => f.endsWith('.gs')).sort().map(f => read(path.join(src, f))).join('\n;\n');
const mock = read(path.join(__dirname, '..', 'tests', 'gas-mock.js'));
const seed = `
DriveApp._root('1HivoxPWFgQ3DH5ZmNOqYZshCUh59_VGN', 'Core Business Enablers 2569');
PropertiesService.getScriptProperties().setProperty('ADMIN_EMAIL', 'admin@demo.local');
setup();
var adm = Db.find('users', function (u) { return u.email === 'admin@demo.local'; });
adm.name = 'ผู้ดูแล กปม.'; Db.update('users', adm, { name: 'ผู้ดูแล กปม.' });
Auth.setPassword(adm, 'Admin-Demo-2569', false);
var t = Auth.login('admin@demo.local', 'Admin-Demo-2569').token;
var r = api(t, 'saveUser', { email: 'sp@demo.local', name: 'สมชาย ใจดี', role: 'reporter', enablers: ['SP', 'RM'] });
Db.reset(); Auth.setPassword(Db.find('users', function (u) { return u.email === 'sp@demo.local'; }), 'Report-Demo-2569', false);
var rt = Auth.login('sp@demo.local', 'Report-Demo-2569').token;
var k = 'SP-' + Db.find('subtopics', function (s) { return s.enabler === 'SP'; }).no;
api(rt, 'saveStep', { key: k, level: 1, step: 'จัดทำแผนยุทธศาสตร์และเสนอคณะกรรมการ', gap: 'ยังไม่มีการทบทวนแผนประจำปี', unit: 'ครั้ง', target: 4, plan: [1,0,0,1,0,0,1,0,0,1,0,0] });
var lv = api(rt, 'addRequirement', { key: k, level: 1, text: 'เอกสารประกอบที่ 1 มติคณะกรรมการ' });
api(rt, 'setSelfScore', { key: k, score: 1.5 });
api(rt, 'saveActivity', { sub: k, lv: 2, name: 'ทบทวนแผนกลางปี', s: 1, e: 3, p: 20, out: 'รายงานการทบทวน' });
api(t, 'saveEnabler', { code: 'SP', owner: 'ฝ่ายยุทธศาสตร์', budget: '-', target: 2.242 });
`;
const shim = `
window.google = { script: { get run() {
  var ok = function () {}, bad = function () {};
  var o = { withSuccessHandler: function (f) { ok = f; return o; }, withFailureHandler: function (f) { bad = f; return o; },
    api: function (tok, a, p) { setTimeout(function () { try { ok(JSON.parse(JSON.stringify(api(tok, a, JSON.parse(JSON.stringify(p)))))); } catch (e) { console.error(e); bad(e); } }, 30); } };
  return o; } } };`;
const inc = n => read(path.join(src, n + '.html'));
let html = inc('Index').replace(/<\?!= include\('(\w+)'\); \?>/g, (m, n) => inc(n));
html = html.replace('<body>', () => '<body>\n<script>' + mock + '\n' + gs + '\n' + seed + '\n' + shim + '</script>');
if (!html.includes('<body>')) throw new Error('Index.html ไม่มี <body>');
fs.writeFileSync(path.join(__dirname, 'harness.html'), html);
console.log('เขียน dev/harness.html แล้ว (' + Math.round(html.length / 1024) + ' KB)');
