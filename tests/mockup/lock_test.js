// Booked months stay closed for steps the unit added (cs) and GAP steps (gs), not only form steps
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, Response, Request, URL, URLSearchParams, crypto, TextEncoder, TextDecoder, atob, btoa });
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'mockup', '_worker.js'), 'utf8').replace('export default {', 'var __default = {'), ctx);
vm.runInContext('openFrom = () => 1;', ctx); // Oct closed, Nov open
const me = { id: '1004', role: 'reporter', ind: 'IA', part: '' }, k = 'IA|IA|1.1|1';
const step = (r, n = 'a') => ({ n, p: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], r });
const z = () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], oct = () => { const a = z(); a[0] = 1; return a; };
const st = unlock => ({ patch: { [k]: { cs: [step(oct())], gs: [step(oct())] } }, wf: {}, wfnote: {}, tri: {}, trinote: {}, unlock: unlock ? { [k]: 1 } : {}, cfg: {}, ai: {} });
const check = (v, unlock) => vm.runInContext('check', ctx)({}, 2570, me, st(unlock), { s: 'patch', k, v });
(async () => {
  const nov = oct(); nov[1] = 2;
  await check({ cs: [step(nov)], gs: [step(oct())] }); console.log('✓ open month (Nov) can change');
  await check({ cs: [step(oct()), step(z(), 'new')] }); console.log('✓ adding an empty step is fine');
  for (const f of ['cs', 'gs']) await assert.rejects(check({ [f]: [step(z())] }), e => e.status === 409 && /ต\.ค\./.test(e.message));
  console.log('✓ changing a booked Oct result in cs / gs refused (409)');
  await assert.rejects(check({ cs: [] }), e => e.status === 409); console.log('✓ deleting a step with a booked result refused');
  await check({ cs: [step(z())] }, true); console.log('✓ allowed after กปม. unlocks the level');
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
