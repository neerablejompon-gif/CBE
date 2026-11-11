module.exports = async ({ page, shot }) => {
  console.log('new build loaded:', (await page.content()).includes('confirmSubmit'));
  await page.click('.side >> text=งานของฉัน'); await page.waitForTimeout(800);
  let t = await page.innerText('.main'); console.log('home:', (t.match(/พร้อมส่ง[^\n]*/) || [''])[0]);
  const late = t.indexOf('ผลยังไม่ครบตามแผน'); console.log('late group:', late < 0 ? 'none' : t.slice(late - 4, late + 120).replace(/\s+/g, ' '));
  await page.click('[data-act="submit"]'); await page.waitForTimeout(600);
  t = await page.innerText('.main'); const i = t.indexOf('ส่งรายงานเดือน'); console.log('confirm box:', i < 0 ? 'NONE' : t.slice(i, i + 200).replace(/\s+/g, ' '));
  await shot('fix_submit_confirm');
  console.log('status still draft/returned:', (t.match(/ส่งกลับแก้ไข|ฉบับร่าง|รอ กปม. ตรวจ/) || [''])[0]);
  await page.click('[data-act="cancel-submit"]'); await page.waitForTimeout(500);
  console.log('after cancel, submit btn back:', !!(await page.$('[data-act="submit"]:not([data-confirm])')));
};
