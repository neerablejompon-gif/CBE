import sys, math, os, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H, FPS = 1920, 1080, 30
ASSETS = '/home/claude/neerablejompon-gif/cbe/mockup/assets'
OUT = '/home/claude/cbe-video'
NAVY = np.array([7, 18, 44], np.float32)
BLUE = (31, 95, 224)
BLUE2 = (20, 73, 184)
TINT = (234, 241, 255)
BG = (244, 248, 255)
rng = np.random.default_rng(7)


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease_out(x):
    x = clamp(x); return 1 - (1 - x) ** 3


def ease_in(x):
    x = clamp(x); return x ** 3


def smooth(x):
    x = clamp(x); return x * x * (3 - 2 * x)


def spring(x):
    x = clamp(x); return 1 - math.exp(-6 * x) * math.cos(9 * x)

# ---------------------------------------------------------------- scene A/B: space + horizon
PH = 2300
RIM_Y = 1500
R = 2600


def make_space():
    cx, cy = W / 2, RIM_Y + R
    yy, xx = np.mgrid[0:PH, 0:W].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    s = d - R
    out = s > 0
    so = np.clip(s, 0, None)
    si = np.clip(s, None, 0)
    hx = np.exp(-((xx - cx) / 650) ** 2)
    hxw = np.exp(-((xx - cx) / 1400) ** 2)
    rim = np.exp(-(s / 5) ** 2) * (0.35 + 0.65 * hxw)
    glow = (np.exp(-so / 70) * 0.6 + np.exp(-so / 300) * 0.35) * out * (0.25 + 0.75 * hx)
    beam = np.exp(-((xx - cx) / 220) ** 2) * np.exp(-so / 650) * out * 0.45
    inner = np.exp(si / 120) * (~out) * (0.2 + 0.8 * hxw) * 0.55
    # sky gradient
    sky = np.clip((RIM_Y - yy) / RIM_Y, 0, 1)
    base = NAVY[None, None, :] * (0.75 + 0.25 * (1 - sky[..., None]))
    base = np.where(out[..., None], base, np.array([3, 8, 22], np.float32))
    img = base.copy()
    img += glow[..., None] * np.array([45, 110, 255], np.float32)
    img += beam[..., None] * np.array([90, 150, 255], np.float32)
    img += inner[..., None] * np.array([31, 95, 224], np.float32)
    img += rim[..., None] * np.array([210, 230, 255], np.float32)
    # stars in sky only
    n = 900
    sx = rng.integers(0, W, n); sy = rng.integers(0, PH, n)
    br = rng.random(n) ** 3
    for x, y, b in zip(sx, sy, br):
        if s[y, x] > 25:
            v = 60 + 195 * b
            img[y, x] += v
            if b > 0.6:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if 0 <= x + dx < W and 0 <= y + dy < PH:
                        img[y + dy, x + dx] += v * 0.35
    return np.clip(img, 0, 255).astype(np.float32)


def glow_sprite(size, core=(255, 255, 255), halo=(116, 166, 255)):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    c = (size - 1) / 2
    d = np.sqrt((xx - c) ** 2 + (yy - c) ** 2) / c
    a_core = np.exp(-(d / 0.08) ** 2)
    a_halo = np.exp(-(d / 0.35) ** 2) * 0.8
    rgb = a_core[..., None] * np.array(core, np.float32) + a_halo[..., None] * np.array(halo, np.float32)
    return rgb  # additive


def add_sprite(img, spr, x, y, k=1.0):
    h, w = spr.shape[:2]
    x0, y0 = int(round(x - w / 2)), int(round(y - h / 2))
    sx0, sy0 = max(0, -x0), max(0, -y0)
    x1, y1 = min(W, x0 + w), min(H, y0 + h)
    if x1 <= max(0, x0) or y1 <= max(0, y0):
        return
    img[max(0, y0):y1, max(0, x0):x1] += spr[sy0:sy0 + (y1 - max(0, y0)), sx0:sx0 + (x1 - max(0, x0))] * k


