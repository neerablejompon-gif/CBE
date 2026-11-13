// UAT helpers: login as id (+ role label regex), returns page; evidence into uat/
const L = require('../lib');
exports.start = async (id, roleRe, opts = {}) => {
  const o = await L.open({ fresh: true, vp: opts.vp });
  const { page } = o;
  if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(o.URL); await page.waitForSelector('#loginForm');
  await page.fill('#em', id); await page.fill('#pw', 'cbe@' + id);
  const t0 = Date.now(); await page.click('.lg-btn');
  await page.waitForSelector('.app, [data-role-login]', { timeout: 30000 });
  if (await page.$('[data-role-login]')) {
    const r = await page.$$eval('[data-role-login]', (a, re) => a.find(b => new RegExp(re).test(b.innerText)).dataset.roleLogin, roleRe);
    await page.click(`[data-role-login="${r}"]`); await page.waitForSelector('.app', { timeout: 30000 });
  }
  o.loginMs = Date.now() - t0; await page.waitForTimeout(800);
  o.shot = (n, full) => page.screenshot({ path: __dirname + '/' + n + '.png', fullPage: !!full });
  o.post = (url, body) => page.evaluate(async ([u, b]) => { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return r.status + ' ' + (await r.text()).slice(0, 120); }, [url, body]);
  o.txt = async (sel = '.main') => (await page.innerText(sel)).replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');
  return o;
};
