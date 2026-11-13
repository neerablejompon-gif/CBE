const U = require('./u'), fs = require('fs'), R = [];
const rec = (id, t, ok, note = '') => { R.push({ id, t, r: ok === null ? 'NOT TESTED' : ok ? 'PASS' : 'FAIL', note }); console.log((ok === null ? 'NT  ' : ok ? 'PASS' : 'FAIL') + ' [' + id + '] ' + t + (note ? ' — ' + note : '')); };
(async () => {
  // reporter sees the return + finding, fixes, resubmits
  let o = await U.start('1005'); let page = o.page; const w = ms => page.waitForTimeout(ms || 1000);
  let t = await o.txt(); await o.shot('H_01returned', true);
  rec('1005', 'ผู้รายงานเห็นสถานะส่งกลับ + ข้อค้นพบ', /ส่งกลับ/.test(t) && /UAT ข้อค้นพบ|คะแนนสูงกว่าหลักฐาน|ข้อค้นพบ/.test(t), (t.match(/[^\n]*ส่งกลับ[^\n]*/) || [''])[0]);
  const p = await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: 'HCM|HCM|1.1|1|self', v: 1 }], log: [] });
  await page.click('[data-act="submit"]'); await w(600); await page.click('[data-act="submit"][data-confirm]'); await w(2500);
  rec('1005', 'ส่งตรวจอีกครั้งหลังแก้ไข', /รอ กปม\. ตรวจ/.test(await o.txt()));
  await o.browser.close();
  // audit: config change (intercepted) + unlock + approve
  o = await U.start('1010', 'กปม'); page = o.page; const cfg = [];
  await o.ctx.route('**/api/save', async r => { const b = r.request().postData() || ''; if (/"s":"cfg"/.test(b)) { cfg.push(b); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); } r.continue(); });
  await page.click('[data-go="config"]'); await w();
  await page.fill('[data-cfg="plan:from"]', '2026-12-20'); await page.fill('[data-cfg="plan:to"]', '2026-12-01'); await page.press('[data-cfg="plan:to"]', 'Tab'); await w(1500);
  await o.shot('A_11cfg_bad'); const ct = await o.txt();
  rec('1010', 'Config: วันปิดก่อนวันเปิดถูกเตือน/ไม่บันทึก', !cfg.some(b => /2026-12-20/.test(b) && /2026-12-01/.test(b)) || /ก่อน|ไม่ถูกต้อง|หลัง/.test(ct), cfg.length + ' cfg save(s) intercepted');
  await page.reload(); await page.waitForSelector('.app'); await w();
  await page.click('[data-go="review"]'); await w(); await page.click('[data-rv="HCM"]'); await w(1200);
  await page.click('[data-act="approve-rv"]'); await w(800); await o.shot('A_12approve');
  const ca = await page.$('[data-act="approve-rv"][data-confirm], [data-act="force-approve"]'); if (ca) { await ca.click(); await w(2500); }
  await page.reload(); await page.waitForSelector('.app'); await w();
  const st = await page.evaluate(() => ({ wf: window.CBE_API.state.wf.HCM, sp: (window.CBE_API.state.patch['SP|SP|1.1|1'] || {}) }));
  rec('1010', 'อนุมัติผล → approved', st.wf === 'approved', st.wf + ' (confirm step: ' + !!ca + ')');
  rec('1010', 'remark ของ กปม. ไม่ไปแก้ผลการดำเนินงานของผู้รายงาน', st.sp.remark === 'UAT remark' && !/กปม\. แก้/.test(st.sp.narrative || ''), (st.sp.narrative || '').slice(0, 40));
  // unlock past month on DT? (self) — use SP level page
  await page.click('[data-go="review"]'); await w(); await page.click('[data-rv="SP"]'); await w(1000);
  await page.click('[data-open="SP|SP|1.1|1"] >> nth=0').catch(() => {}); await w(1200);
  const ul = await page.$('[data-act="unlock-lv"]'); await o.shot('A_13level');
  if (ul) { await ul.click(); await w(2500); const s2 = await o.post('/api/save', { fy: 2570, ops: [], log: [] }); await page.reload(); await page.waitForSelector('.app'); rec('1010', 'ปลดล็อกผลเดือนก่อนหน้า', await page.evaluate(() => !!window.CBE_API.state.unlock['SP|SP|1.1|1'])); }
  else rec('1010', 'ปลดล็อกผลเดือนก่อนหน้า', null, 'ไม่พบปุ่ม unlock-lv บนหน้าระดับ');
  await o.browser.close();
  // reporter on approved indicator cannot edit
  o = await U.start('1005'); page = o.page;
  rec('1005', 'หลังอนุมัติ ผู้รายงานแก้ไม่ได้ (409)', /^409/.test(await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: 'HCM|HCM|1.1|1', v: { narrative: 'x' } }], log: [] })));
  await o.shot('H_02approved'); await o.browser.close();
  fs.appendFileSync(__dirname + '/results.jsonl', R.map(x => JSON.stringify(x)).join('\n') + '\n');
})().catch(e => { console.log('CRASH', e.message.split('\n')[0], (e.stack.match(/a3.js:(\d+)/) || [])[1]); process.exit(1); });
