module.exports = async ({ page, log }) => {
  const sc = process.env.SC || 'light', mob = !!process.env.VP, tag = sc + (mob ? '_m' : '');
  await page.emulateMedia({ colorScheme: sc }); await page.reload(); await page.waitForSelector('.app'); await page.waitForTimeout(900);
  const ov = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(tag, 'role:', await page.evaluate(() => U.role), '| empty-state charts:', await page.$$eval('.vz-row', a => a.length), '| overflow', await ov());
  // sample data in memory only (no save): plans/results/evidence for every level
  await page.evaluate(() => { let k = 7; const rnd = () => (k = (k * 9301 + 49297) % 233280) / 233280;
    INDS.forEach(I => { I.target = I.target != null ? I.target : 2 + rnd() * 2; I.subs.forEach(s => s.levels.forEach(L => {
      const plan = Array(12).fill(0), res = Array(12).fill(0), mo = Math.floor(rnd() * 12); plan[mo] = 1; if (mo <= S.month && rnd() > .35) res[mo] = 1; else if (mo > S.month && rnd() > .85) res[S.month] = 1;
      L.steps = [{ name: 'x', unit: 'ครั้ง', target: 1, plan, result: res }]; L.narrative = rnd() > .4 ? 'x' : ''; L.mr.forEach(r => { r.has = rnd() > .45; }); })); });
    CACHE = {}; FCACHE = {}; render(); });
  await page.waitForTimeout(800);
  console.log(tag, 'populated rows:', await page.$$eval('.vz-row', a => a.length), '| svg charts:', await page.$$eval('.panel svg.chart', a => a.length), '| overflow', await ov());
  const first = await page.$('.vz'); await first.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.panel.c8 svg.chart').getBoundingClientRect().top + scrollY - 90)); await page.waitForTimeout(500);
  await page.screenshot({ path: `dash_${tag}.png`, fullPage: false });
  if (!mob) { await page.hover('.stk-s.bad'); await page.waitForTimeout(400); console.log('tip:', JSON.stringify(await page.$eval('#tip', x => x.innerText).catch(() => ''))); await page.screenshot({ path: `dash_${tag}_tip.png` }); }
  console.log('errors:', log.filter(x => /PAGEERR|^error/.test(x)).join(' | ') || 'none');
};
