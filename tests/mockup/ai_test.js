// Local test of the AI pre-check in mockup/_worker.js with fake Workers AI, fake state sheet and fake LINE
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const W = require('path').join(__dirname, '..', '..', 'mockup', '_worker.js'), H = require('path').join(__dirname, '..', '..', 'mockup', 'index.html');
const ctx = vm.createContext({ console, Response, URL, URLSearchParams, crypto, TextEncoder, TextDecoder, fetch: async () => { throw new Error('no network'); }, setTimeout });
vm.runInContext(fs.readFileSync(W, 'utf8').replace('export default {', 'var __default = {'), ctx);
// stubs
vm.runInContext(`
  var STATE = { patch: {}, wf: {}, wfnote: {}, tri: {}, trinote: {}, unlock: {}, cfg: {}, ai: {} }, WRITES = [], PUSHES = [], USER = { role: 'audit', id: '1010' };
  loadState = async () => ({ st: JSON.parse(JSON.stringify(STATE)), at: {} });
  writeState = async (env, fy, at, ops) => { ops.forEach(o => { WRITES.push(o); STATE[o.s][o.k] = o.v; }); return 'now'; };
  me = async () => USER;
  system = async () => ({ users: { '1010': { role: 'audit' }, '1001': { role: 'reporter' } } });
  lineRows = async () => [{ id: '1010', user: 'Uaudit' }, { id: '1001', user: 'Urep' }];
  lineCall = async (env, path, body, key) => { PUSHES.push({ to: body.to, text: body.messages[0].text, key }); };
`, ctx);
// client functions
const html = fs.readFileSync(H, 'utf8');
const grab = name => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && !--d) break; } return html.slice(i, j + 1); };
const cl = vm.createContext({ lvKey: (s, L) => s.uid + '|' + L.level });
vm.runInContext([grab('aiCut'), grab('aiInput'), grab('aiSig')].join('\n'), cl);

