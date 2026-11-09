import asyncio, subprocess, math, os, sys, time
from playwright.async_api import async_playwright
URL = 'http://localhost:8790/index.html'
HIDE = '.lg-demo{display:none!important}'
OVER = """(()=>{if(document.getElementById('ov'))return;const s=document.createElement('style');s.textContent=`
#ovc{position:fixed;left:0;top:0;width:24px;height:32px;z-index:2147483647;pointer-events:none}
#ovf{position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;z-index:2147483647;pointer-events:none;
 background:radial-gradient(circle at 40% 35%,rgba(255,255,255,.75),rgba(255,255,255,.35));border:2px solid rgba(31,95,224,.55);box-shadow:0 6px 18px rgba(15,23,42,.25);opacity:0;transition:opacity .2s, transform .12s}
.ovr{position:fixed;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid rgba(31,95,224,.7);z-index:2147483646;pointer-events:none;animation:ovr .5s ease-out forwards}
@keyframes ovr{to{transform:scale(2.4);opacity:0}}`;document.head.appendChild(s);
const c=document.createElement('div');c.id='ovc';c.innerHTML='<svg width="24" height="32" viewBox="0 0 22 30"><path d="M2 2v22l6-6 4 10 4-2-4-9h8z" fill="#0f172a" stroke="#fff" stroke-width="1.6"/></svg>';
const f=document.createElement('div');f.id='ovf';const o=document.createElement('div');o.id='ov';o.style.display='none';
document.documentElement.append(c,f,o);
window.__mv=(x,y,mode)=>{const e=document.getElementById(mode==='f'?'ovf':'ovc');e.style.transform=mode==='f'?`translate(${x}px,${y}px)`:`translate(${x-2}px,${y-2}px)`;if(mode==='f')e.style.opacity=1;document.getElementById(mode==='f'?'ovc':'ovf').style.display=mode==='f'?'none':''};
window.__fhide=()=>{document.getElementById('ovf').style.opacity=0};
window.__rip=(x,y)=>{const r=document.createElement('div');r.className='ovr';r.style.left=x+'px';r.style.top=y+'px';document.documentElement.appendChild(r);setTimeout(()=>r.remove(),600)};
})()"""
def ease(t): return t*t*(3-2*t)
class Rec:
    def __init__(s, pg, out, mode='c', fps=30):
        s.pg, s.mode, s.fps, s.x, s.y, s.n = pg, mode, fps, 640, 400, 0
        s.tmp = out + '.tmp.mp4'; s.out = out
        s.ff = subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','image2pipe','-framerate',str(fps),'-c:v','mjpeg','-i','-',
            '-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p',s.tmp], stdin=subprocess.PIPE)
    async def ov(s):
        await s.pg.evaluate(OVER); await s.pg.evaluate(f"__mv({s.x},{s.y},'{s.mode}')")
    async def frame(s, k=1):
        if not hasattr(s,'cdp'): s.cdp = await s.pg.context.new_cdp_session(s.pg)
        import base64
        b = base64.b64decode((await s.cdp.send('Page.captureScreenshot', {'format':'jpeg','quality':92,'optimizeForSpeed':True}))['data'])
        for _ in range(k): s.ff.stdin.write(b); s.n += 1
    async def hold(s, sec):
        n = round(sec*s.fps)
        for i in range(0, n, 3): await s.frame(min(3, n-i))
    async def move(s, x, y, sec=0.7):
        x0, y0 = s.x, s.y; n = max(1, round(sec*s.fps))
        for i in range(1, n+1):
            t = ease(i/n); s.x, s.y = x0+(x-x0)*t, y0+(y-y0)*t
            await s.pg.evaluate(f"__mv({s.x},{s.y},'{s.mode}')")
            if s.mode == 'c': await s.pg.mouse.move(s.x, s.y)
            await s.frame()
    async def to(s, loc, sec=0.7, dx=0.5, dy=0.5):
        if isinstance(loc, str): loc = s.pg.get_by_text(loc, exact=False).first
        await loc.scroll_into_view_if_needed(); bx = await loc.bounding_box()
        await s.move(bx['x']+bx['width']*dx, bx['y']+bx['height']*dy, sec)
    async def click(s, after=0.5):
        await s.pg.evaluate(f"__rip({s.x},{s.y})")
        if s.mode == 'f': await s.pg.touchscreen.tap(s.x, s.y)
        else: await s.pg.mouse.click(s.x, s.y)
        await s.hold(after)
    async def type(s, text, cps=12):
        for ch in text:
            await s.pg.keyboard.type(ch); await s.frame(max(1, round(s.fps/cps)))
    async def scroll(s, dy, sec=1.0, sel=None):
        n = max(1, round(sec*s.fps)); done = 0
        for i in range(1, n+1):
            tgt = round(dy*ease(i/n)); step = tgt-done; done = tgt
            if sel: await s.pg.evaluate(f"document.querySelector('{sel}').scrollBy(0,{step})")
            else: await s.pg.evaluate(f"(document.scrollingElement).scrollBy(0,{step})")
            await s.frame()
    async def close(s):
        s.ff.stdin.close(); s.ff.wait(); os.replace(s.tmp, s.out); return s.n/s.fps
async def new_page(b, mobile=False):
    if mobile: ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else: ctx = await b.new_context(viewport={'width':1280,'height':720}, device_scale_factor=1.5)
    pg = await ctx.new_page(); pg.on('pageerror', lambda e: print('ERR', e))
    cdp = await ctx.new_cdp_session(pg); await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', {'playbackRate': 1})
    await pg.goto(URL); await pg.add_style_tag(content=HIDE); await pg.wait_for_timeout(500)
    return ctx, pg
async def login(pg, role):
    await pg.evaluate("document.querySelector('.lg-demo').style.cssText='display:block!important'")
    await pg.locator('.lg-demo button').filter(has_text=role).first.click(); await pg.wait_for_timeout(400)
    await pg.evaluate("S.month=curMonth();RUNS={};render();scrollTo(0,0)"); await pg.wait_for_timeout(400)
