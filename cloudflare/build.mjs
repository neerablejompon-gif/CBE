// สร้างไฟล์สำหรับ Cloudflare จากโค้ดชุดเดียวกับ Apps Script (src/)
//   worker/gen/core.js  : ตรรกะฝั่งเซิร์ฟเวอร์ทั้งหมด (src/*.gs) ห่อเป็นโมดูล รับบริการแบบ Apps Script ผ่านพารามิเตอร์
//   pages/dist/         : หน้าเว็บ (index.html + app.js) ที่เรียก /api แทน google.script.run
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');
const read = f => fs.readFileSync(path.join(src, f), 'utf8');
const SERVICES = ['SpreadsheetApp', 'DriveApp', 'CacheService', 'PropertiesService', 'LockService', 'Utilities', 'HtmlService'];

export function coreSource() {
  const files = fs.readdirSync(src).filter(f => f.endsWith('.gs')).sort();
  const code = files.map(f => `// ---- ${f}\n${read(f)}`).join('\n');
  const names = [...new Set([...code.matchAll(/^(?:function|var) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]))];
  return `// สร้างโดย cloudflare/build.mjs จาก src/*.gs ห้ามแก้ไฟล์นี้โดยตรง
export function makeCore(G) {
  'use strict';
  var ${SERVICES.map(s => `${s} = G.${s}`).join(', ')};
  var console = { log: function () { G.console.log.apply(G.console, arguments); }, warn: function () { G.console.warn.apply(G.console, arguments); }, error: function () { G.console.error.apply(G.console, arguments); } };
${code}
  return { ${names.map(n => `${n}: ${n}`).join(', ')} };
}
`;
}

function pages() {
  const inc = n => read(n + '.html');
  let html = inc('Index').replace(/<\?!= include\('(\w+)'\); \?>/g, (m, n) => inc(n));
  const scripts = [];
  // ย้ายสคริปต์ inline ออกเป็น app.js เพื่อใช้ CSP แบบ script-src 'self'
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => { scripts.push(body); return ''; });
  const shim = fs.readFileSync(path.join(here, 'pages', 'client-shim.js'), 'utf8');
  html = html.replace('</body>', () => '<script src="app.js"></script>\n</body>')
    .replace('<base target="_top">\n', '')
    .replace('<title>CBE Reporting</title>', '<title>CBE Reporting · ระบบรายงานผล Core Business Enablers</title>');
  const out = path.join(here, 'pages', 'dist');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, 'app.js'), shim + '\n' + scripts.join('\n;\n'));
  fs.copyFileSync(path.join(here, 'pages', '_headers'), path.join(out, '_headers'));
}

fs.mkdirSync(path.join(here, 'worker', 'gen'), { recursive: true });
fs.writeFileSync(path.join(here, 'worker', 'gen', 'core.js'), coreSource());
pages();
console.log('build: worker/gen/core.js และ pages/dist/ พร้อมแล้ว');
