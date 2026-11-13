const B = 'https://cbe-report.pages.dev', st = require('./state_after.json');
const jar = {};
const login = async (id, r) => { const x = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ id, password: 'cbe@' + id, r }) }); jar[id] = x.headers.get('set-cookie').split(';')[0]; };
const save = async (id, ops) => { const x = await fetch(B + '/api/save', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, cookie: jar[id] }, body: JSON.stringify({ fy: 2570, ops, log: [] }) }); const t = await x.text(); console.log(id, x.status, ops.map(o => o.s + ':' + o.k + '=' + (o.v === null ? 'null' : typeof o.v === 'object' ? 'blank' : o.v)).join(', '), x.status === 200 ? '' : t); if (x.status !== 200) throw new Error('stop'); };
const owner = { DT: '1001', IA: '1004', HCM: '1005', RM: '1006', SP: '1007', CG: '1008', 'SCM|CM': '1002', 'SCM|SM': '1003', 'KMIM|KM': '1009', 'KMIM|IM': '1011' };
const who = k => { const p = k.split('|'); return owner[p[0] + '|' + p[1]] || owner[p[0]]; };
(async () => {
  for (const id of Object.values(owner)) await login(id); await login('1010', 0); await login('1000');
  // 1) reopen submitted/approved indicators so reporters can edit
  await save('1010', ['CG', 'SP', 'HCM', 'KMIM'].map(k => ({ s: 'wf', k, v: 'returned' })));
  await save('1000', [{ s: 'wf', k: 'DT', v: 'returned' }]);
  // 2) reporters: blank (clears what was mirrored into the forms) then delete
  const keys = Object.keys(st.patch).filter(k => /^(DT\|DT\|1\.1\|1|IA\|IA\|1\.1\|1|HCM\|HCM\|1\.1\|1|RM\|RM\|1\.1\|1|SP\|SP\|1\.1\|1|CG\|CG\|1\.1\|2|SCM\|CM\|1\.1\|1|SCM\|SM\|2\.1\|1|KMIM\|KM\|1\.1\|1|KMIM\|IM\|1\.1\|1)(\|self|\|1\|self)?$|^(CG\|CG\|1\.1\|self)$/.test(k));
  console.log('patch keys', keys.length);
  for (const k of keys) {
    const v = st.patch[k], id = who(k);
    if (v && typeof v === 'object') await save(id, [{ s: 'patch', k, v: { narrative: '', mr: (v.mr || []).map(() => [false, '', []]), res: [], plan: [], cs: (v.cs || []).map(c => Object.assign({}, c, { p: Array(12).fill(0), r: Array(12).fill(0) })), gs: (v.gs || []).map(c => Object.assign({}, c, { p: Array(12).fill(0), r: Array(12).fill(0) })) } }]);
    await save(id, [{ s: 'patch', k, v: null }]);
  }
  for (const [ind, id] of [['DT', '1001'], ['HCM', '1005'], ['CG', '1008'], ['SP', '1007'], ['KMIM', '1009']]) await save(id, [{ s: 'wfnote', k: ind + ':sent', v: null }]);
  // 3) audit: findings, notes, back to draft
  await save('1010', [{ s: 'tri', k: 'R1|HCM|HCM|1.1|2', v: null }, { s: 'trinote', k: 'R1|HCM|HCM|1.1|2', v: null }, { s: 'wfnote', k: 'HCM', v: null }]);
  await save('1010', ['CG', 'SP', 'HCM', 'KMIM'].map(k => ({ s: 'wf', k, v: 'draft' })));
  await save('1000', [{ s: 'wf', k: 'DT', v: 'draft' }]);
  console.log('files', JSON.stringify(Object.values(st.patch).flatMap(v => (v && v.mr || []).flatMap(m => (m[2] || []).map(f => f.id)))));
})().catch(e => console.log('ERR', e.message));
