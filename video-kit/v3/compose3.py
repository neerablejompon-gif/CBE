# CBE Reporting launch video v3: dark theme, liquid-glass labels, smooth shot motion, LINE intro, short opening
import sys, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
sys.path.insert(0, '/home/claude/cbe-final'); sys.path.insert(0, '/home/claude/cbe-v2'); sys.path.insert(0, '/home/claude/cbe-v3')
import compose as C          # Clip, render (writer) and the recorded stills
import opening as O
from script import LINES, VO

W, H, FPS = 1920, 1080, 30
R = '/home/claude/cbe-rec2/'
C.OUT = '/home/claude/cbe-v3/out/'
VO_OFFSET = 1.8
FONT = '/home/claude/fonts/IBMPlexSansThai-{}.ttf'
_fc = {}
def F(w, s):
    if (w, s) not in _fc: _fc[w, s] = ImageFont.truetype(FONT.format(w), s)
    return _fc[w, s]

# ---------------------------------------------------------------- easing
def cl(x): return max(0., min(1., x))
def eo(x): x = cl(x); return 1 - (1 - x) ** 3                 # ease-out cubic
def ei(x): x = cl(x); return x ** 3
def eio(x): x = cl(x); return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2
def eback(x, s=1.4): x = cl(x); x -= 1; return 1 + (s + 1) * x ** 3 + s * x ** 2

# ---------------------------------------------------------------- animated dark background
def _blob(r, col, k):
    s = int(r * 2.6); yy, xx = np.mgrid[0:s, 0:s].astype(np.float32); c = s / 2
    return (np.exp(-((xx - c) ** 2 + (yy - c) ** 2) / (r * r)) * k)[..., None] * np.array(col, np.float32)

def _base():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    g = np.clip((yy / H) * .75 + (xx / W) * .25, 0, 1)[..., None]
    a = np.array((13, 28, 66), np.float32) * (1 - g) + np.array((3, 6, 18), np.float32) * g
    v = np.sqrt(((xx - W / 2) / (W * .75)) ** 2 + ((yy - H / 2) / (H * .8)) ** 2)
    a *= (1 - .35 * np.clip(v - .35, 0, 1))[..., None]
    dots = ((xx % 48 < 2) & (yy % 48 < 2))[..., None] * 9.0   # faint dot grid
    return a + dots

BASE = _base()
BLOBS = [(_blob(620, (31, 95, 224), .42), 420, 230, 140, 90, .07, .09),
         (_blob(760, (88, 64, 220), .30), 1580, 900, 160, 80, .05, .08),
         (_blob(460, (40, 160, 255), .18), 1250, 260, 220, 120, .06, .04)]

def _add(img, spr, x, y):
    h, w = spr.shape[:2]; x0, y0 = int(x - w / 2), int(y - h / 2)
    a0, b0 = max(0, x0), max(0, y0); a1, b1 = min(W, x0 + w), min(H, y0 + h)
    if a1 > a0 and b1 > b0: img[b0:b1, a0:a1] += spr[b0 - y0:b1 - y0, a0 - x0:a1 - x0]

def bg_arr(t):
    img = BASE.copy()
    for spr, x, y, ax, ay, fx, fy in BLOBS:
        _add(img, spr, x + ax * math.sin(t * fx * 6.28), y + ay * math.cos(t * fy * 6.28))
    return np.clip(img, 0, 255)

def bg(t): return Image.fromarray(bg_arr(t).astype(np.uint8)).convert('RGBA')

# ---------------------------------------------------------------- placing a card with subpixel scale / tilt
def coeffs(dst, src):
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]; B += [u, v]
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

def rmask(w, h, r):
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255); return m

class Card:
    """Rounded screen with hairline rim, drop shadow and blue under-glow, drawn at any scale / tilt / opacity"""
    def __init__(s, w, h, r):
        s.w, s.h, s.r = w, h, r; s.mask = rmask(w, h, r)
        rim = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ImageDraw.Draw(rim).rounded_rectangle((0, 0, w - 1, h - 1), r, outline=(255, 255, 255, 46), width=2)
        s.rim = rim
        p = 90; sh = Image.new('RGBA', (w + 2 * p, h + 2 * p), (0, 0, 0, 0)); d = ImageDraw.Draw(sh)
        d.rounded_rectangle((p, p + 34, p + w, p + h + 34), r, fill=(0, 0, 0, 165))
        sh = sh.filter(ImageFilter.GaussianBlur(38))
        gl = Image.new('RGBA', sh.size, (0, 0, 0, 0)); ImageDraw.Draw(gl).rounded_rectangle((p + 40, p + 60, p + w - 40, p + h + 20), r, fill=(40, 100, 255, 70))
        s.shadow = Image.alpha_composite(sh, gl.filter(ImageFilter.GaussianBlur(60))); s.pad = p
    def prep(s, src):
        f = src.resize((s.w, s.h), Image.BILINEAR).convert('RGBA'); f.putalpha(s.mask); f.alpha_composite(s.rim); return f

