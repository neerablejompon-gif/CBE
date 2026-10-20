// เซิร์ฟเวอร์ทดสอบในเครื่อง: เสิร์ฟ pages/dist และ /api ผ่าน worker engine + Google API จำลอง
// ใช้: node test/e2e-server.mjs        → รันชุดทดสอบหน้าจอ (tests/e2e.js) กับเซิร์ฟเวอร์นี้แล้วปิด
//      node test/e2e-server.mjs --serve → เปิดค้างไว้ที่ http://localhost:8788 (บัญชีทดลองดูใน seed)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGoogle } from '../worker/src/google.js';
import { createEngine } from '../worker/src/engine.js';
import { createFakeGoogle, fakeServiceAccount } from './fake-google.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'pages', 'dist');
const sa = await fakeServiceAccount();
const mem = new Map();
const store = { async get(k) { const v = mem.get(k); return v && v.exp > Date.now() ? v.v : null; }, async put(k, v, ttl) { mem.set(k, { v, exp: Date.now() + ttl * 1000 }); }, async remove(k) { mem.delete(k); } };
let engine;

/** สร้างข้อมูลทดลองใหม่ทั้งหมด (แบบเดียวกับ dev/harness.html) */
async function seed() {
  const fake = createFakeGoogle();
  fake.addBook('db', { Sheet1: [] });
  fake.addFolder('1HivoxPWFgQ3DH5ZmNOqYZshCUh59_VGN', 'Core Business Enablers 2569', null);
  let logs = '';
  engine = createEngine({ google: createGoogle(sa, fake.fetch), store, props: { DB_SPREADSHEET_ID: 'db', ADMIN_EMAIL: 'admin@demo.local' }, log: (lv, t) => { logs += t + '\n'; if (lv === 'error') console.error(t); } });
  await engine.setup();
  const tmp = /รหัสผ่านชั่วคราว: (\S+)/.exec(logs)[1];
  const must = r => { if (!r.ok) throw new Error(r.error); return r.data; };
  const t = must(await engine.api(null, 'login', { email: 'admin@demo.local', password: tmp })).token;
  must(await engine.api(t, 'changePassword', { oldPw: tmp, newPw: 'Admin-Demo-2569' }));
  const u = must(await engine.api(t, 'saveUser', { email: 'sp@demo.local', name: 'สมชาย ใจดี', role: 'reporter', enablers: ['SP', 'RM'] }));
  must(await engine.api(t, 'saveEnabler', { code: 'SP', owner: 'ฝ่ายยุทธศาสตร์', budget: '-', target: 2.242 }));
  const rt = must(await engine.api(null, 'login', { email: 'sp@demo.local', password: u.tempPassword })).token;
  must(await engine.api(rt, 'changePassword', { oldPw: u.tempPassword, newPw: 'Report-Demo-2569' }));
  must(await engine.api(rt, 'saveStep', { key: 'SP-1.1', level: 1, step: 'จัดทำแผนยุทธศาสตร์และเสนอคณะกรรมการ', gap: 'ยังไม่มีการทบทวนแผนประจำปี', unit: 'ครั้ง', target: 4, plan: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] }));
  must(await engine.api(rt, 'addRequirement', { key: 'SP-1.1', level: 1, text: 'เอกสารประกอบที่ 1 มติคณะกรรมการ' }));
  must(await engine.api(rt, 'setSelfScore', { key: 'SP-1.1', score: 1.5 }));
  must(await engine.api(rt, 'saveActivity', { sub: 'SP-1.1', lv: 2, name: 'ทบทวนแผนกลางปี', s: 1, e: 3, p: 20, out: 'รายงานการทบทวน' }));
  mem.clear();
}
await seed();

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
let queue = Promise.resolve();
const server = http.createServer((req, res) => {
  if (req.url === '/__reset' && req.method === 'POST') {
    queue = queue.then(seed).then(() => { res.writeHead(204); res.end(); });
    return;
  }
  if (req.url === '/api') {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      queue = queue.then(async () => {
        try {
          const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const r = await engine.api(b.token || null, b.action, b.payload || {});
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
        } catch (e) { console.error(e); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"error"}'); }
      });
    });
    return;
  }
  const f = path.join(dist, req.url === '/' ? 'index.html' : path.normalize(req.url).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  // ใช้ CSP เดียวกับ _headers เพื่อจับปัญหา inline script
  const csp = /Content-Security-Policy: (.*)/.exec(fs.readFileSync(path.join(dist, '_headers'), 'utf8'))[1];
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Content-Security-Policy': csp });
  fs.createReadStream(f).pipe(res);
});
server.listen(8788, () => {
  console.log('http://localhost:8788');
  if (process.argv.includes('--serve')) return;
  const p = spawn(process.execPath, [path.join(here, '..', '..', 'tests', 'e2e.js')], { stdio: 'inherit', env: { ...process.env, E2E_URL: 'http://localhost:8788/', E2E_RESET: 'http://localhost:8788/__reset' } });
  p.on('exit', code => { server.close(); process.exit(code); });
});
