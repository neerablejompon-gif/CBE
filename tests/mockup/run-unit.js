// Runs the server-side tests of mockup/_worker.js (no network, no Google, no Cloudflare): node tests/mockup/run-unit.js
const { execFileSync } = require('child_process'), path = require('path');
let failed = 0;
for (const t of ['ai_test.js', 'roles_test.js', 'guide_test.js', 'gem_test.js', 'lock_test.js']) {
  try { const out = execFileSync(process.execPath, [path.join(__dirname, t)], { encoding: 'utf8' }); console.log(t + ': ' + out.trim().split('\n').pop()); }
  catch (e) { failed++; console.log(t + ': FAIL\n' + String(e.stdout || '') + String(e.stderr || '')); }
}
process.exit(failed ? 1 : 0);