def place(im, f, cx, cy, k=1.0, alpha=1.0, tilt=0.0, shadow=None, pad=0):
    """Composite RGBA f centred at (cx, cy), scaled by k, with a perspective tilt (0..1) and opacity"""
    if alpha <= 0.003: return
    w, h = f.width * k, f.height * k
    if shadow is not None and alpha > .05:
        sw, shh = int(shadow.width * k), int(shadow.height * k)
        sh = shadow.resize((sw, shh), Image.BILINEAR)
        if alpha < 1: sh.putalpha(sh.getchannel('A').point(lambda v: int(v * alpha)))
        im.alpha_composite(sh, (int(cx - sw / 2), int(cy - shh / 2)))
    d = .10 * tilt; lift = h * .06 * tilt
    q = [(cx - w / 2 * (1 - d), cy - h / 2 + lift), (cx + w / 2 * (1 - d), cy - h / 2 + lift), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]
    x0, y0 = math.floor(min(p[0] for p in q)), math.floor(min(p[1] for p in q))
    x1, y1 = math.ceil(max(p[0] for p in q)), math.ceil(max(p[1] for p in q))
    dst = [(x - x0, y - y0) for x, y in q]; src = [(0, 0), (f.width, 0), (f.width, f.height), (0, f.height)]
    out = f.transform((x1 - x0, y1 - y0), Image.PERSPECTIVE, coeffs(dst, src), Image.BICUBIC)
    if alpha < 1: out.putalpha(out.getchannel('A').point(lambda v: int(v * alpha)))
    # clip to the canvas
    cx0, cy0 = max(0, -x0), max(0, -y0)
    if cx0 or cy0 or x1 > W or y1 > H:
        out = out.crop((cx0, cy0, min(out.width, W - x0), min(out.height, H - y0))); x0 += cx0; y0 += cy0
    if out.width > 0 and out.height > 0: im.alpha_composite(out, (x0, y0))

