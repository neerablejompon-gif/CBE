import sys, os, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
sys.path.insert(0, '/home/claude/cbe-final')
import opening as O

W, H, FPS = 1920, 1080, 30
R = '/home/claude/cbe-rec2/'
OUT = '/home/claude/cbe-final/'
TH = '/usr/share/fonts/opentype/tlwg/Loma-Bold.otf'
IN = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
BG = (244, 248, 255); TINT = (234, 241, 255); BLUE = (31, 95, 224); NAVY = (7, 18, 44)


def smooth(x): x = max(0., min(1., x)); return x * x * (3 - 2 * x)
def spring(x): x = max(0., min(1., x)); return 1 - math.exp(-7 * x) * math.cos(10 * x)

# ------------------------------------------------------------------ assets
def make_bg():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    g = (yy / H)[..., None]
    a = np.array(BG, np.float32) * (1 - g * .6) + np.array(TINT, np.float32) * g * .6
    for cx, cy, r, c in ((260, 180, 520, (210, 226, 255)), (1700, 900, 620, (214, 230, 255)), (1500, 120, 380, (236, 230, 255))):
        d = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (r * r)))[..., None]
        a = a * (1 - d * .55) + np.array(c, np.float32) * d * .55
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGBA')
BGI = make_bg()


def rmask(w, h, r):
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255); return m


def shadow(w, h, r, blur=34, off=22, alpha=70):
    pad = blur * 3
    im = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((pad, pad + off, pad + w, pad + h + off), r, fill=(20, 45, 110, alpha))
    return im.filter(ImageFilter.GaussianBlur(blur)), pad


class Win:
    """A recording shown as a floating window"""
    def __init__(s, scale=0.84, radius=18):
        s.w, s.h = int(W * scale), int(H * scale); s.r = radius
        s.mask = rmask(s.w, s.h, radius); s.sh, s.pad = shadow(s.w, s.h, radius)
    def draw(s, im, fr, cx, cy, k=1.0, alpha=1.0):
        w, h = int(s.w * k), int(s.h * k)
        f = fr.resize((w, h), Image.BILINEAR).convert('RGBA')
        m = s.mask if k == 1.0 else rmask(w, h, s.r)
        if alpha < 1: m = m.point(lambda v: int(v * alpha))
        f.putalpha(m)
        sh = s.sh if k == 1.0 else s.sh.resize((int(s.sh.width * k), int(s.sh.height * k)))
        if alpha > .3: im.alpha_composite(sh, (int(cx - sh.width / 2), int(cy - sh.height / 2)))
        im.alpha_composite(f, (int(cx - w / 2), int(cy - h / 2)))


