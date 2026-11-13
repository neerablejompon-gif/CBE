const U = require('./u'), fs = require('fs'), R = [];
const rec = (id, t, ok, note = '') => { R.push({ id, t, r: ok === null ? 'NOT TESTED' : ok ? 'PASS' : 'FAIL', note }); console.log((ok === null ? 'NT  ' : ok ? 'PASS' : 'FAIL') + ' [' + id + '] ' + t + (note ? ' — ' + note : '')); };
(async () => {
  let o, page; if (0) { const w = ms => page.waitForTimeout(ms || 1000);   rec('1020', 'ผู้บริหารเข้าระบบ', true, o.loginMs + ' ms'); await w(1500); await o.shot('E_01dash', true);
  const t = await o.txt(); const canv = await page.$$eval('canvas, svg', a => a.length);
  rec('1020', 'Dashboard แสดงกราฟ', canv >= 4, canv + ' กราฟ/ภาพ');
  rec('1020', 'ไม่มีปุ่มแก้ไข/ส่งตรวจ/อนุมัติ', !(await page.$('[data-act="submit"], [data-act="approve-rv"], [data-act="pedit"], textarea')));
  rec('1020', 'server ปฏิเสธการบันทึก (403)', /^403/.test(await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: 'DT|DT|1.1|1', v: { remark: 'x' } }], log: [] })));
  rec('1020', 'server ปฏิเสธ AI ช่วยตรวจ', /^40/.test(await o.post('/api/ai/check', { fy: 2570, items: [] })));
  rec('1020', 'server ปฏิเสธผู้ช่วยเขียน', /^40/.test(await o.post('/api/ai/write', { fy: 2570, k: 'DT|DT|1.1|1', mode: 'draft' })));
  console.log('SIDE', (await o.txt('.side')).replace(/\n/g, ' | ').slice(0, 300));
  }
  // mobile + dark
  for (const [id, re, tag] of [['1004', '.', 'IA'], ['1010', 'กปม', 'A']]) {
    o = await U.start(id, re, { vp: { width: 390, height: 844 }, dark: true }); page = o.page; await page.waitForTimeout(1500);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await o.shot(tag + '_m_home'); rec(id, 'มือถือ 390px + ธีมมืด: ไม่มีเลื่อนแนวนอน', ov <= 1, 'ล้น ' + ov + 'px');
    const bg = await page.evaluate(() => { const a = getComputedStyle(document.body).backgroundColor; return /rgba\(0, 0, 0, 0\)/.test(a) ? getComputedStyle(document.documentElement).backgroundColor : a; }); rec(id, 'ธีมมืดใช้พื้นเข้ม', /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && bg.match(/\d+/g).slice(0, 3).every(n => +n < 80), bg);
    if (id === '1004') { await page.locator('text=รายงานผล').locator('visible=true').last().click(); await page.waitForTimeout(1200); await o.shot('IA_m_report'); const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); rec(id, 'มือถือ: หน้ารายงานผลไม่ล้นจอ', ov2 <= 1, 'ล้น ' + ov2 + 'px'); }
    await o.browser.close();
  }
  fs.appendFileSync(__dirname + '/results.jsonl', R.map(x => JSON.stringify(x)).join('\n') + '\n');
})().catch(e => { console.log('CRASH', e.message.split('\n')[0], (e.stack.match(/e1.js:(\d+)/) || [])[1]); process.exit(1); });
