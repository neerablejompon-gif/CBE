module.exports = async ({ page, shot }) => {
  let saves = 0, sent = null;
  await page.route('**/api/save', r => { saves++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.route('**/api/ai/write', async r => { sent = JSON.parse(r.request().postData()); await new Promise(z => setTimeout(z, 600));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: sent.mode, model: 'mock', left: 39, draft: '1. กยท. กำหนดกรอบทิศทางการกำกับดูแลด้านดิจิทัล โดยคณะกรรมการ DT ครั้งที่ 【ระบุครั้งที่】 เมื่อ 【ระบุวันที่】\n2. แจ้งเวียนส่วนงานถือปฏิบัติ (หลักฐาน: มติคณะกรรมการ)', items: [{ item: 'กรอบทิศทางการกำกับดูแล', status: 'covered', note: '' }, { item: 'การสื่อสารให้ถือปฏิบัติ', status: 'partial', note: 'ยังไม่ระบุช่องทาง' }, { item: 'การทบทวน', status: 'missing', note: 'ไม่มีข้อมูล' }], tips: ['แนบมติคณะกรรมการที่ลงนาม'] }) }); });
  await page.evaluate(() => { API.write = true; render(); });
  await page.click('.side >> text=รายงานผลตามเกณฑ์'); await page.waitForTimeout(700); await page.click('[data-level="0"]'); await page.waitForTimeout(400); await page.click('[data-step="1"]'); await page.waitForTimeout(1200);
  const st = () => page.$$eval('[data-act="aiw-run"]', a => a.map(b => b.innerText.trim() + (b.disabled ? '(ปิด)' : '')).join(' | '));
  console.log('empty box buttons:', await st());
  await page.fill('#narr', 'จัดประชุมคณะกรรมการ DT อนุมัติกรอบกำกับดูแล แจ้งเวียนแล้ว'); await page.waitForTimeout(400);
  console.log('after typing:', await st());
  await page.click('[data-act="aiw-run"][data-mode="draft"]'); await page.waitForTimeout(200);
  console.log('busy:', (await page.innerText('.aiw')).includes('กำลังเรียบเรียง'));
  await page.waitForSelector('.aiw-draft'); console.log('sent:', JSON.stringify({ mode: sent.mode, k: sent.k, hasCrit: !!sent.crit, narr: sent.narr.slice(0, 20), ev: sent.ev }));
  console.log('items:', (await page.innerText('.aiw-items')).replace(/\s+/g, ' '), '| marks:', await page.$$eval('.aiw-draft mark.ph', a => a.length));
  await shot('aiw_result'); const pnl = await page.$('.aiw'); await pnl.screenshot({ path: 'aiw_panel.png' });
  await page.click('[data-act="aiw-use"]'); await page.waitForTimeout(500);
  console.log('narr now:', JSON.stringify((await page.inputValue('#narr')).slice(0, 50)), '| undo shown:', !!(await page.$('[data-act="aiw-undo"]')));
  console.log('readiness issue:', await page.evaluate(() => { const c = curLv(); return JSON.stringify(lvIssues(c.L, S.month, true)); }));
  await page.click('[data-act="aiw-undo"]'); await page.waitForTimeout(400);
  console.log('after undo:', JSON.stringify((await page.inputValue('#narr')).slice(0, 30)));
  // guide mode uses last year's text
  await page.click('[data-act="aiw-run"][data-mode="guide"]'); await page.waitForSelector('.aiw-draft');
  console.log('guide mode sent prev:', sent.mode, (sent.prev || '').length, 'chars');
  await page.fill('#narr', ''); await page.waitForTimeout(300);
  console.log('saves intercepted (not sent):', saves);
};