class Phone:
    def __init__(s, sh_h=900):
        s.sw = int(sh_h * 390 / 844); s.sh_h = sh_h; b = 16
        s.fw, s.fh = s.sw + b * 2, sh_h + b * 2; s.b = b
        fr = Image.new('RGBA', (s.fw, s.fh), (0, 0, 0, 0)); d = ImageDraw.Draw(fr)
        d.rounded_rectangle((0, 0, s.fw - 1, s.fh - 1), 62, fill=(12, 18, 34, 255))
        d.rounded_rectangle((3, 3, s.fw - 4, s.fh - 4), 59, outline=(70, 86, 120, 255), width=2)
        s.frame = fr; s.mask = rmask(s.sw, sh_h, 48)
        s.shd, s.pad = shadow(s.fw, s.fh, 62, 30, 24, 80)
        isl = Image.new('RGBA', (120, 34), (0, 0, 0, 0)); ImageDraw.Draw(isl).rounded_rectangle((0, 0, 119, 33), 17, fill=(5, 8, 16, 255)); s.isl = isl
    def draw(s, im, scr, cx, cy, k=1.0):
        base = s.frame.copy()
        f = scr.resize((s.sw, s.sh_h), Image.BILINEAR).convert('RGBA'); f.putalpha(s.mask)
        base.alpha_composite(f, (s.b, s.b)); base.alpha_composite(s.isl, (s.fw // 2 - 60, s.b + 12))
        sh = s.shd
        if k != 1.0:
            base = base.resize((int(base.width * k), int(base.height * k)), Image.BILINEAR)
            sh = sh.resize((int(sh.width * k), int(sh.height * k)))
        im.alpha_composite(sh, (int(cx - sh.width / 2), int(cy - sh.height / 2)))
        im.alpha_composite(base, (int(cx - base.width / 2), int(cy - base.height / 2)))


def pill(text, size=34):
    f = ImageFont.truetype(TH, size)
    tw = int(f.getlength(text)); w, h = tw + 64, size + 34
    im = Image.new('RGBA', (w + 40, h + 40), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((20, 26, 20 + w, 26 + h), h // 2, fill=(20, 45, 110, 60))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(im); d.rounded_rectangle((20, 20, 20 + w, 20 + h), h // 2, fill=(255, 255, 255, 245))
    d.ellipse((20 + 22, 20 + h / 2 - 7, 20 + 36, 20 + h / 2 + 7), fill=BLUE + (255,))
    d.text((20 + 46, 20 + h / 2), text, font=f, fill=(15, 23, 42, 255), anchor='lm')
    return im


def draw_pill(im, p, t0, t, x=86, y=26):
    a = smooth((t - t0) / 0.35)
    if a <= 0: return
    q = p if a >= 1 else p.copy()
    if a < 1: q.putalpha(q.split()[3].point(lambda v: int(v * a)))
    im.alpha_composite(q, (int(x - 20), int(y - 20 + (1 - a) * 14)))


class Clip:
    """Decodes a recording into PIL frames, hold-extended"""
    def __init__(s, path, start=0.0):
        pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True)
        s.w, s.h = map(int, pr.stdout.strip().split(','))
        s.p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-ss', str(start), '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
        s.last = None
    def next(s):
        b = s.p.stdout.read(s.w * s.h * 3)
        if len(b) == s.w * s.h * 3: s.last = Image.frombytes('RGB', (s.w, s.h), b)
        return s.last

# ------------------------------------------------------------------ writer
def writer(name):
    tmp = OUT + name + '.tmp.mp4'
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', tmp], stdin=subprocess.PIPE)
    return p, tmp


def render(name, t0, t1, fn):
    p, tmp = writer(name)
    n = round((t1 - t0) * FPS)
    for i in range(n):
        im = fn(t0 + i / FPS, i)
        if isinstance(im, Image.Image): im = np.asarray(im.convert('RGB'))
        p.stdin.write(np.ascontiguousarray(im).tobytes())
    p.stdin.close()
    if p.wait() == 0: os.replace(tmp, OUT + name + '.mp4')
    print(name, n)

# ------------------------------------------------------------------ scenes
WIN = Win(0.84); PH = Phone(900); PHS = Phone(760)
PC_L = Image.open(R + 's_pc_light.png').convert('RGB'); PC_D = Image.open(R + 's_pc_dark.png').convert('RGB')
MB_L = Image.open(R + 's_mob_light.png').convert('RGB'); MB_D = Image.open(R + 's_mob_dark.png').convert('RGB')
CY = H / 2 + 34


def seg_window(name, t0, t1, rec, start, label, slow=1.0):
    c = Clip(R + rec, start); p = pill(label); acc = [0.0]
    def fn(t, i):
        im = BGI.copy(); u = t - t0
        k = 0.95 + 0.05 * spring(u / 0.5)
        acc[0] += slow
        while acc[0] >= 1: fr = c.next(); acc[0] -= 1
        WIN.draw(im, c.last, W / 2, CY + math.sin(u * .8) * 3, k)
        draw_pill(im, p, t0 + .25, t)
        return im
    c.next(); acc[0] = 0
    render(name, t0, t1, fn)


def seg_reveal(name, t0, t1):
    p = pill('CBE Reporting · ระบบรายงานผล Core Business Enablers')
    def fn(t, i):
        u = t - t0; im = BGI.copy()
        a = spring((u - .1) / .7);
        if u > .1: WIN.draw(im, PC_L, W / 2 - 150 + (1 - a) * -60, CY + 10 + (1 - a) * 80, .72 + .06 * a + .01 * u / 6)
        b = spring((u - .7) / .7)
        if u > .7: PHS.draw(im, MB_L, 1530 + (1 - b) * 160, CY + 60 + math.sin(u * 1.1) * 6, .96 + .04 * b)
        draw_pill(im, p, t0 + 1.2, t)
        return im
    render(name, t0, t1, fn)


def seg_login(name, t0, t1, ph_at):
    c = Clip(R + 'r_login.mp4', 0.3); p = pill('เข้าสู่ระบบด้วยรหัสพนักงาน'); p2 = pill('ใช้ได้ทั้งคอมพิวเตอร์และมือถือ')
    def fn(t, i):
        u = t - t0; im = BGI.copy(); c.next()
        k = 0.95 + 0.05 * spring(u / .5)
        b = smooth((t - ph_at) / .6)
        WIN.draw(im, c.last, W / 2 - 250 * b, CY, k - .13 * b)
        if t > ph_at: PH.draw(im, MB_L, 1660 + (1 - spring((t - ph_at) / .7)) * 400, CY + 30, .92)
        draw_pill(im, p if t < ph_at else p2, t0 + .25 if t < ph_at else ph_at + .2, t)
        return im
    render(name, t0, t1, fn)


def seg_phone(name, t0, t1, rec, start, label, side_text=None):
    c = Clip(R + rec, start); p = pill(label)
    def fn(t, i):
        u = t - t0; im = BGI.copy(); c.next()
        WIN.draw(im, PC_L, W / 2 + 260, CY, .78, alpha=.35)
        b = spring(u / .6)
        PH.draw(im, c.last, 620, CY + 20 + (1 - b) * 120 + math.sin(u) * 4, .98 + .02 * b)
        draw_pill(im, p, t0 + .25, t)
        return im
    render(name, t0, t1, fn)


def seg_dark(name, t0, t1, wipe):
    p = pill('ธีมสว่าง / มืด · รายงาน ตรวจ ติดตาม ครบในที่เดียว')
    def fn(t, i):
        u = t - t0; im = BGI.copy()
        x = int(W * smooth((t - wipe) / .9))
        def both(pc, mb):
            j = BGI.copy(); WIN.draw(j, pc, W / 2 - 150, CY + 10, .76 + .004 * u); PHS.draw(j, mb, 1530, CY + 60 + math.sin(u) * 5, 1.0); return j
        L, D = both(PC_L, MB_L), both(PC_D, MB_D)
        if x <= 0: im = L
        elif x >= W: im = D
        else:
            im = L.copy(); im.paste(D.crop((0, 0, x, H)), (0, 0))
            ImageDraw.Draw(im).rectangle((x - 2, 0, x + 2, H), fill=(116, 166, 255, 255))
        draw_pill(im, p, t0 + .25, t)
        # fade to navy at end
        f = smooth((t - (t1 - .5)) / .5)
        if f > 0: im = Image.blend(im.convert('RGB'), Image.new('RGB', (W, H), NAVY), f)
        return im
    render(name, t0, t1, fn)


def seg_close(name, t0, t1, logo_at, url_at):
    O.init(True, False); O.LOGO_C = (W / 2, 390)
    yi = 725; base = O.SPACE[yi:yi + H].copy()
    fu = ImageFont.truetype(IN, 46); ft = ImageFont.truetype(TH, 44)
    def fn(t, i):
        u = t - t0
        img = base.copy() * smooth(u / .6)
        if t >= logo_at:
            b = math.exp(-(t - logo_at) * 3)
            O.add_sprite(img, O.BURST, *O.LOGO_C, .7 * b)
            O.blend_logo(img, .86 + .14 * spring((t - logo_at) / 1.0), smooth((t - logo_at) / .4))
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert('RGBA')
        a = smooth((t - url_at) / .5)
        if a > 0:
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
            y = 610 + (1 - a) * 16
            d.text((W / 2, y), 'พร้อมใช้งาน ปีงบประมาณ 2570', font=ft, fill=(220, 232, 255, int(255 * a)), anchor='mm')
            tw = fu.getlength('cbe-report.pages.dev'); bw = tw + 90
            d.rounded_rectangle((W / 2 - bw / 2, y + 50, W / 2 + bw / 2, y + 128), 39, fill=(31, 95, 224, int(235 * a)))
            d.text((W / 2, y + 89), 'cbe-report.pages.dev', font=fu, fill=(255, 255, 255, int(255 * a)), anchor='mm')
            im.alpha_composite(lay)
        f = smooth((t - (t1 - 1.2)) / 1.2)
        if f > 0: im = Image.blend(im.convert('RGB'), Image.new('RGB', (W, H), (0, 0, 0)), f)
        return im
    render(name, t0, t1, fn)


def seg_open(name, t0, t1):
    O.init(True, True)
    render(name, t0, t1, lambda t, i: O.frame(t))


if __name__ == '__main__':
    which = sys.argv[1:]
    S = {
        'a_open': lambda: seg_open('a_open', 0, 19.4),
        'b_reveal': lambda: seg_reveal('b_reveal', 19.4, 25.6),
        'c_login': lambda: seg_login('c_login', 25.6, 30.2, 27.7),
        'd_over': lambda: seg_window('d_over', 30.2, 37.9, 'r_over.mp4', 0.4, 'ภาพรวม 8 ตัวชี้วัด เทียบเป้าหมาย'),
        'e_mhome': lambda: seg_phone('e_mhome', 37.9, 43.9, 'r_mhome.mp4', 0.3, 'งานของฉัน · รู้ว่าต้องทำอะไรต่อ'),
        'f_score': lambda: seg_window('f_score', 43.9, 55.6, 'r_score.mp4', 0.0, 'คะแนนคาดการณ์สิ้นปี 3 ระดับ'),
        'g_wiz': lambda: seg_window('g_wiz', 55.6, 65.3, 'r_wiz.mp4', 0.4, 'รายงานผลทีละขั้น · ลงผลรายเดือนอัตโนมัติ', slow=1.16),
        'h_gate': lambda: seg_window('h_gate', 65.3, 71.3, 'r_gate.mp4', 0.0, 'ตรวจความพร้อมก่อนส่ง (Quality Gate)'),
        'i_review': lambda: seg_window('i_review', 71.3, 80.9, 'r_review.mp4', 0.0, 'พื้นที่ผู้ตรวจสอบ · ตรวจเบื้องต้นอัตโนมัติ 10 กฎ', slow=0.8),
        'j_users': lambda: seg_window('j_users', 80.9, 88.2, 'r_users.mp4', 0.0, 'สิทธิ์ตามบทบาท · Audit trail', slow=0.82),
        'k_dark': lambda: seg_dark('k_dark', 88.2, 92.6, 89.4),
        'l_close': lambda: seg_close('l_close', 92.6, 106.0, 93.3, 96.6),
    }
    for k in which: S[k]()
