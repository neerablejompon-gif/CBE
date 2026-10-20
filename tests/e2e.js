// ทดสอบหน้าเว็บผ่าน dev/harness.html ด้วย Playwright: node dev/build-harness.js && node tests/e2e.js
const { chromium } = require('playwright');
const path = require('path');
const url = process.env.E2E_URL || 'file://' + path.join(__dirname, '..', 'dev', 'harness.html');
const shots = process.env.SHOTS;
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n').slice(0,12).join(' | ')); } }
function ok(v, m) { if (!v) throw new Error(m || 'ควรเป็นจริง'); }

(async () => {
  const browser = await chromium.launch();
  for (const [vw, vh, scheme] of [[1366, 900, 'light'], [390, 844, 'light'], [1366, 900, 'dark']]) {
    console.log(`หน้าจอ ${vw}x${vh} ${scheme}`);
    if (process.env.E2E_RESET) await fetch(process.env.E2E_RESET, { method: 'POST' });
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, colorScheme: scheme });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    const tag = `${vw}-${scheme}`;
    const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, `${tag}-${n}.png`), fullPage: false }); };
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const login = async (e, p) => {
      await page.fill('#email', e); await page.fill('#password', p); await page.click('#loginBtn');
    };
    await page.goto(url);
    await page.waitForSelector('#loginForm');
    await shot('login');
    await t('หน้า Log in ไม่ล้นแนวนอน', async () => ok(!(await overflow())));
    await t('รหัสผ่านผิดแสดงข้อความ', async () => {
      await login('sp@demo.local', 'wrong-password1');
      await page.waitForSelector('#loginErr:not([hidden])');
      ok((await page.textContent('#loginErr')).includes('ไม่ถูกต้อง'));
    });
    await t('ผู้รายงานเข้าสู่ระบบเห็นเฉพาะตัวชี้วัดของตน', async () => {
      await login('sp@demo.local', 'Report-Demo-2569');
      await page.waitForSelector('.hero');
      const codes = await page.$$eval('#side [data-en] .code', a => a.map(x => x.textContent));
      ok(JSON.stringify(codes) === '["SP","RM"]', codes.join());
    });
    await shot('user-overview');
    await t('ภาพรวมผู้รายงานไม่ล้นแนวนอน', async () => ok(!(await overflow())));
    await t('ผู้รายงานบันทึกผลรายเดือนและรายละเอียดได้', async () => {
      if (vw < 800) { await page.click('#menuBtn'); }
      await page.click('#side [data-en="SP"]');
      await page.waitForSelector('#narr');
      await page.fill('#narr', 'ประชุมคณะกรรมการครั้งที่ 1/2569 วันที่ 10 ต.ค. 68');
      const inp = page.locator('[data-res]').first();
      await inp.fill('1');
      ok(await page.isVisible('#dirtyMsg'));
      await page.click('[data-act="save"]');
      await page.waitForSelector('#dirtyMsg[hidden]', { state: 'attached' });
      await page.waitForFunction(() => document.querySelector('#narr') && document.querySelector('#narr').value.includes('1/2569'));
    });
    await shot('user-enabler');
    await t('หน้าตัวชี้วัดไม่ล้นแนวนอน', async () => ok(!(await overflow())));
    await t('อัปโหลดไฟล์หลักฐานแล้วแสดงในรายการ', async () => {
      await page.setInputFiles('[data-upl]', { name: 'เอกสารประกอบที่ 1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') });
      await page.waitForSelector('.file:has-text("เอกสารประกอบที่ 1.pdf")');
    });
    await t('ส่งตรวจแล้วข้อมูลถูกล็อก', async () => {
      await page.click('[data-act="submit"]');
      await page.click('#dlgOk');
      await page.waitForSelector('.pill.info:has-text("รอ กปม. ตรวจ")');
      ok(!(await page.$('#narr')));
    });
    await t('Timeline แสดงกิจกรรมและเพิ่มได้', async () => {
      if (vw < 800) await page.click('#menuBtn');
      await page.click('#side [data-go="timeline"]');
      await page.waitForSelector('.gbar');
      await page.click('[data-act="addAct"]');
      await page.fill('#fName', 'จัดอบรมบุคลากร');
      await page.click('#dlgOk');
      await page.waitForFunction(() => document.querySelectorAll('.gbar').length === 2);
    });
    await shot('user-timeline');
    await t('คลังเอกสารแสดงไฟล์ที่อัปโหลด', async () => {
      if (vw < 800) await page.click('#menuBtn');
      await page.click('#side [data-go="library"]');
      await page.fill('#libq', 'ประกอบ');
      await page.waitForSelector('.frow:has-text("เอกสารประกอบที่ 1.pdf")');
    });
    await shot('user-library');
    await t('ออกจากระบบกลับหน้า Log in', async () => {
      await page.click('[data-act="logout"]');
      await page.waitForSelector('#loginForm');
    });
    await t('แอดมินเห็นทุกตัวชี้วัดและหน้าตัวชี้วัดเป็นแบบดูอย่างเดียว', async () => {
      await login('admin@demo.local', 'Admin-Demo-2569');
      await page.waitForSelector('.kpis');
      ok((await page.$$('#side [data-en]')).length === 9);
      if (vw < 800) await page.click('#menuBtn');
      await page.click('#side [data-go="review"]');
      await page.click('tr[data-open^="SP-"]');
      await page.waitForSelector('#ascore');
      ok(!(await page.$('#narr')) && !(await page.$('[data-upl]')));
      ok(await page.locator('[data-res]').first().isDisabled());
    });
    await shot('admin-enabler');
    await t('แอดมินอนุมัติผล', async () => {
      await page.fill('#ascore', '1.5');
      await page.click('[data-act="approve"]');
      await page.click('#dlgOk');
      await page.waitForSelector('.pill.ok:has-text("ตรวจแล้ว")');
    });
    await t('แอดมินดูภาพรวม หน้าผู้ใช้ และตั้งค่าได้โดยไม่ล้นจอ', async () => {
      for (const v of ['overview', 'users', 'settings', 'timeline', 'log']) {
        if (vw < 800) await page.click('#menuBtn');
        await page.click(`#side [data-go="${v}"]`);
        await page.waitForSelector('#view section');
        if (v === 'users') await page.waitForSelector('[data-resetpw]');
        await shot('admin-' + v);
        ok(!(await overflow()), 'ล้นที่หน้า ' + v);
      }
    });
    await t('แอดมินเพิ่มผู้ใช้ได้รหัสชั่วคราวแสดงครั้งเดียว', async () => {
      if (vw < 800) await page.click('#menuBtn');
      await page.click('#side [data-go="users"]');
      await page.click('[data-user=""]');
      await page.fill('#uName', 'ทดสอบ ' + tag);
      await page.fill('#uEmail', `u${vw}${scheme}@demo.local`);
      await page.check('[name=uEn][value="KM"]');
      await page.click('#dlgOk');
      await page.waitForSelector('.temp-pw');
      ok((await page.textContent('.temp-pw')).trim().length >= 10);
      await page.click('#dlgForm button[value="cancel"]');
    });
    await t('ไม่มี error ใน console', async () => ok(!errors.length, errors.join(' | ')));
    await page.close();
  }
  await browser.close();
  console.log(`\nผ่าน ${pass} ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})();
