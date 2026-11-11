module.exports = async ({ page }) => {
  console.log(await page.evaluate(async () => { const r = await fetch('/api/ai/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'DT|DT|1.1|1', mode: 'gaps', label: '1.1 ระดับ 1', crit: 'เริ่มมีแนวทางในการกำกับดูแลด้านดิจิทัล', narr: 'ประชุมคณะกรรมการ DT อนุมัติกรอบ', ev: [] }) }); const j = await r.json(); return r.status + ' engine=' + j.engine + ' model=' + j.model + ' fallback=' + (j.fallback || '-'); }));
};