SPACE = None
DOT = glow_sprite(140)
BURST = glow_sprite(900, core=(255, 255, 255), halo=(90, 150, 255))
_lg = Image.open(f'{ASSETS}/cbe-logo.png').convert('RGBA')
LOGO = Image.new('RGBA', (_lg.width + 200, _lg.height + 200), (0, 0, 0, 0)); LOGO.paste(_lg, (100, 100))
LOGO_W = int(820 * LOGO.width / _lg.width)
LOGO_C = (W / 2, 470)
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
DIST = np.sqrt((XX - W / 2) ** 2 + (YY - LOGO_C[1]) ** 2)


FLARE0 = 12.0
C0 = 12.6
def cam_y(t):
    if t < 6:
        return 300 + (700 - 300) * ease_out(t / 6)
    return 700 + 25 * smooth((t - 6) / 6.6)


def rim_y_frame(x, t):
    cy = RIM_Y + R - cam_y(t)
    return cy - math.sqrt(R * R - (x - W / 2) ** 2)


def blend_logo(img, scale, alpha):
    if alpha <= 0:
        return
    w = int(LOGO_W * scale); h = int(LOGO.height * w / LOGO.width)
    lg = LOGO.resize((w, h), Image.LANCZOS)
    glow = lg.filter(ImageFilter.GaussianBlur(28))
    for im, k, tint in ((glow, 0.9, True), (lg, 1.0, False)):
        a = np.asarray(im, np.float32)
        x0 = int(LOGO_C[0] - w / 2); y0 = int(LOGO_C[1] - h / 2)
        reg = img[y0:y0 + h, x0:x0 + w]
        al = a[..., 3:4] / 255 * alpha * k
        col = np.array([80, 140, 255], np.float32) if tint else a[..., :3]
        if tint:
            reg += al * col * 0.8
        else:
            reg[:] = reg * (1 - al) + col * al


def frame_space(t):
    y0 = cam_y(t)
    yi = int(y0); fr = y0 - yi
    img = SPACE[yi:yi + H] * (1 - fr) + SPACE[yi + 1:yi + 1 + H] * fr
    img = img.copy()
    # fade in from black
    img *= smooth(t / 1.6)
    # nine dots: 6.0 -> 9.0
    if 6.2 <= t < 11.05:
        for i in range(8):
            sx = 610 + i * 100
            st = 6.2 + abs(i - 3.5) * 0.12
            for g in range(6):
                tt = t - g * 0.035
                u = (tt - st) / (10.9 - st)
                if u < 0:
                    continue
                u2 = smooth(u)
                syy = rim_y_frame(sx, tt) - 4
                ex, ey = LOGO_C
                cx_, cy_ = sx, syy - 330
                bx = (1 - u2) ** 2 * sx + 2 * (1 - u2) * u2 * cx_ + u2 ** 2 * ex
                by = (1 - u2) ** 2 * syy + 2 * (1 - u2) * u2 * cy_ + u2 ** 2 * ey
                k = smooth((t - st) / 0.35) * (1 - g / 6) * (0.55 if g else 1.0)
                add_sprite(img, DOT, bx, by, k)
    # burst + logo
    if t >= 10.85:
        b = math.exp(-(t - 10.9) * 3.2) if t >= 10.9 else smooth((t - 10.85) / 0.05)
        add_sprite(img, BURST, *LOGO_C, 0.9 * b)
        u = (t - 10.9) / 1.0
        blend_logo(img, 0.82 + 0.18 * spring(u), smooth((t - 10.9) / 0.3))
    # flare to white 11.2 -> 12
    if t >= FLARE0:
        u = ease_in((t - FLARE0) / 0.6)
        r = 50 + u * 2400
        m = np.clip((r - DIST) / 420, 0, 1) * min(1, 0.25 + u)
        img = img + (m * (1 - m) * 2.2)[..., None] * 255
        img = img * (1 - m[..., None]) + np.array(BG, np.float32) * m[..., None]
    return np.clip(img, 0, 255).astype(np.uint8)