# ---------------------------------------------------------------- phone frame (dark titanium with rim light)
class Phone:
    def __init__(s, sh_h):
        s.sw = int(sh_h * 390 / 844); s.sh_h = sh_h; b = 15
        s.fw, s.fh = s.sw + 2 * b, sh_h + 2 * b; s.b = b
        fr = Image.new('RGBA', (s.fw, s.fh), (0, 0, 0, 0)); d = ImageDraw.Draw(fr)
        d.rounded_rectangle((0, 0, s.fw - 1, s.fh - 1), 64, fill=(16, 22, 38, 255))
        d.rounded_rectangle((1, 1, s.fw - 2, s.fh - 2), 63, outline=(150, 170, 210, 255), width=2)
        d.rounded_rectangle((5, 5, s.fw - 6, s.fh - 6), 59, outline=(40, 52, 80, 255), width=2)
        s.frame = fr; s.mask = rmask(s.sw, sh_h, 50)
        isl = Image.new('RGBA', (118, 34), (0, 0, 0, 0)); ImageDraw.Draw(isl).rounded_rectangle((0, 0, 117, 33), 17, fill=(4, 6, 12, 255)); s.isl = isl
        p = 90; sh = Image.new('RGBA', (s.fw + 2 * p, s.fh + 2 * p), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((p, p + 30, p + s.fw, p + s.fh + 30), 64, fill=(0, 0, 0, 170))
        sh = sh.filter(ImageFilter.GaussianBlur(34))
        gl = Image.new('RGBA', sh.size, (0, 0, 0, 0)); ImageDraw.Draw(gl).rounded_rectangle((p + 30, p + 80, p + s.fw - 30, p + s.fh), 64, fill=(40, 100, 255, 60))
        s.shadow = Image.alpha_composite(sh, gl.filter(ImageFilter.GaussianBlur(50)))
    def img(s, scr):
        base = s.frame.copy(); f = scr.resize((s.sw, s.sh_h), Image.BILINEAR).convert('RGBA'); f.putalpha(s.mask)
        base.alpha_composite(f, (s.b, s.b)); base.alpha_composite(s.isl, (s.fw // 2 - 59, s.b + 11)); return base

# ---------------------------------------------------------------- liquid-glass label
PH_H = 62
def _grad(w, h, top, bot):
    g = np.clip(np.linspace(top, bot, h, dtype=np.float32), 0, 255)[:, None].repeat(w, 1)
    a = Image.fromarray(g.astype(np.uint8)); im = Image.new('RGBA', (w, h), (255, 255, 255, 0)); im.putalpha(a); return im

def glass(im, x, y, w, h, alpha=1.0, tint=(255, 255, 255), fill=(34, 12), sheen=None, white=0.0, r=None):
    """Frosted pill: blurred backdrop + tint gradient + specular rim + soft shadow"""
    w, h = int(w), int(h); pill = r is None; r = h // 2 if pill else r
    if (pill and w < h) or alpha <= 0: return None
    m = rmask(w, h, r)
    pad = 40
    sh = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 10, pad + w, pad + h + 10), r, fill=(0, 0, 0, int(110 * alpha)))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)), (x - pad, y - pad))
    bx0, by0 = max(0, x - 30), max(0, y - 30)
    back = im.crop((bx0, by0, min(W, x + w + 30), min(H, y + h + 30))).filter(ImageFilter.GaussianBlur(18))
    back = ImageEnhance.Brightness(back).enhance(1.25).crop((x - bx0, y - by0, x - bx0 + w, y - by0 + h))
    lay = back.convert('RGBA')
    tg = _grad(w, h, fill[0] + white * 200, fill[1] + white * 200)
    if tint != (255, 255, 255): tg = Image.merge('RGBA', (*Image.new('RGB', (w, h), tint).split(), tg.getchannel('A')))
    lay.alpha_composite(tg)
    gl = np.zeros((h, w), np.float32); hh = max(2, int(h * .48))       # top gloss
    gl[2:hh] = np.linspace(70, 0, hh - 2)[:, None]
    gm = np.asarray(rmask(w - 6, h - 4, max(1, r - 2)), np.float32) / 255; gmask = np.zeros((h, w), np.float32); gmask[2:h - 2, 3:w - 3] = gm
    lay.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', (w, h), (255, 255, 255)).split(), Image.fromarray((gl * gmask).astype(np.uint8)))))
    if sheen is not None and 0 < sheen < 1:      # diagonal light sweep
        sw = Image.new('L', (w, h), 0); xs = -120 + (w + 240) * sheen
        ImageDraw.Draw(sw).polygon([(xs, 0), (xs + 60, 0), (xs + 20, h), (xs - 40, h)], fill=70)
        lay.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', (w, h), (255, 255, 255)).split(), sw.filter(ImageFilter.GaussianBlur(6)))))
    ring = Image.new('L', (w, h), 0); ImageDraw.Draw(ring).rounded_rectangle((0, 0, w - 1, h - 1), r, outline=255, width=2)
    rg = np.linspace(190, 40, h, dtype=np.float32)[:, None].repeat(w, 1) * (np.asarray(ring, np.float32) / 255)
    lay.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', (w, h), (255, 255, 255)).split(), Image.fromarray(rg.astype(np.uint8)))))
    lay.putalpha(Image.fromarray((np.asarray(m, np.float32) * alpha).astype(np.uint8)))
    im.alpha_composite(lay, (x, y)); return lay

