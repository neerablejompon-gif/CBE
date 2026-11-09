# Extra recordings for v2: LINE notification mock-ups (real-time paced) and a longer users scene
import asyncio, sys, time, base64
sys.path.insert(0, '/home/claude/cbe-rec2')
from playwright.async_api import async_playwright
from rec import Rec, new_page, login
LINE = 'http://localhost:8790/line/index.html?v='

class RT(Rec):
    """Rec whose hold() follows wall-clock time, so CSS transitions keep their real speed"""
    async def hold(s, sec):
        n = round(sec * s.fps); t0 = time.perf_counter(); i = 0
        while i < n:
            due = t0 + i / s.fps; now = time.perf_counter()
            if now < due: await asyncio.sleep(due - now)
            lag = int((time.perf_counter() - t0) * s.fps) - i   # frames we are behind
            k = max(1, min(n - i, lag + 1)); await s.frame(k); i += k

async def line_page(B, v):
    ctx = await B.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = await ctx.new_page(); await pg.goto(LINE + v); await pg.wait_for_timeout(900)
    return ctx, pg

async def sc_line_exec(B):
    ctx, pg = await line_page(B, 'exec'); r = RT(pg, 'r_line_exec.mp4')
    await r.hold(2.0); await pg.evaluate("step('banner')"); await r.hold(2.4)
    await pg.evaluate("step('unbanner');step('msg')"); await r.hold(1.8)
    await r.scroll(560, 2.4, '#chat'); await r.hold(7.8)
    print('line_exec', await r.close()); await ctx.close()

async def sc_line_owner(B):
    ctx, pg = await line_page(B, 'owner'); r = RT(pg, 'r_line_owner.mp4', 'f'); r.x, r.y = 300, 760
    await r.ov(); await pg.evaluate("__fhide()")
    await r.hold(7.6); await pg.evaluate("step('banner')"); await r.hold(1.8)
    await pg.evaluate("step('unbanner');step('msg')"); await r.hold(1.4)
    await r.scroll(260, 1.2, '#chat'); await r.hold(0.3)
    await r.to(pg.locator('#go'), 0.7); await pg.evaluate(f"__rip({r.x},{r.y})"); await r.hold(4.0)
    print('line_owner', await r.close()); await ctx.close()

async def sc_users(B):
    ctx, pg = await new_page(B); await login(pg, 'กปม'); r = Rec(pg, 'r_users.mp4'); r.x, r.y = 700, 400; await r.ov(); await r.hold(0.4)
    await r.to(pg.get_by_text('ผู้ใช้และสิทธิ์').first, 0.7); await r.click(0.6); await r.move(900, 560, 0.9); await r.hold(0.6)
    await r.move(1150, 640, 0.8); await r.hold(1.4)
    await r.to(pg.get_by_text('Audit trail').first, 0.8); await r.click(0.6); await r.move(1000, 360, 0.9); await r.hold(0.6)
    await r.move(1200, 460, 0.9); await r.hold(1.6)
    print('users', await r.close()); await ctx.close()

async def main():
    async with async_playwright() as p:
        B = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for name in sys.argv[1:]:
            try: await globals()[name](B)
            except Exception as e: print('FAIL', name, repr(e)[:300])
        await B.close()
asyncio.run(main())
