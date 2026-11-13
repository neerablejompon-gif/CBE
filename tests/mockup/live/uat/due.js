const U = require('./u');
(async () => {
  const o = await U.start('1004'); const { page } = o;
  const r = await page.evaluate(() => {
    const z = () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], a = (i, v = 1) => { const x = z(); x[i] = v; return x; };
    const st = (p, r) => ({ plan: p, result: r, target: 1, mode: 'count', custom: true });
    return { openM: openM(), novPlanNoResult: stepStat(st(a(1), z()), 1), octPlanNoResult: stepStat(st(a(0), z()), 1), novDone: stepStat(st(a(1), a(1)), 1),
      list_nov: stepsStat([st(a(1), z())], 1), list_oct: stepsStat([st(a(0), z())], 1), issues: lvIssues({ steps: [st(a(1), z())], narrative: 'x', mr: [], level: 1 }, 1, true),
      ind: indBy('SCM').target.toFixed(4) + ' ' + indBy('KMIM').target.toFixed(4) + ' ' + indBy('CG').target + ' ' + indBy('IA').target, label: STATUS.due.t };
  });
  console.log(JSON.stringify(r, null, 0));
  await page.click('.side >> text=ภาพรวมตัวชี้วัด').catch(() => {}); await page.waitForTimeout(1000); await o.shot('T_ia_overview');
  await o.browser.close();
  const e = await U.start('1020'); await e.page.waitForTimeout(1500); await e.shot('T_exec_dash', true);
  console.log((await e.txt()).match(/[^\n]*เป้าหมายเฉลี่ย[^\n]*/)?.[0]); await e.browser.close();
})();
