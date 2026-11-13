// Reporter end-to-end: plan → GAP plan → report 3 steps + GAP → prev-year → submit. env: UID_, ROLE, SUBMIT=1, TAG
const U = require('./u'), fs = require('fs');
const id = process.env.UID_, tag = process.env.TAG || id, R = [];
const rec = (t, ok, note = '') => { R.push({ id, t, r: ok === null ? 'NOT TESTED' : ok ? 'PASS' : 'FAIL', note }); console.log((ok === null ? 'NT  ' : ok ? 'PASS' : 'FAIL') + ' ' + t + (note ? ' — ' + note : '')); };
const REAL = ['SCM|SM|1.1|'];
(async () => {
  const o = await U.start(id, process.env.ROLE || '.'); const { page } = o, w = ms => page.waitForTimeout(ms || 900);
  const saves = []; page.on('response', async r => { if (/\/api\/(save|file)/.test(r.url()) && r.request().method() === 'POST') saves.push(r.status() + ' ' + r.url().split('/api/')[1].slice(0, 60) + ' ' + (await r.text().catch(() => '')).slice(0, 100)); });
  rec('เข้าระบบ', true, o.loginMs + ' ms');
  const me = await page.evaluate(() => ({ role: U.role, ind: U.ind, part: U.part }));
  rec('บทบาท/ตัวชี้วัดถูกต้อง', me.role === 'reporter', JSON.stringify(me));
  await o.shot(tag + '_01home');
  // PLAN
  await page.click('.side >> text=แผนการดำเนินงาน'); await w();
  const picks = await page.$$eval('[data-pick]', a => a.map(x => x.dataset.pick).filter(Boolean));
  const pick = picks.find(p => !REAL.some(r => (p + '|').startsWith(r))); const key = pick; // uid|level
  console.log('level', key, 'of', picks.length);
  
  await page.click(`[data-pick="${pick}"]`); await w();
  await page.fill('#self', '9'); await page.press('#self', 'Tab'); await w(600);
  const selfBad = await page.inputValue('#self'); rec('คะแนนเป้าหมาย 9 (เกิน 5) ถูกปฏิเสธ/ปรับ', selfBad === '' || +selfBad <= 5, 'ค่าหลังกรอก=' + selfBad);
  await page.fill('#self', '3.5'); await page.press('#self', 'Tab'); await w(600);
  await page.click('.drawer [data-act="add-step"][data-kind="st"]'); await w(1200);
  const nm = page.locator('.drawer [data-nm^="st:"]').last(); await nm.fill('UAT ทดสอบ ขั้นตอนแผน 🙂 <b>x</b>'); await nm.press('Tab'); await w(500);
  const sk = (await nm.getAttribute('data-nm')); await page.click(`.drawer [data-mt="${sk}:1"]`); await w(1200);
  await o.shot(tag + '_02plan');
  const planOk = await page.$eval(`.drawer [data-mt="${sk}:1"]`, x => x.getAttribute('aria-pressed') === 'true');
  rec('แผน: เพิ่มขั้นตอน + เลือกเดือน พ.ย.', planOk);
  await page.click('.drawer [data-pick=""]'); await w(400); 
  // GAP
  await page.click('.side >> text=แผนปรับปรุง GAP'); await w();
  const gp = await page.$(`[data-pick="${pick}"]`);
  if (!gp) rec('แผน GAP: ระดับนี้มี GAP', null, 'ระดับนี้ไม่มี GAP');
  else {
    await gp.click(); await w();
    await page.fill('#ac', 'UAT แนวทางปรับปรุงทดสอบ'); await page.press('#ac', 'Tab'); await w(400);
    await page.click('.drawer [data-act="add-step"][data-kind="gs"]'); await w(1200);
    const gn = page.locator('.drawer [data-nm^="gs:"]').last(); await gn.fill('UAT ขั้นตอน GAP'); await gn.press('Tab'); await w(400);
    const gk = await gn.getAttribute('data-nm'); const mt = await page.$(`.drawer [data-mt="${gk}:1"]`);
    if (mt) { await mt.click(); await w(1200); }
    await o.shot(tag + '_03gap'); rec('แผน GAP: แนวทาง + ขั้นตอน + เดือน พ.ย.', !!mt);
    await page.click('.drawer [data-pick=""]'); await w(400);
  }
  // REPORT
  await page.click('.side >> text=แผนการดำเนินงาน'); await w(); await page.click(`[data-pick="${pick}"]`); await w(); await page.click('.drawer [data-open]'); await w(1200);
  const title = await o.txt('.main'); rec('เปิดหน้ารายงานของระดับที่เลือก', title.includes('ระดับ'), pick);
  await page.click('[data-step="0"]'); await w();
  const cu = page.locator('[data-cu^="st:"]').last();
  await cu.fill('-1'); await cu.press('Tab'); await w(600); const neg = await cu.inputValue(); rec('ผลติดลบ -1 ถูกปฏิเสธ/ปรับ', neg === '' || +neg >= 0, 'ค่า=' + neg);
  await cu.fill('1'); await cu.press('Tab'); await w(1000); await o.shot(tag + '_04progress');
  await page.click('[data-step="1"]'); await w();
  await page.fill('#narr', 'UAT ผลการดำเนินงานทดสอบ: ดำเนินการแล้ว 1 ครั้ง (ข้อมูลทดสอบ จะลบหลังทดสอบ) ' + 'ก'.repeat(50)); await page.press('#narr', 'Tab'); await w(1000);
  await page.click('[data-step="2"]'); await w();
  await page.click('[data-mr="0"]'); await w(500); await page.fill('#ev0', 'UAT เอกสารหลักฐานทดสอบ'); await page.press('#ev0', 'Tab'); await w(500);
  const up = async f => { const n0 = saves.length; await page.setInputFiles('#fi0', __dirname + '/' + f); for (let i = 0; i < 30 && saves.slice(n0).every(s => !/^.\d\d file/.test(s)); i++) await w(500); await w(1500); const msg = ((await page.innerText('body')).match(/[^\n]*(ไม่รองรับ|10 MB|ใหญ่เกิน|ขนาด)[^\n]*/) || ['(ไม่มีข้อความแจ้ง)'])[0]; return (saves.slice(n0).find(s => /file/.test(s)) || '(no request)') + ' | ' + msg.slice(0, 80); };
  const r1 = await up('bad.exe'); rec('แนบไฟล์ .exe ถูกปฏิเสธ', !/^200/.test(r1), r1);
  const r2 = await up('big.pdf'); rec('แนบไฟล์ 11 MB ถูกปฏิเสธ', !/^200/.test(r2), r2);
  const r3 = await up('uat-evidence.pdf'); rec('แนบไฟล์ PDF ปกติ', /^200/.test(r3), r3);
  await o.shot(tag + '_05evidence');
  await page.click('[data-step="3"]').catch(() => {}); await w();
  const cg = await page.$('[data-cu^="gs:"]'); if (cg) { await cg.fill('1'); await cg.press('Tab'); await w(800); }
  await page.click('[data-step="4"]').catch(() => {}); await w(600);
  const gnote = await page.$('#gn'); if (gnote) { await gnote.fill('UAT ผลตามแผนปรับปรุง GAP ทดสอบ'); await gnote.press('Tab'); await w(1000); }
  rec('รายงานผลตามแผน GAP (ความคืบหน้า + ผล)', gp ? !!(cg && gnote) : null, gp ? '' : 'ระดับนี้ไม่มี GAP');
  await o.shot(tag + '_06gapreport');
  const pv = await page.$('[data-act="prev-year-lv"]'); if (pv) { await pv.click(); await w(1500); await o.shot(tag + '_07prev'); rec('ดูผลปี 2569', /2569/.test(await page.innerText('body')), ''); await page.keyboard.press('Escape'); await w(400); }
  // persistence
  await page.reload(); await page.waitForSelector('.app', { timeout: 30000 }); await w(1500);
  const st = await page.evaluate(k => JSON.stringify((window.CBE_API.state.patch || {})[k] || null), pick);
  rec('ข้อมูลยังอยู่หลังรีเฟรช', /UAT ผลการดำเนินงาน/.test(st) && /UAT เอกสาร/.test(st), st.slice(0, 80));
  const errs = saves.filter(s => !/^200/.test(s) && !/bad\.exe|big\.pdf/.test(s)); rec('ไม่มี /api/save ล้มเหลว', !errs.length, errs.join(' | '));
  // SUBMIT
  await page.click('.side >> text=งานของฉัน'); await w();
  const home = await o.txt(); rec('หน้างานของฉันแสดงความพร้อม', /พร้อมส่ง \d+ จาก \d+/.test(home), (home.match(/พร้อมส่ง \d+ จาก \d+/) || [''])[0]);
  if (process.env.SUBMIT) {
    await page.click('[data-act="submit"]'); await w(600); await o.shot(tag + '_08confirm');
    await page.click('[data-act="submit"][data-confirm]'); await w(2500); await o.shot(tag + '_09submitted');
    const t = await o.txt(); rec('ส่งตรวจ → สถานะรอ กปม. ตรวจ', /รอ กปม\. ตรวจ/.test(t));
    const p = await o.post('/api/save', { fy: 2570, ops: [{ s: 'patch', k: pick, v: { narrative: 'แก้หลังส่ง' } }], log: [] });
    rec('แก้ไขหลังส่งตรวจถูกปฏิเสธ (409)', /^409/.test(p), p);
  }
  fs.appendFileSync(__dirname + '/results.jsonl', R.map(x => JSON.stringify(Object.assign(x, { key: pick }))).join('\n') + '\n');
  fs.appendFileSync(__dirname + '/written.txt', id + ' ' + pick + '\n' + saves.filter(s => /^200 file/.test(s)).map(s => 'FILE ' + s).join('\n') + '\n');
  console.log('--- errors\n' + o.log.filter(x => /PAGEERR|error/.test(x)).join('\n'));
  await o.browser.close();
})().catch(e => { console.log('CRASH', e.message.split('\n')[0], (e.stack.match(/flow.js:(\d+)/) || [])[1], (e.message.match(/waiting for [^\n]*/) || [''])[0]); process.exit(1); });
