// parseForm fills missing levels; mirror skips them
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, Response, Request, URL, URLSearchParams, crypto, TextEncoder, TextDecoder, atob, btoa });
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'mockup', '_worker.js'), 'utf8').replace('export default {', 'var __default = {'), ctx);
const row = o => { const r = []; for (const [c, v] of Object.entries(o)) r[[...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1] = v; return r; };
const rows = [[], [], [], [], [], row({ A: '1.1', B: 'ชื่อ (น้ำหนัก 3)' }), row({ A: '1.1', B: 'ระดับ 2', C: 'เกณฑ์ 2', F: 'แผน' }), row({ F: 'ผล' }), row({ A: '1.1', B: 'ระดับ 5', C: 'เกณฑ์ 5', F: 'แผน' }), row({ F: 'ผล' })];
const f = vm.runInContext('parseForm', ctx)([], rows);
assert.strictEqual(JSON.stringify(f.subs[0].levels.map(l => l.level)), '[1,2,3,4,5]');
assert.strictEqual(f.subs[0].levels[0].row, null); assert.strictEqual(f.subs[0].levels[1].row, 7);
console.log('✓ missing levels 1/3/4 added with no sheet row:', f.subs[0].levels.map(l => l.level + ':' + (l.criteria || '-') + '@' + l.row).join(' '));
console.log('ALL PASS');
