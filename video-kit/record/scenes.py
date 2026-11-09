import asyncio, sys
from playwright.async_api import async_playwright
from rec import *
B = None
async def sc_login():
    ctx, pg = await new_page(B); r = Rec(pg, 'r_login.mp4'); r.x, r.y = 900, 650; await r.ov()
    await r.hold(0.4)
    await r.to(pg.locator('input').first, 0.6, 0.3); await r.click(0.1); await r.type('1024', 9)
    await r.to(pg.locator('input[type=password]').first, 0.5, 0.3); await r.click(0.1); await r.type('demo2570', 14)
    await r.to(pg.get_by_role('button', name='เข้าสู่ระบบ').first, 0.5); await pg.evaluate(f"__rip({r.x},{r.y})"); await r.hold(0.25)
    await login(pg, 'กปม'); await r.ov(); await r.hold(1.6)
    print('login', await r.close()); await ctx.close()
async def sc_overview():
    ctx, pg = await new_page(B); await login(pg, 'กปม'); r = Rec(pg, 'r_over.mp4'); r.x, r.y = 1000, 500; await r.ov()
    await r.hold(0.5); await r.move(560, 330, 0.9); await r.hold(0.7); await r.move(1110, 290, 0.8); await r.hold(0.6)
    await r.scroll(640, 1.5); await r.move(700, 300, 0.7); await r.hold(0.6); await r.move(760, 430, 0.6); await r.hold(0.8)
    await r.scroll(420, 1.2); await r.hold(0.8)
    print('over', await r.close()); await ctx.close()
async def sc_mhome():
    ctx, pg = await new_page(B, True); await login(pg, 'SP'); r = Rec(pg, 'r_mhome.mp4', 'f'); r.x, r.y = 300, 700
    await r.ov(); await pg.evaluate("__fhide()"); await r.hold(0.8)
    await r.move(250, 600, 0.5); await r.scroll(330, 1.2); await r.hold(1.0); await r.scroll(-330, 0.9)
    await r.to(pg.get_by_text('ทำต่อ').first, 0.6); await r.click(1.6)
    print('mhome', await r.close()); await ctx.close()
async def sc_score():
    ctx, pg = await new_page(B); await login(pg, 'SP'); r = Rec(pg, 'r_score.mp4'); r.x, r.y = 700, 400; await r.ov()
    await r.hold(0.3); await r.to(pg.locator('aside, nav').get_by_text('ภาพรวมตัวชี้วัด').first, 0.7); await r.click(0.5)
    t = pg.get_by_text('คะแนนคาดการณ์ ณ สิ้นปี').first; y = (await t.bounding_box())['y']
    await r.scroll(int(y - 90), 1.3); await r.hold(0.3)
    for lab in ('ต่ำสุด', 'คาดการณ์ · ตาม', 'สูงสุด'):
        await r.to(pg.get_by_text(lab).first, 0.6, 0.3); await r.hold(0.9)
    t = pg.get_by_text('ขยับ 1 ระดับ').first; y = (await t.bounding_box())['y']
    await r.scroll(int(y - 120), 1.5); await r.to(t, 0.6, 0.2); await r.hold(1.6)
    print('score', await r.close()); await ctx.close()
async def sc_wizard():
    ctx, pg = await new_page(B); await login(pg, 'SP'); r = Rec(pg, 'r_wiz.mp4'); r.x, r.y = 700, 400; await r.ov()
    nav = lambda t: pg.locator('aside').get_by_text(t).first
    await r.hold(0.3); await r.to(nav('รายงานผลตามเกณฑ์'), 0.6); await r.click(0.3)
    await r.to(pg.locator('main').get_by_text('1.1', exact=True).first, 0.5); await r.click(0.4)
    steps = pg.locator('main button').filter(has_text='ความคืบหน้า').first; y = (await steps.bounding_box())['y']
    await r.scroll(int(y - 150), 0.9); await r.hold(0.1)
    for lab in ('ผลการดำเนินงาน', 'หลักฐาน'):
        await r.to(pg.locator('main button').filter(has_text=lab).last, 0.45); await r.click(0.75)
    await r.to(nav('แผนปรับปรุง GAP'), 0.6); await r.click(1.3)
    await r.to(nav('รายงานผลตามเกณฑ์'), 0.5); await r.click(0.3)
    steps = pg.locator('main button').filter(has_text='ความคืบหน้า').first
    if await steps.count():
        await r.to(steps, 0.5); await r.click(0.3)
    auto = pg.locator('main').get_by_text('ระบบลงผลให้อัตโนมัติ').first
    if await auto.count():
        y = (await auto.bounding_box())['y']; await r.scroll(int(y - 330), 0.9); await r.to(auto, 0.5, 0.3); await r.hold(1.2)
    print('wiz', await r.close()); await ctx.close()
