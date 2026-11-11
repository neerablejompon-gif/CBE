const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'https://cbe-report.pages.dev/';
const SS = __dirname + '/state' + (process.env.UID_ || '') + '.json';
exports.open = async (opts = {}) => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.vp || { width: 1440, height: 900 }, storageState: fs.existsSync(SS) && !opts.fresh ? SS : undefined, locale: 'th-TH' });
  if (process.env.NEW) await ctx.route(u => u.hostname === 'cbe-report.pages.dev' && (u.pathname === '/' || u.pathname === '/index.html'),
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(require('path').join(__dirname, '..', '..', '..', 'mockup', 'index.html'), 'utf8') }));
  const page = await ctx.newPage();
  const log = [];
  page.on('pageerror', e => log.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.push(m.type() + ' ' + m.text()); });
  page.on('response', r => { if (r.url().includes('/api/')) log.push('API ' + r.request().method() + ' ' + r.url().replace(URL, '/') + ' ' + r.status()); });
  page.on('dialog', d => { log.push('DIALOG ' + d.message()); d.accept(); });
  return { browser, ctx, page, log, save: () => ctx.storageState({ path: SS }), URL };
};
