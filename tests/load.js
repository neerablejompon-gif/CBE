// โหลดไฟล์ .gs ทั้งหมดพร้อมบริการจำลองเข้า context เดียว เหมือนสภาพแวดล้อม Apps Script
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function load() {
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-mock.js'), 'utf8'), ctx);
  const dir = path.join(__dirname, '..', 'src');
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
};