async def sc_gate():
    ctx, pg = await new_page(B); await login(pg, 'SP'); r = Rec(pg, 'r_gate.mp4'); r.x, r.y = 1000, 300; await r.ov()
    await r.hold(0.3); t = pg.get_by_text('สิ่งที่ต้องทำ').first; y = (await t.bounding_box())['y']
    await r.scroll(int(y - 60), 1.0); await r.move(560, 330, 0.6); await r.hold(0.8)
    await r.to(pg.locator('main button, main [data-act]').filter(has_text='ระดับ').first, 0.7); await r.hold(0.3); await r.click(1.8)
    print('gate', await r.close()); await ctx.close()
async def sc_review():
    ctx, pg = await new_page(B); await login(pg, 'SP')
    await pg.get_by_text('ส่งตรวจ').first.click(); await pg.wait_for_timeout(300)
    await pg.locator('[data-act=umenu]').first.click(); await pg.wait_for_timeout(300); await pg.locator('[data-act=logout]:visible').first.click(); await pg.wait_for_timeout(300); await login(pg, 'กปม')
    r = Rec(pg, 'r_review.mp4'); r.x, r.y = 700, 300; await r.ov(); await r.hold(0.3)
    await r.to(pg.get_by_text('พื้นที่ผู้ตรวจสอบ').first, 0.7); await r.click(0.6)
    await r.to(pg.get_by_text('ต้องแก้ไข', exact=False).nth(1), 0.6); await r.click(0.6)
    items = pg.locator('main button').filter(has_text='ระดับ')
    await r.to(items.nth(0), 0.6, 0.3); await r.click(0.9)
    b1 = pg.locator('button').filter(has_text='ยืนยันเป็นประเด็น').first
    if await b1.count(): await r.to(b1, 0.6); await r.click(0.8)
    b2 = pg.locator('button').filter(has_text='ส่งกลับ').first
    if await b2.count(): await r.to(b2, 0.7); await r.hold(1.2)
    print('review', await r.close()); await ctx.close()
async def sc_users():
    ctx, pg = await new_page(B); await login(pg, 'กปม'); r = Rec(pg, 'r_users.mp4'); r.x, r.y = 700, 400; await r.ov(); await r.hold(0.2)
    await r.to(pg.get_by_text('ผู้ใช้และสิทธิ์').first, 0.6); await r.click(0.4); await r.move(900, 600, 0.8); await r.hold(0.8)
    await r.to(pg.get_by_text('Audit trail').first, 0.7); await r.click(0.4); await r.move(1100, 380, 0.8); await r.hold(1.2)
    print('users', await r.close()); await ctx.close()
async def stills():
    for mob, role, name in ((False, 'กปม', 'pc'), (True, 'SP', 'mob')):
        ctx, pg = await new_page(B, mob); await login(pg, role); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f's_{name}_light.png')
        await pg.locator('button[aria-label*="ธีม"], button[title*="ธีม"], [data-act=theme]').first.click(); await pg.wait_for_timeout(900)
        await pg.screenshot(path=f's_{name}_dark.png'); await ctx.close()
async def main():
    global B
    async with async_playwright() as p:
        B = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for name in sys.argv[1:]:
            try: await globals()[name]()
            except Exception as e: print('FAIL', name, repr(e)[:300])
        await B.close()
asyncio.run(main())
