// SCM (SM/CM) and KMIM (KM/IM) are sent per part: one part's submission does not lock the other
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, Response, Request, URL, URLSearchParams, crypto, TextEncoder, TextDecoder, atob, btoa });
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', '..', 'mockup', '_worker.js'), 'utf8').replace('export default {', 'var __default = {'), ctx);
const sm = { id: '1003', role: 'reporter', ind: 'SCM', part: 'SM' }, cm = { id: '1002', role: 'reporter', ind: 'SCM', part: 'CM' }, dt = { id: '1001', role: 'reporter', ind: 'DT', part: '' };
const aud = { id: '1010', role: 'audit', self: ['DT'] };
const st = wf => ({ patch: {}, wf, wfnote: {}, tri: {}, trinote: {}, unlock: {}, cfg: {}, ai: {} });
const check = (u, s, op) => vm.runInContext('check', ctx)({}, 2570, u, s, op);
const p = k => ({ s: 'patch', k, v: { narrative: 'x' } });
(async () => {
  await check(sm, st({}), { s: 'wf', k: 'SCM|SM', v: 'submitted' }); await check(sm, st({}), { s: 'wfnote', k: 'SCM|SM:sent', v: 'x' });
  await assert.rejects(check(sm, st({}), { s: 'wf', k: 'SCM', v: 'submitted' }), e => e.status === 403);
  await assert.rejects(check(sm, st({}), { s: 'wf', k: 'SCM|CM', v: 'submitted' }), e => e.status === 403);
  console.log('✓ SM reporter submits SCM|SM only (not SCM or SCM|CM)');
  const s1 = st({ 'SCM|SM': 'submitted' });
  await assert.rejects(check(sm, s1, p('SCM|SM|1.1|1')), e => e.status === 409); await check(cm, s1, p('SCM|CM|1.1|1'));
  console.log('✓ SM submitted: SM locked, CM still editable');
  await check(dt, st({}), { s: 'wf', k: 'DT', v: 'submitted' }); await assert.rejects(check(dt, st({ DT: 'submitted' }), p('DT|DT|1.1|1')), e => e.status === 409);
  console.log('✓ single-part indicators unchanged (key DT)');
  await check(aud, s1, { s: 'wf', k: 'SCM|SM', v: 'approved' }); await check(aud, s1, { s: 'wfnote', k: 'SCM|SM', v: 'x' });
  await assert.rejects(check({ ...aud, self: ['SCM'] }, s1, { s: 'wf', k: 'SCM|SM', v: 'approved' }), e => e.status === 403);
  console.log('✓ กปม. sets part status; self-review block still applies to part keys');
  assert.strictEqual(vm.runInContext('wfInd', ctx)(st({ 'KMIM|KM': 'approved', 'KMIM|IM': 'submitted' }), 'KMIM'), 'submitted');
  assert.strictEqual(vm.runInContext('wfInd', ctx)(st({ 'KMIM|KM': 'approved', 'KMIM|IM': 'approved' }), 'KMIM'), 'approved');
  assert.strictEqual(vm.runInContext('wfOf', ctx)(st({ KMIM: 'draft' }), 'KMIM', 'KM'), 'draft');
  console.log('✓ indicator summary: any part waiting → submitted, all approved → approved');
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