const req = body => new Request('https://cbe-report.pages.dev/api/ai/check', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://cbe-report.pages.dev' }, body: JSON.stringify(body) });
let calls = 0, mode = 'ok';
const AI = { run: async (model, input) => {
  calls++;
  assert.strictEqual(input.chat_template_kwargs && input.chat_template_kwargs.enable_thinking, false, 'thinking must be off');
  if (mode === 'throw-format' && input.response_format) throw new Error('response_format not supported');
  if (mode === 'garbage') return { choices: [{ message: { content: 'ขออภัย ไม่สามารถตอบได้' } }], usage: { prompt_tokens: 2000, completion_tokens: 50 } };
  return { choices: [{ message: { content: '```json\n{"findings":[{"type":"criteria","severity":"warning","title":"ขาดการประเมินสมรรถนะ","detail":"ค่าเกณฑ์ข้อ 1.1 ต้องประเมินสมรรถนะ","fix":"เพิ่มผลการประเมิน"},{"type":"bogus","title":"x"},{"type":"evidence","severity":"critical","title":"ชื่อไฟล์ไม่ตรง","detail":"d","fix":"f"}],"return_note":"กรุณาเพิ่มผลการประเมินสมรรถนะ"}\n```' } }], usage: { prompt_tokens: 3000, completion_tokens: 400 } };
} };
const env = { AI, LINE_CHANNEL_TOKEN: 'x', AI_DAILY_NEURONS: '150' };
const s = { uid: 'DT|DT|1.1', label: '1.1', name: 'กำหนดกรอบทิศทาง' };
const L = n => ({ level: n, criteria: '  เกณฑ์ ' + n + ' '.repeat(3) + 'ก'.repeat(4000), narrative: 'ผล ' + n, gap: 'ข้อเสนอ', action: '', gapNote: '', mr: [{ req: 'มติ', has: true, evidence: 'มติ ครั้งที่ 1', files: [{ name: 'a.pdf' }, { name: 'b.pdf' }] }] });

(async () => {
  const run1 = b => vm.runInContext('aiCheck', ctx)(req(b), env, 2570, null);
  const run = async b => { let last, all = {}; for (const it of (b.items.length ? b.items : [null])) { last = await run1({ fy: b.fy, items: it ? [it] : [] }); Object.assign(all, last.results); if (last.quota) break; } return Object.assign({}, last, { results: all }); };
  const items = [1, 2, 3, 4, 5].map(n => vm.runInContext('aiInput', cl)(s, L(n)));
  // signature parity: page vs server (after the server trims and cuts)
  items.forEach(x => assert.strictEqual(vm.runInContext('aiSig', cl)(x), vm.runInContext('aiSig(aiItem(X))', Object.assign(ctx, { X: x }))));
  console.log('✓ page and server signatures match (incl. trimming/cut at 3000 chars)');

  let r = await run({ fy: 2570, items: items.slice(0, 2) });
  const rec = r.results['DT|DT|1.1|1'];
  assert.strictEqual(rec.items.length, 2); assert.strictEqual(rec.items[1].sev, 'warning'); assert.strictEqual(rec.note, 'กรุณาเพิ่มผลการประเมินสมรรถนะ');
  const per = Math.ceil((3000 * 9091 + 400 * 27273) / 1e6);
  assert.strictEqual(r.used, per * 2); assert.strictEqual(calls, 2);
  console.log('✓ parses fenced JSON, drops unknown type, caps severity at warning, Neurons', per, 'per level');

  r = await run({ fy: 2570, items: items.slice(0, 2) });
  assert.strictEqual(calls, 2); console.log('✓ unchanged levels come from cache (no AI call)');

  const pushesBefore = vm.runInContext('PUSHES.length', ctx);
  r = await run({ fy: 2570, items: items.slice(2, 4) }); // 2 more → crosses 80% of 150
  console.log('  used', r.used, '/', r.limit, 'quota', r.quota);
  const pushes = vm.runInContext('PUSHES', ctx);
  assert.ok(pushes.length > pushesBefore && pushes.every(p => p.to === 'Uaudit'), 'LINE alert only to กปม.');
  console.log('✓ LINE alert at 80% sent to กปม. only:', pushes[0].text);

  r = await run({ fy: 2570, items: items.slice(4, 5) });
  assert.ok(r.quota && !r.results['DT|DT|1.1|5']); console.log('✓ stops at the daily limit without calling AI (calls =', calls + ')');

  env.AI_DAILY_NEURONS = '100000'; mode = 'garbage';
  r = await run({ fy: 2570, items: items.slice(4, 5) });
  assert.ok(r.results['DT|DT|1.1|5'].err && r.results['DT|DT|1.1|5'].raw.includes('ขออภัย')); console.log('✓ unreadable AI reply is stored as an error with the raw text, retried next time:', r.results['DT|DT|1.1|5'].err);
  mode = 'throw-format';
  r = await run({ fy: 2570, items: items.slice(4, 5) });
  assert.ok(!r.results['DT|DT|1.1|5'].err && r.results['DT|DT|1.1|5'].items.length === 2); console.log('✓ retries without response_format when a model rejects it');

  r = await run({ fy: 2570, items: [{ k: 'DT|DT|1.1|1\nx' }, { k: '../etc' }] });
  assert.deepStrictEqual(Object.keys(r.results), []); console.log('✓ ignores malformed level keys');

  vm.runInContext("USER = { role: 'reporter', id: '1001', ind: 'DT' }", ctx);
  await assert.rejects(run({ fy: 2570, items }), e => e.status === 403); console.log('✓ reporter gets 403');
  vm.runInContext("USER = { role: 'audit', id: '1010' }", ctx);
  await assert.rejects(vm.runInContext('aiCheck', ctx)(req({ fy: 2570, items }), {}, 2570), e => e.status === 501); console.log('✓ no AI binding → 501 with a clear message');
  const st = vm.runInContext("stateFor({ role: 'reporter', ind: 'DT' }, STATE)", ctx);
  assert.strictEqual(Object.keys(st.ai).length, 0); assert.ok(Object.keys(vm.runInContext('STATE.ai', ctx)).length > 0); console.log('✓ reporters never receive AI results or usage');
  await assert.rejects(vm.runInContext('check', ctx)(env, 2570, { role: 'audit' }, vm.runInContext('STATE', ctx), { s: 'ai', k: 'usage|x', v: { n: 0 } }), e => e.status === 403);
  console.log('✓ /api/save cannot overwrite AI results or the usage counter');
  const big = await run1({ fy: 2570, items: [items[0], items[1]] }); assert.ok(Object.keys(big.results).length <= 1); console.log('✓ server handles one level per request');
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
