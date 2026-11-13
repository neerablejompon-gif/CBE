const U = require('./u'), fs = require('fs'), R = [];
const rec = (id, t, ok, note = '') => { R.push({ id, t, r: ok === null ? 'NOT TESTED' : ok ? 'PASS' : 'FAIL', note }); console.log((ok === null ? 'NT  ' : ok ? 'PASS' : 'FAIL') + ' [' + id + '] ' + t + (note ? ' — ' + note : '')); };
(async () => {
  const o = await U.start('1004'); const { page } = o, w = ms => page.waitForTimeout(ms || 1000);
  await page.click('.side >> text=รายงานผลตามเกณฑ์'); await w(); await page.click('[data-step="1"]'); await w();
  const before = await page.inputValue('#narr');
  for (const mode of ['guide', 'gaps']) {
    const t0 = Date.now();
    const [resp] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/ai/write'), { timeout: 90000 }), page.click(`[data-act="aiw-run"][data-mode="${mode}"]`)]);
    const j = await resp.json().catch(() => ({})); await w(1500); await o.shot('W_' + mode);
    rec('1004', 'ผู้ช่วยเขียน: ' + mode, resp.status() === 200 && !!(j.text || j.out || j.result), resp.status() + ' · ' + (Date.now() - t0) + ' ms · ' + (j.model || j.via || '') + ' · ' + JSON.stringify(j).slice(0, 120));
    if (mode === 'guide') {
      const use = await page.$('[data-act="aiw-use"]'); if (use) { await use.click(); await w(1200); }
      const after = await page.inputValue('#narr'); rec('1004', 'ใช้ร่างจาก AI แทนข้อความเดิม', after !== before && after.length > 20, after.slice(0, 60));
      const home = /【ระบุ】/.test(after); console.log('มี 【ระบุ】:', home);
      const undo = await page.$('[data-act="aiw-undo"]'); if (undo) { await undo.click(); await w(1500); rec('1004', 'ย้อนกลับร่าง AI ได้', (await page.inputValue('#narr')) === before); } else rec('1004', 'ย้อนกลับร่าง AI ได้', null, 'ไม่พบปุ่ม');
    }
  }
  fs.appendFileSync(__dirname + '/results.jsonl', R.map(x => JSON.stringify(x)).join('\n') + '\n');
  console.log(o.log.filter(x => /error|PAGEERR/.test(x)).join('\n')); await o.browser.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0], (e.stack.match(/w1.js:(\d+)/) || [])[1]); process.exit(1); });
