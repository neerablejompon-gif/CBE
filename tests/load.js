// โหลดไฟล์ .gs ทั้งหมดพร้อมบริการจำลองเข้า context เดียว เหมือนสภาพแวดล้อม Apps Script
// CORE=gen ใช้ cloudflare/worker/gen/core.js (โค้ดชุดเดียวกันที่ห่อเป็นโมดูล strict mode สำหรับ Worker)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function load() {
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-mock.js'), 'utf8'), ctx);
  if (process.env.CORE === 'gen') {
    const code = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'worker', 'gen', 'core.js'), 'utf8').replace(/^export /m, '');
    vm.runInContext(code + '\nObject.assign(globalThis, makeCore(globalThis));', ctx, { filename: 'core.js' });
    return ctx;
  }
  const dir = path.join(__dirname, '..', 'src');
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
};
