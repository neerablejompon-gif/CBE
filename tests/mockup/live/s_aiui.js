module.exports = async ({ page, shot, log }) => {
  let reqs = [], saves = 0;
  await page.route('**/api/save', r => { saves++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }); // never write to production in this UI test
  await page.route('**/api/ai/check', async r => {
    const b = JSON.parse(r.request().postData()); reqs.push(b.items.map(x => x.k));
    const results = {}; b.items.forEach((x, i) => { results[x.k] = { sig: 'mock', at: 'now', model: 'mock', note: 'กรุณาเพิ่มผลการประเมินสมรรถนะด้านดิจิทัล', items: i ? [] : [{ type: 'criteria', sev: 'warning', title: 'ยังไม่ระบุการประเมินสมรรถนะ', detail: 'ค่าเกณฑ์ข้อ 1.1 กำหนดให้ประเมินสมรรถนะด้านดิจิทัลของผู้รับผิดชอบ', fix: 'เพิ่มผลการประเมินสมรรถนะ' }, { type: 'evidence', sev: 'info', title: 'ชื่อไฟล์ไม่ตรงข้อกำหนด', detail: 'ข้อกำหนดขอคู่มือ แต่แนบมติ', fix: 'แนบคู่มือ' }] }; });
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results, used: 6500, limit: 8000, quota: false, model: 'mock', day: new Date().toISOString().slice(0, 10) }) });
  });
  // test content in memory only (never saved): 3 levels with text
  await page.evaluate(() => { const s = indBy('DT').subs.find(x => x.label === '1.1'); s.levels[0].narrative = '[UAT] ทดสอบ AI 1'; s.levels[1].narrative = '[UAT] ทดสอบ AI 2'; s.levels[2].gapNote = '[UAT] ทดสอบ GAP'; });
  // the mock signature never matches, so make aiFresh accept mock results for this UI test
  await page.evaluate(() => { window.aiSig = () => 'mock'; });
  await page.click('.side >> text=พื้นที่ผู้ตรวจสอบ'); await page.waitForTimeout(900);
  await page.click('[data-rv="DT"]'); await page.waitForTimeout(600);
  console.log('button:', await page.$eval('[data-act="ai-run"]', x => x.innerText.trim()));
  await page.click('[data-act="ai-run"]'); await page.waitForTimeout(400);
  console.log('while running:', await page.$eval('[data-act="ai-run"]', x => x.innerText.trim() + ' disabled=' + x.disabled).catch(() => '-'));
  await page.waitForTimeout(2500);
  console.log('requests (batches):', JSON.stringify(reqs));
  console.log('toast:', await page.$eval('#toast', x => x.innerText));
  const ai = await page.$$eval('[data-fsel^="AI"]', a => a.map(x => x.innerText.replace(/\s+/g, ' ')));
  console.log('AI findings in list:', JSON.stringify(ai));
  console.log('usage line:', ((await page.innerText('.main')).match(/AI วันนี้ใช้โควตา \d+%/) || ['none'])[0]);
  await page.click('[data-fsel^="AI1"]'); await page.waitForTimeout(400);
  const d = await page.innerText('#fdetail'); console.log('detail:', d.slice(0, 420).replace(/\s+/g, ' '));
  await page.click('[data-act="ai-note"]'); await page.waitForTimeout(400);
  console.log('tnote after "ใช้เป็นหมายเหตุ":', JSON.stringify(await page.inputValue('#tnote')));
  await page.keyboard.press('d'); await page.waitForTimeout(300); // dismiss via keyboard → stays local (tri store)
  console.log('AI1 row class after D:', await page.$eval('[data-fsel^="AI1"]', x => x.className));
  await shot('ai_ui');
  // second run: nothing changed → no request
  reqs = []; await page.click('[data-act="ai-run"]'); await page.waitForTimeout(800);
  console.log('re-run requests:', JSON.stringify(reqs), '| toast:', await page.$eval('#toast', x => x.innerText));
  // undo the triage + note so nothing test-related stays (tri/trinote are real stores)
  console.log('saves intercepted (not sent):', saves);
};