def label(im, text, u, vis=1.0, x=56, y=40):
    """Liquid-glass header label: grows from a dot to full width, text fades in, light sweeps once"""
    g = eo((u - .2) / .65)
    if g <= 0 or vis <= 0: return
    f = F('SemiBold', 29); tw = f.getlength(text); full = tw + 54 + 30
    w = PH_H + (full - PH_H) * g; a = min(1, g * 1.8) * vis; yy = y + (1 - vis) * -10
    glass(im, x, int(yy), w, PH_H, a, sheen=(u - .55) / .9)
    lay = Image.new('RGBA', (int(w), PH_H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    cxd, cyd = 31, PH_H / 2                           # glowing dot
    halo = Image.new('RGBA', (int(w), PH_H), (0, 0, 0, 0)); ImageDraw.Draw(halo).ellipse((cxd - 13, cyd - 13, cxd + 13, cyd + 13), fill=(90, 150, 255, 120))
    lay.alpha_composite(halo.filter(ImageFilter.GaussianBlur(6)))
    d.ellipse((cxd - 6, cyd - 6, cxd + 6, cyd + 6), fill=(140, 185, 255, 255))
    ta = eo((u - .45) / .4)
    d.text((54, PH_H / 2 + 1), text, font=f, fill=(244, 248, 255, int(255 * ta)), anchor='lm')
    m = rmask(int(w), PH_H, PH_H // 2); A = np.asarray(lay.getchannel('A'), np.float32) * np.asarray(m, np.float32) / 255 * a
    lay.putalpha(Image.fromarray(A.astype(np.uint8))); im.alpha_composite(lay, (x, int(yy)))

# ---------------------------------------------------------------- clip reader with start / speed / delay
class Feed:
    def __init__(s, rec, start=0.0, slow=1.0, delay=0.0):
        s.c = C.Clip(R + rec, start); s.c.next(); s.slow, s.delay, s.acc = slow, delay, 0.0
    def at(s, u):
        if u >= s.delay:
            s.acc += s.slow
            while s.acc >= 1: s.c.next(); s.acc -= 1
        return s.c.last

def dur(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout)

def env(u, d, tin=.8, tout=.45):
    """entrance/exit envelope: a = entrance progress, b = exit progress"""
    return eo(u / tin), ei((u - (d - tout)) / tout)

# ---------------------------------------------------------------- shots
CY = H / 2 + 40
WIN = Card(int(W * .80), int(H * .80), 20)

def shot_window(name, t0, t1, rec, start, text, slow=1.0):
    fd = Feed(rec, start, slow); d = t1 - t0
    def fn(t, i):
        u = t - t0; a, b = env(u, d); im = bg(t)
        fr = WIN.prep(fd.at(u))
        k = (.93 + .07 * a) * (1 + .028 * u / d) * (1 + .03 * b)
        place(im, fr, W / 2, CY + (1 - a) * 80 - b * 20, k, a * (1 - b), 1 - a, WIN.shadow)
        label(im, text, u, 1 - b)
        return im
    C.render(name, t0, t1, fn)

PC_L = Image.open(R + 's_pc_light.png').convert('RGB'); PC_D = Image.open(R + 's_pc_dark.png').convert('RGB')
MB_L = Image.open(R + 's_mob_light.png').convert('RGB'); MB_D = Image.open(R + 's_mob_dark.png').convert('RGB')
PH9, PH8 = Phone(880), Phone(760)
WIN2 = Card(int(W * .74), int(H * .74), 20)

def shot_reveal(name, t0, t1):
    d = t1 - t0; pc, mb = WIN2.prep(PC_L), PH8.img(MB_L)
    def fn(t, i):
        u = t - t0; a, b = env(u, d, 1.0); a2 = eo((u - .45) / .9); im = bg(t)
        place(im, pc, W / 2 - 170 - (1 - a) * 60, CY + 10 + (1 - a) * 90, (.94 + .06 * a) * (1 + .03 * u / d), a * (1 - b), 1 - a, WIN2.shadow)
        place(im, mb, 1540 + (1 - a2) * 140, CY + 50 + (1 - a2) * 60, (.95 + .05 * a2) * (1 + .02 * u / d), a2 * (1 - b), 0, PH8.shadow)
        label(im, 'CBE Reporting · ระบบรายงานผล Core Business Enablers', u - .3, 1 - b)
        return im
    C.render(name, t0, t1, fn)

def shot_login(name, t0, t1, ph_at):
    fd = Feed('r_login.mp4', .3); d = t1 - t0; mb = PH9.img(MB_L)
    def fn(t, i):
        u = t - t0; a, b = env(u, d); im = bg(t)
        m = eio((t - ph_at) / .9)
        fr = WIN.prep(fd.at(u))
        place(im, fr, W / 2 - 260 * m, CY + (1 - a) * 80, (.93 + .07 * a) * (1 - .14 * m) * (1 + .02 * u / d), a * (1 - b), 1 - a, WIN.shadow)
        if t > ph_at:
            p = eo((t - ph_at) / .9)
            place(im, mb, 1600 + (1 - p) * 300, CY + 30, .9 * (1 + .02 * u / d), p * (1 - b), 0, PH9.shadow)
        if t < ph_at + .2: label(im, 'เข้าสู่ระบบด้วยรหัสพนักงาน', u, (1 - b) * (1 - eo((t - ph_at) / .25)))
        else: label(im, 'ใช้ได้ทั้งคอมพิวเตอร์และมือถือ', t - ph_at - .1, 1 - b)
        return im
    C.render(name, t0, t1, fn)

def shot_phone(name, t0, t1, rec, start, text):
    fd = Feed(rec, start); d = t1 - t0; ghost = WIN2.prep(PC_L)
    def fn(t, i):
        u = t - t0; a, b = env(u, d); im = bg(t)
        place(im, ghost, W / 2 + 280, CY, .92, .28 * a * (1 - b), 0)
        place(im, PH9.img(fd.at(u)), 640, CY + 10 + (1 - a) * 110, (.94 + .06 * a) * (1 + .025 * u / d), a * (1 - b), 0, PH9.shadow)
        label(im, text, u, 1 - b)
        return im
    C.render(name, t0, t1, fn)

def shot_dark(name, t0, t1, wipe):
    d = t1 - t0
    L = (WIN2.prep(PC_L), PH8.img(MB_L)); D = (WIN2.prep(PC_D), PH8.img(MB_D))
    def fn(t, i):
        u = t - t0; a, b = env(u, d, .7, .6); im = bg(t)
        x = W * eio((t - wipe) / 1.0)
        def draw(pair, base):
            place(base, pair[0], W / 2 - 170, CY + 10 + (1 - a) * 60, (.95 + .05 * a) * (1 + .03 * u / d), a * (1 - b), 1 - a, WIN2.shadow)
            place(base, pair[1], 1540, CY + 50 + (1 - a) * 60, (.96 + .04 * a) * (1 + .02 * u / d), a * (1 - b), 0, PH8.shadow)
        if x <= 0: draw(L, im)
        elif x >= W: draw(D, im)
        else:
            l2, d2 = im.copy(), im.copy(); draw(L, l2); draw(D, d2)
            im = l2; im.paste(d2.crop((0, 0, int(x), H)), (0, 0))
            gl = Image.new('RGBA', (80, H), (0, 0, 0, 0)); ImageDraw.Draw(gl).rectangle((38, 0, 42, H), fill=(140, 190, 255, 255))
            im.alpha_composite(gl.filter(ImageFilter.GaussianBlur(5)), (int(x) - 40, 0))
        label(im, 'ธีมสว่าง / มืด · รายงาน ตรวจ ติดตาม แจ้งเตือน ครบในที่เดียว', u, 1 - b)
        return im
    C.render(name, t0, t1, fn)

# ---------------------------------------------------------------- LINE: icon intro, then the two phones
LINE_IC = Image.open('/home/claude/cbe-v2/line/line-icon.png').convert('RGBA')
def _halo(r, col):
    s = r * 3; im = Image.new('RGBA', (s, s), (0, 0, 0, 0)); ImageDraw.Draw(im).ellipse((r, r, 2 * r, 2 * r), fill=col + (200,))
    return im.filter(ImageFilter.GaussianBlur(r * .45))
HALO = _halo(240, (6, 199, 85))

def shot_line(name, t0, t1, cut, owner_at):
    fe = Feed('r_line_exec.mp4', delay=cut + .3 - 2.0); fo = Feed('r_line_owner.mp4', delay=.6)
    d = t1 - t0; ic0 = 300
    def fn(t, i):
        u = t - t0; im = bg(t); fe_fr, fo_fr = fe.at(u), fo.at(u)
        z = eio((u - cut) / .45)                                   # zoom-through into the phones
        if u < cut + .45:
            pop = eback(u / .75, 1.2); a = eo(u / .5) * (1 - eo((u - cut) / .3))
            cx, cy = W / 2, H / 2 - 70 + math.sin(u * 1.6) * 6
            h = HALO.copy(); h.putalpha(h.getchannel('A').point(lambda v: int(v * a * (.55 + .2 * math.sin(u * 3)))))
            im.alpha_composite(h, (int(cx - h.width / 2), int(cy - h.height / 2)))
            for st in (.7, 1.5, 2.3, 3.1):                          # notification ripples
                p = (u - st) / 1.3
                if 0 < p < 1:
                    r = ic0 * .55 + 260 * eo(p); ring = Image.new('RGBA', (W, H), (0, 0, 0, 0))
                    ImageDraw.Draw(ring).ellipse((cx - r, cy - r, cx + r, cy + r), outline=(60, 220, 120, int(150 * (1 - p) * a)), width=4)
                    im.alpha_composite(ring)
            k = (.55 + .45 * pop) * (1 + 1.6 * z)
            place(im, LINE_IC.resize((ic0, ic0), Image.LANCZOS), cx, cy, k, a)
            bp = eback((u - 1.0) / .45, 2.0)                        # unread badge
            if bp > 0:
                bd = Image.new('RGBA', (80, 80), (0, 0, 0, 0)); dd = ImageDraw.Draw(bd)
                dd.ellipse((4, 4, 76, 76), fill=(239, 68, 68, 255), outline=(255, 255, 255, 255), width=4)
                dd.text((40, 41), '2', font=F('Bold', 40), fill='white', anchor='mm')
                place(im, bd, cx + ic0 * k * .42, cy - ic0 * k * .42, max(.01, bp) * (1 + 1.5 * z), a)
            ta = eo((u - 1.1) / .6) * (1 - eo((u - cut + .5) / .4))
            if ta > 0:
                lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dl = ImageDraw.Draw(lay); yy = cy + 250 + (1 - ta) * 20
                dl.text((W / 2, yy), 'แจ้งเตือนผ่าน LINE', font=F('SemiBold', 58), fill=(245, 248, 255, int(255 * ta)), anchor='mm')
                dl.text((W / 2, yy + 66), 'สรุปผลรายไตรมาส  ·  งานที่ต้องทำรายเดือน', font=F('Regular', 32), fill=(170, 190, 225, int(255 * eo((u - 1.4) / .6) * ta)), anchor='mm')
                im.alpha_composite(lay)
        if u >= cut + .2:
            v = u - cut - .2; a = eo(v / .7); b = ei((u - (d - .45)) / .45)
            e = eio((t - owner_at) / .7)
            for k_, (fr, x, act) in enumerate(((fe_fr, W / 2 - 300, 1 - e), (fo_fr, W / 2 + 300, e))):
                aa = eo((v - .12 * k_) / .7)
                place(im, PH9.img(fr), x, CY + (1 - aa) * 60, (1.12 - .12 * aa) * (.92 + .08 * act), aa * (1 - b) * (.5 + .5 * act), 0, PH9.shadow)
            side(im, W / 2 - 560, 400, ['ผู้บริหาร', 'สรุปผลรายไตรมาส', 'คะแนนเทียบเป้าหมาย', 'ตัวชี้วัดที่ต้องเร่ง'], eo((v - .5) / .6) * (1 - b) * (.45 + .55 * (1 - e)), 'r')
            side(im, W / 2 + 545, 400, ['ผู้รับผิดชอบตัวชี้วัด', 'งานที่ต้องทำรายเดือน', 'รายการที่ยังไม่ครบ', 'พร้อมวันครบกำหนดส่ง'], eo((t - owner_at) / .6) * (1 - b), 'l')
            label(im, 'แจ้งเตือนผ่าน LINE', v, 1 - b)
        return im
    C.render(name, t0, t1, fn)

def side(im, x, y, lines, a, align):
    if a <= 0.01: return
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay); anc = 'ra' if align == 'r' else 'la'; yy = y + (1 - a) * 16
    d.text((x, yy), lines[0], font=F('SemiBold', 40), fill=(245, 248, 255, int(255 * a)), anchor=anc)
    d.text((x, yy + 60), lines[1], font=F('Medium', 30), fill=(120, 170, 255, int(255 * a)), anchor=anc)
    for k, s_ in enumerate(lines[2:]): d.text((x, yy + 112 + k * 42), s_, font=F('Regular', 27), fill=(170, 186, 215, int(255 * a)), anchor=anc)
    im.alpha_composite(lay)

# ---------------------------------------------------------------- opening: compressed and on the dark theme
def _cursor_white():
    im = Image.new('RGBA', (40, 52), (0, 0, 0, 0))
    ImageDraw.Draw(im).polygon([(4, 4), (4, 40), (14, 30), (22, 48), (28, 45), (20, 28), (34, 28)], fill=(255, 255, 255, 255), outline=(15, 23, 42, 255))
    return im

def omap(t):
    """output time -> original opening time (logo at 3.3 s, chaos collapses at 10.2 s)"""
    if t < 3.3: return 5.0 + t * (10.9 - 5.0) / 3.3
    if t < 5.0: return 10.9 + (t - 3.3)
    if t < 10.2: return 12.6 + (t - 5.0) * (18.3 - 12.6) / 5.2
    return 18.3 + (t - 10.2)

DARK = np.array((10, 20, 46), np.float32)
def shot_open(name, t0, t1):
    O.cursor = _cursor_white; O.BG = tuple(int(v) for v in DARK)
    O._fin = lambda im, u, t: np.asarray(im.convert('RGB'), np.float32)
    O.init(True, True); sprites, av, cur = O.SC[1], O.SC[2], O.SC[3]
    def fn(t, i):
        o = omap(t)
        if o < O.C0:
            img = O.frame_space(o).astype(np.float32) * eo(t / 1.0)
        else:
            b = bg_arr(t); O.SC = (Image.fromarray(b.astype(np.uint8)).convert('RGBA'), sprites, av, cur)
            img = O.frame_c(o)
            k = 1 - eo((o - O.C0) / .55)                         # in from the flare colour
            if k > 0: img = img * (1 - k) + DARK * k
            k2 = eio((o - 18.75) / .6)                           # out to the background
            if k2 > 0: img = img * (1 - k2) + b * k2
        return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    C.render(name, t0, t1, fn)

# ---------------------------------------------------------------- close: logo, line, QR to the login page
QR = Image.open('/home/claude/cbe-v3/assets/qr_login.png').convert('RGBA')
def shot_close(name, t0, t1, logo_at, txt_at, qr_at):
    O.init(True, False); base = O.SPACE[725:725 + H].copy()
    QS = 300; qr = QR.resize((QS, QS), Image.LANCZOS)
    LX, QX = W / 2 - 300, W / 2 + 420
    def fn(t, i):
        u = t - t0; img = base.copy() * eo(u / .8)
        m = eio((t - qr_at) / 1.0)
        O.LOGO_C = (W / 2 + (LX - W / 2) * m, 400 + 20 * m)
        if t >= logo_at:
            O.add_sprite(img, O.BURST, *O.LOGO_C, .7 * math.exp(-(t - logo_at) * 3))
            O.blend_logo(img, (.86 + .14 * eback((t - logo_at) / 1.1, .8)) * (1 - .22 * m), eo((t - logo_at) / .5))
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert('RGBA')
        a = eo((t - txt_at) / .7)
        if a > 0:
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); cx = W / 2 + (LX - W / 2) * m
            ImageDraw.Draw(lay).text((cx, 612 + (1 - a) * 18 - 10 * m), 'พร้อมใช้งาน ปีงบประมาณ 2570', font=F('SemiBold', 50), fill=(232, 240, 255, int(255 * a)), anchor='mm')
            im.alpha_composite(lay)
        if m > 0:
            y0 = int(270 + (1 - eo((t - qr_at) / 1.0)) * 50); x0 = int(QX - QS / 2 - 28); cw, ch = QS + 56, QS + 118
            card = glass(im, x0, y0, cw, ch, m, fill=(238, 226), r=30)
            q = qr.copy(); q.putalpha(int(255 * m)); im.alpha_composite(q, (x0 + 28, y0 + 28))
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dl = ImageDraw.Draw(lay)
            dl.text((QX, y0 + QS + 74), 'สแกนเพื่อเข้าสู่ระบบ', font=F('SemiBold', 30), fill=(14, 32, 80, int(255 * m)), anchor='mm')
            dl.text((QX, y0 + ch + 36), 'cbe-report.pages.dev', font=F('Medium', 28), fill=(170, 195, 240, int(220 * m)), anchor='mm')
            im.alpha_composite(lay)
        f = eio((t - (t1 - 1.3)) / 1.3)
        if f > 0: im = Image.blend(im.convert('RGB'), Image.new('RGB', (W, H), (0, 0, 0)), f)
        return im
    C.render(name, t0, t1, fn)

# ---------------------------------------------------------------- timeline from the recorded voice
P = [(sc, VO_OFFSET + a, VO_OFFSET + b, tx) for (sc, tx), (a, b) in zip(LINES, VO)]
def ps(i): return P[i][1]
def pe(i): return P[i][2]
def cut(i): return round(ps(i) - .35, 2)
END = round(pe(14) + 4.2, 2)
ORDER = ['a_open', 'b_reveal', 'c_login', 'd_over', 'f_score', 'e_mhome', 'g_wiz', 'h_gate', 'i_review', 'm_line', 'j_users', 'k_dark', 'l_close']
B = [0] + [cut(i) for i in range(2, 14)] + [END]
SEG = {n: (B[k], B[k + 1]) for k, n in enumerate(ORDER)}
def win(n): return SEG[n][1] - SEG[n][0]
def slow_for(rec, start, n):
    r = (dur(R + rec) - start) / (win(n) - .3); return r if r > 1 else max(r, .75)

JOBS = {
    'a_open': lambda: shot_open('a_open', *SEG['a_open']),
    'b_reveal': lambda: shot_reveal('b_reveal', *SEG['b_reveal']),
    'c_login': lambda: shot_login('c_login', *SEG['c_login'], ps(3) + 1.6),
    'd_over': lambda: shot_window('d_over', *SEG['d_over'], 'r_over.mp4', .4, 'ผู้บริหาร · ภาพรวม 8 ตัวชี้วัด เทียบเป้าหมาย', slow_for('r_over.mp4', .4, 'd_over')),
    'f_score': lambda: shot_window('f_score', *SEG['f_score'], 'r_score.mp4', .9, 'คะแนนคาดการณ์สิ้นปี 3 ระดับ · ขยับระดับไหนคุ้มที่สุด', slow_for('r_score.mp4', .9, 'f_score')),
    'e_mhome': lambda: shot_phone('e_mhome', *SEG['e_mhome'], 'r_mhome.mp4', .3, 'ผู้รายงาน · งานของฉัน รู้ว่าต้องทำอะไรต่อ'),
    'g_wiz': lambda: shot_window('g_wiz', *SEG['g_wiz'], 'r_wiz.mp4', .4, 'รายงานผลทีละขั้น · ลงผลรายเดือนอัตโนมัติ', slow_for('r_wiz.mp4', .4, 'g_wiz')),
    'h_gate': lambda: shot_window('h_gate', *SEG['h_gate'], 'r_gate.mp4', 0, 'ตรวจความพร้อมก่อนส่ง (Quality Gate)', slow_for('r_gate.mp4', 0, 'h_gate')),
    'i_review': lambda: shot_window('i_review', *SEG['i_review'], 'r_review.mp4', 0, 'พื้นที่ผู้ตรวจสอบ · ตรวจเบื้องต้นอัตโนมัติ 10 กฎ', slow_for('r_review.mp4', 0, 'i_review')),
    'm_line': lambda: shot_line('m_line', *SEG['m_line'], 4.3, ps(10) + 7.25),
    'j_users': lambda: shot_window('j_users', *SEG['j_users'], 'r_users.mp4', 0, 'สิทธิ์ตามบทบาท · ล็อกผลย้อนหลัง · Audit trail', slow_for('r_users.mp4', 0, 'j_users')),
    'k_dark': lambda: shot_dark('k_dark', *SEG['k_dark'], SEG['k_dark'][0] + 1.3),
    'l_close': lambda: shot_close('l_close', *SEG['l_close'], SEG['l_close'][0] + .7, ps(13), ps(14) - .3),
}

if __name__ == '__main__':
    if sys.argv[1:] == ['plan']:
        for n in ORDER: print(f'{n:9} {SEG[n][0]:7.2f} {SEG[n][1]:7.2f} {win(n):6.2f}')
        print('END', END)
    elif sys.argv[1] == 'still':          # still <segment> <time> ...: render single frames for checking
        n = sys.argv[2]; ts = [float(x) for x in sys.argv[3:]]; frames = []
        C.render = lambda name, a, b, fn: frames.extend((tt, fn(a + tt, 0)) for tt in ts)
        JOBS[n]()
        for tt, im in frames: (im if isinstance(im, Image.Image) else Image.fromarray(im)).convert('RGB').save(f'/home/claude/cbe-v3/still_{n}_{tt:.2f}.jpg', quality=88)
    else:
        for n in sys.argv[1:]: JOBS[n]()