# ---------------------------------------------------------------- scene C: white space, chaos


def rr(d, box, r, fill, outline=None, width=1):
    d.rounded_rectangle(box, r, fill=fill, outline=outline, width=width)


def window(w, h, kind):
    pad = 60
    im = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 18, pad + w, pad + h + 18), 22, fill=(20, 50, 120, 60))
    sh = sh.filter(ImageFilter.GaussianBlur(24))
    im = Image.alpha_composite(im, sh)
    d = ImageDraw.Draw(im)
    rr(d, (pad, pad, pad + w, pad + h), 20, (255, 255, 255, 255), (222, 230, 244, 255), 2)
    for i, c in enumerate([(255, 120, 110), (255, 196, 90), (90, 200, 130)]):
        d.ellipse((pad + 22 + i * 22, pad + 20, pad + 34 + i * 22, pad + 32), fill=c + (255,))
    rr(d, (pad + 110, pad + 18, pad + w - 30, pad + 34), 8, (238, 242, 249, 255))
    x0, y0 = pad + 24, pad + 56
    if kind == 'sheet':
        cols, rows = 6, 9
        cw = (w - 48) / cols; rh = (h - 80) / rows
        for r_ in range(rows):
            for c_ in range(cols):
                box = (x0 + c_ * cw, y0 + r_ * rh, x0 + (c_ + 1) * cw, y0 + (r_ + 1) * rh)
                f = (255, 255, 255, 255)
                if r_ == 0: f = (234, 241, 255, 255)
                elif rng.random() < 0.12: f = (255, 236, 200, 255)
                d.rectangle(box, fill=f, outline=(226, 232, 242, 255))
                if r_ and rng.random() < 0.6:
                    d.rectangle((box[0] + 8, box[1] + rh / 2 - 3, box[0] + 8 + rng.random() * (cw - 24), box[1] + rh / 2 + 3), fill=(200, 210, 228, 255))
    elif kind == 'browser':
        rr(d, (x0, y0, x0 + (w - 48) * 0.6, y0 + 26), 8, (226, 232, 242, 255))
        rr(d, (x0 + (w - 48) * 0.55, y0 + 50, x0 + w - 48, y0 + h - 100), 14, (234, 241, 255, 255))
        for i in range(4):
            rr(d, (x0, y0 + 50 + i * 40, x0 + (w - 48) * 0.45, y0 + 70 + i * 40), 6, (238, 242, 249, 255))
    elif kind == 'chat':
        y = y0 + 6
        for i, (wd, me) in enumerate([(0.62, 0), (0.48, 1), (0.7, 0), (0.4, 1)]):
            bw = (w - 48) * wd
            bx = x0 + (w - 48 - bw if me else 0)
            rr(d, (bx, y, bx + bw, y + 46), 18, (31, 95, 224, 255) if me else (238, 242, 249, 255))
            y += 62
    elif kind == 'file':
        rr(d, (x0 + (w - 48) / 2 - 40, y0 + 10, x0 + (w - 48) / 2 + 40, y0 + 110), 10, (234, 241, 255, 255), (31, 95, 224, 255), 3)
        for i in range(3):
            d.line((x0 + (w - 48) / 2 - 22, y0 + 40 + i * 20, x0 + (w - 48) / 2 + 22, y0 + 40 + i * 20), fill=(31, 95, 224, 255), width=4)
        rr(d, (x0 + 10, y0 + 130, x0 + w - 58, y0 + 146), 6, (226, 232, 242, 255))
    return im


def avatar(size=132):
    im = Image.new('RGBA', (size + 40, size + 40), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((20, 30, 20 + size, 30 + size), fill=(20, 50, 120, 70))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(12)))
    d = ImageDraw.Draw(im)
    d.ellipse((20, 20, 20 + size, 20 + size), fill=(255, 255, 255, 255))
    d.ellipse((28, 28, 12 + size, 12 + size), fill=TINT + (255,))
    c = 20 + size / 2
    d.ellipse((c - 24, c - 40, c + 24, c + 8), fill=BLUE + (255,))
    d.chord((c - 46, c + 10, c + 46, c + 90), 180, 360, fill=BLUE + (255,))
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse((28, 28, 12 + size, 12 + size), fill=255)
    inner = Image.new('RGBA', im.size, (0, 0, 0, 0))
    inner.paste(im, (0, 0), mask)
    base = Image.new('RGBA', im.size, (0, 0, 0, 0))
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(12)))
    ImageDraw.Draw(base).ellipse((20, 20, 20 + size, 20 + size), fill=(255, 255, 255, 255))
    return Image.alpha_composite(base, inner)


def cursor():
    im = Image.new('RGBA', (40, 52), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pts = [(4, 4), (4, 40), (14, 30), (22, 48), (28, 45), (20, 28), (34, 28)]
    d.polygon(pts, fill=(15, 23, 42, 255), outline=(255, 255, 255, 255))
    return im


def clock(t, size=380):
    S = size * 2
    im = Image.new('RGBA', (S, S + 60), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((10, 50, S - 10, S + 40), fill=BLUE2 + (255,))      # thickness
    d.ellipse((10, 10, S - 10, S - 10), fill=BLUE + (255,))
    d.ellipse((40, 40, S - 40, S - 40), fill=(255, 255, 255, 255))
    c = S / 2
    for i in range(12):
        a = i / 12 * 2 * math.pi
        r1, r2 = c - 70, c - (90 if i % 3 else 110)
        d.line((c + r1 * math.sin(a), c - r1 * math.cos(a), c + r2 * math.sin(a), c - r2 * math.cos(a)), fill=(150, 170, 205, 255), width=8)
    am = t * 2 * math.pi * 1.6
    ah = t * 2 * math.pi * 0.25
    for a, L, wd, col in ((ah, c * 0.42, 22, (40, 60, 100)), (am, c * 0.66, 14, BLUE)):
        d.line((c, c, c + L * math.sin(a), c - L * math.cos(a)), fill=col + (255,), width=wd)
    d.ellipse((c - 18, c - 18, c + 18, c + 18), fill=BLUE + (255,))
    im = im.resize((size, int(size * 0.86) + 30), Image.LANCZOS).rotate(14, resample=Image.BICUBIC, expand=True)
    sh = Image.new('RGBA', (im.width + 80, im.height + 80), (0, 0, 0, 0))
    a = im.split()[3].point(lambda v: v * 0.3)
    shadow = Image.new('RGBA', im.size, (20, 50, 120, 255)); shadow.putalpha(a)
    sh.paste(shadow, (40, 70), shadow)
    sh = sh.filter(ImageFilter.GaussianBlur(20))
    sh.alpha_composite(im, (40, 40))
    return sh


def spinner(t, size=90):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    st = (t * 400) % 360
    d.arc((6, 6, size - 6, size - 6), 0, 360, fill=(226, 232, 242, 255), width=9)
    d.arc((6, 6, size - 6, size - 6), st, st + 100, fill=BLUE + (255,), width=9)
    return im


SC = None


def build_c():
    bgarr = np.zeros((H, W, 3), np.float32)
    g = (YY / H)[..., None]
    bgarr[:] = np.array(BG, np.float32) * (1 - g * 0.5) + np.array(TINT, np.float32) * g * 0.5
    bg = Image.fromarray(bgarr.astype(np.uint8)).convert('RGBA')
    # (kind, w, h, x, y, rot, depth)
    specs = [
        ('sheet', 560, 400, 180, 120, -6, 0.5),
        ('browser', 600, 380, 1250, 90, 5, 0.6),
        ('chat', 420, 300, 1380, 610, -4, 0.9),
        ('sheet', 520, 360, 120, 600, 4, 1.0),
        ('file', 230, 200, 900, 760, -8, 1.2),
        ('browser', 420, 280, 760, 60, -3, 0.35),
        ('file', 200, 180, 1720, 380, 9, 0.4),
        ('sheet', 380, 260, 560, 820, 7, 0.45),
    ]
    sprites = []
    for kind, w, h, x, y, rot, dep in specs:
        sp = window(w, h, kind).rotate(rot, resample=Image.BICUBIC, expand=True)
        if dep < 0.55:
            sp = sp.resize((int(sp.width * 0.8), int(sp.height * 0.8)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
            a = sp.split()[3].point(lambda v: v * 0.75); sp.putalpha(a)
        sprites.append((sp, x, y, dep, kind))
    sprites.sort(key=lambda s: s[3])
    return bg, sprites, avatar(), cursor()


def frame_c(t):
    bg, sprites, av, cur = SC
    u = t - C0
    im = bg.copy()
    kc = smooth((t - 18.3) / 0.8)
    for sp, x, y, dep, kind in sprites:
        dx = -u * 22 * dep + math.sin(u * 1.3 + x) * 6
        dy = math.cos(u * 1.1 + y) * 8 * dep
        cx0, cy0 = x + dx + sp.width / 2, y + dy + sp.height / 2
        if kc > 0:
            sc = 1 - 0.75 * kc
            spk = sp.resize((max(1, int(sp.width * sc)), max(1, int(sp.height * sc))))
            ncx, ncy = cx0 + (W / 2 - cx0) * kc, cy0 + (H / 2 - cy0) * kc
            im.alpha_composite(spk, (int(ncx - spk.width / 2), int(ncy - spk.height / 2)))
            continue
        im.alpha_composite(sp, (int(x + dx), int(y + dy)))
        if kind == 'browser' and dep > 0.5:
            spn = spinner(t)
            im.alpha_composite(spn, (int(x + dx + sp.width * 0.33), int(y + dy + sp.height * 0.5)))
    ck = clock(t)
    if kc < 0.9: im.alpha_composite(ck, (int(W / 2 - ck.width / 2 - u * 30), int(H / 2 - ck.height / 2 - 30)))
    ax, ay = 560 - u * 26, 330
    if kc > 0.5: return _fin(im, u, t)
    im.alpha_composite(av, (int(ax), int(ay)))
    cx = ax + 150 + math.sin(u * 4.2) * 60 + u * 40
    cy = ay - 10 + math.sin(u * 2.7 + 1) * 40
    im.alpha_composite(cur, (int(cx), int(cy)))
    return _fin(im, u, t)

def _fin(im, u, t):
    arr = np.asarray(im.convert('RGB'), np.float32)
    k = 1 - smooth(u / 0.55)
    k = max(k, smooth((t - 18.75) / 0.55))
    if k > 0:
        arr = arr * (1 - k) + np.array(BG, np.float32) * k
    return arr.astype(np.uint8)


def frame(t):
    return frame_space(t) if t < C0 else frame_c(t)


def init(need_space=True, need_c=True):
    global SPACE, SC
    if need_space and SPACE is None:
        SPACE = make_space()
    if need_c and SC is None:
        SC = build_c()


if __name__ == '__main__' and False:
    mode = sys.argv[1]
    if mode == 'still':
        ts = [float(x) for x in sys.argv[2:]]
        init(any(t < 12 for t in ts), any(t >= 12 for t in ts))
        for t in ts:
            Image.fromarray(frame(t)).save(f'{OUT}/still_{t:05.2f}.jpg', quality=90)
    else:
        a, b, name = float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
        init(a < 12, b > 12)
        tmp = f'{OUT}/{name}.tmp.mp4'
        p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', tmp], stdin=subprocess.PIPE)
        n = round((b - a) * FPS)
        for i in range(n):
            p.stdin.write(frame(a + i / FPS).tobytes())
        p.stdin.close()
        if p.wait() == 0:
            os.replace(tmp, f'{OUT}/{name}.mp4')
