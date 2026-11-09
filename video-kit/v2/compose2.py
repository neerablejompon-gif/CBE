# CBE Reporting launch video v2: new narration timing, LINE notification scene, QR close
import sys, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, '/home/claude/cbe-final'); sys.path.insert(0, '/home/claude/cbe-v2')
import compose as C
import opening as O
from script import LINES, RATE, GAP
import re

C.OUT = '/home/claude/cbe-v2/out/'
W, H, CY, R = C.W, C.H, C.CY, C.R
THR = '/usr/share/fonts/opentype/tlwg/Loma.otf'
QR = Image.open('/home/claude/cbe-v2/assets/qr.png').convert('RGB')


def dur(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                                capture_output=True, text=True).stdout)


# ---------------------------------------------------------------- narration timeline
def paragraphs():
    """Start/end of each paragraph; first two lines reuse the measured timing of the old voice"""
    P, t = [], None
    for i, (sc, tx) in enumerate(LINES):
        d = len(re.sub(r'[\s…?,.]', '', tx)) / RATE
        if i == 0: a, b = 9.5, 11.46
        elif i == 1: a, b = 12.18, 18.66
        elif i == 2: a = 19.75; b = a + d
        else: a = t + GAP; b = a + d
        P.append((sc, a, b, tx)); t = b
    return P


P = paragraphs()
def ps(i): return P[i][1]
def pe(i): return P[i][2]
END = pe(14) + 4.2


def slow_for(rec, start, win):
    r = (dur(R + rec) - start) / win
    return r if r > 1 else max(r, 0.75)


# ---------------------------------------------------------------- LINE scene
FT = ImageFont.truetype(C.TH, 44); FS = ImageFont.truetype(THR, 30); PHL = C.Phone(880)


def side_text(im, x, y, lines, a, align):
    if a <= 0: return
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    anc = 'ra' if align == 'r' else 'la'; yy = y + (1 - a) * 14
    d.text((x, yy), lines[0], font=FT, fill=(15, 23, 42, int(255 * a)), anchor=anc)
    d.text((x, yy + 64), lines[1], font=ImageFont.truetype(C.TH, 32), fill=C.BLUE + (int(255 * a),), anchor=anc)
    for k, s in enumerate(lines[2:]):
        d.text((x, yy + 118 + k * 44), s, font=FS, fill=(71, 85, 105, int(255 * a)), anchor=anc)
    im.alpha_composite(lay)


def seg_line(name, t0, t1, owner_at):
    ce, co = C.Clip(R + 'r_line_exec.mp4'), C.Clip(R + 'r_line_owner.mp4')
    p = C.pill('แจ้งเตือนผ่าน LINE · ภาพจำลองฟีเจอร์ถัดไป')
    def fn(t, i):
        u = t - t0; im = C.BGI.copy()
        if u >= 1.2: ce.next()
        if u >= 1.3: co.next()
        e = C.smooth((t - owner_at) / .6)          # 0 = exec emphasised, 1 = owner emphasised
        for k, (clip, x, act) in enumerate(((ce, W / 2 - 300, 1 - e), (co, W / 2 + 300, e))):
            b = C.spring((u - .15 * k) / .7)
            lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            PHL.draw(lay, clip.last, x, CY + 18 + (1 - b) * 140 + math.sin(u * .9 + k) * 4, .92 + .08 * act)
            if act < 1: lay.putalpha(lay.split()[3].point(lambda v, f=.55 + .45 * act: int(v * f)))
            im.alpha_composite(lay)
        side_text(im, W / 2 - 575, 380, ['ผู้บริหาร', 'สรุปผลรายไตรมาส', 'คะแนนเทียบเป้าหมาย', 'ตัวชี้วัดที่ต้องเร่ง'], C.smooth((u - 1.2) / .5), 'r')
        side_text(im, W / 2 + 575, 380, ['ผู้รับผิดชอบตัวชี้วัด', 'งานที่ต้องทำรายเดือน', 'รายการที่ยังไม่ครบ', 'พร้อมวันครบกำหนดส่ง'], C.smooth((t - owner_at) / .5), 'l')
        C.draw_pill(im, p, t0 + .25, t)
        return im
    ce.next(); co.next(); C.render(name, t0, t1, fn)


# ---------------------------------------------------------------- close with QR
def seg_close(name, t0, t1, logo_at, txt_at, qr_at):
    O.init(True, False)
    yi = 725; base = O.SPACE[yi:yi + H].copy()
    ft = ImageFont.truetype(C.TH, 46); fu = ImageFont.truetype(C.IN, 30); fq = ImageFont.truetype(C.TH, 30)
    QS = 300; qr = QR.resize((QS, QS), Image.LANCZOS)
    LX, QX = W / 2 - 300, W / 2 + 420           # left column (logo + text) and QR card centres
    def fn(t, i):
        u = t - t0
        img = base.copy() * C.smooth(u / .6)
        m = C.smooth((t - qr_at) / .8)            # logo slides left when the QR appears
        O.LOGO_C = (W / 2 + (LX - W / 2) * m, 400 + 20 * m)
        if t >= logo_at:
            b = math.exp(-(t - logo_at) * 3)
            O.add_sprite(img, O.BURST, *O.LOGO_C, .7 * b)
            O.blend_logo(img, (.86 + .14 * C.spring((t - logo_at) / 1.0)) * (1 - .22 * m), C.smooth((t - logo_at) / .4))
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert('RGBA')
        a = C.smooth((t - txt_at) / .5)
        lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
        if a > 0:
            cx = W / 2 + (LX - W / 2) * m; y = 610 + (1 - a) * 16 - 10 * m
            d.text((cx, y), 'พร้อมใช้งาน ปีงบประมาณ 2570', font=ft, fill=(220, 232, 255, int(255 * a)), anchor='mm')
        if m > 0:
            x0 = int(QX - QS / 2 - 26); y0 = int(290 + (1 - C.spring((t - qr_at) / .9)) * 60)
            d.rounded_rectangle((x0, y0, x0 + QS + 52, y0 + QS + 104), 28, fill=(255, 255, 255, int(250 * m)))
            q = qr.copy().convert('RGBA'); q.putalpha(int(255 * m)); lay.alpha_composite(q, (x0 + 26, y0 + 26))
            d.text((QX, y0 + QS + 66), 'สแกนเพื่อเข้าใช้งาน', font=fq, fill=(20, 45, 110, int(255 * m)), anchor='mm')
            d.text((QX, y0 + QS + 150), 'cbe-report.pages.dev', font=fu, fill=(190, 210, 245, int(230 * m)), anchor='mm')
        im.alpha_composite(lay)
        f = C.smooth((t - (t1 - 1.2)) / 1.2)
        if f > 0: im = Image.blend(im.convert('RGB'), Image.new('RGB', (W, H), (0, 0, 0)), f)
        return im
    C.render(name, t0, t1, fn)


# ---------------------------------------------------------------- segment plan
def cut(i): return round(ps(i) - .35, 2)     # a segment ends just before paragraph i starts

SEG = {}
def plan():
    b = [0, 19.4, cut(3), cut(4), cut(5), cut(6), cut(7), cut(8), cut(9), cut(10), cut(11), cut(12), cut(13), END]
    names = ['a_open', 'b_reveal', 'c_login', 'd_over', 'f_score', 'e_mhome', 'g_wiz', 'h_gate', 'i_review', 'm_line', 'j_users', 'k_dark', 'l_close']
    for k, n in enumerate(names): SEG[n] = (round(b[k], 2), round(b[k + 1], 2))
plan()


def win(n): a, b = SEG[n]; return b - a


_pill = C.pill
C.pill = lambda text, size=34: _pill(text.replace('ธีมสว่าง / มืด · รายงาน ตรวจ ติดตาม ครบในที่เดียว', 'ธีมสว่าง / มืด · รายงาน ตรวจ ติดตาม แจ้งเตือน ครบในที่เดียว'), size)

JOBS = {
    'a_open': lambda: C.seg_open('a_open', *SEG['a_open']),
    'b_reveal': lambda: C.seg_reveal('b_reveal', *SEG['b_reveal']),
    'c_login': lambda: C.seg_login('c_login', *SEG['c_login'], ps(3) + 2.3),
    'd_over': lambda: C.seg_window('d_over', *SEG['d_over'], 'r_over.mp4', 0.4, 'ผู้บริหาร · ภาพรวม 8 ตัวชี้วัด เทียบเป้าหมาย', slow_for('r_over.mp4', .4, win('d_over'))),
    'f_score': lambda: C.seg_window('f_score', *SEG['f_score'], 'r_score.mp4', 0.9, 'คะแนนคาดการณ์สิ้นปี 3 ระดับ · ขยับระดับไหนคุ้มที่สุด', slow_for('r_score.mp4', .9, win('f_score'))),
    'e_mhome': lambda: C.seg_phone('e_mhome', *SEG['e_mhome'], 'r_mhome.mp4', 0.3, 'ผู้รายงาน · งานของฉัน รู้ว่าต้องทำอะไรต่อ'),
    'g_wiz': lambda: C.seg_window('g_wiz', *SEG['g_wiz'], 'r_wiz.mp4', 0.4, 'รายงานผลทีละขั้น · ลงผลรายเดือนอัตโนมัติ', slow_for('r_wiz.mp4', .4, win('g_wiz'))),
    'h_gate': lambda: C.seg_window('h_gate', *SEG['h_gate'], 'r_gate.mp4', 0.0, 'ตรวจความพร้อมก่อนส่ง (Quality Gate)', slow_for('r_gate.mp4', 0, win('h_gate'))),
    'i_review': lambda: C.seg_window('i_review', *SEG['i_review'], 'r_review.mp4', 0.0, 'พื้นที่ผู้ตรวจสอบ · ตรวจเบื้องต้นอัตโนมัติ 10 กฎ', slow_for('r_review.mp4', 0, win('i_review'))),
    'm_line': lambda: seg_line('m_line', *SEG['m_line'], ps(10) + 8.6),
    'j_users': lambda: C.seg_window('j_users', *SEG['j_users'], 'r_users.mp4', 0.0, 'สิทธิ์ตามบทบาท · ล็อกผลย้อนหลัง · Audit trail', slow_for('r_users.mp4', 0, win('j_users'))),
    'k_dark': lambda: C.seg_dark('k_dark', *SEG['k_dark'], SEG['k_dark'][0] + 1.2),
    'l_close': lambda: seg_close('l_close', *SEG['l_close'], SEG['l_close'][0] + .7, ps(13), ps(14) - .3),
}
ORDER = list(SEG)

if __name__ == '__main__':
    if sys.argv[1:] == ['plan']:
        for n in ORDER: print(f'{n:9} {SEG[n][0]:7.2f} {SEG[n][1]:7.2f} {win(n):6.2f}')
        for k, (sc, a, b, tx) in enumerate(P): print(f'  P{k:<2} {a:7.2f} {b:7.2f} {tx[:30]}')
        print('END', round(END, 2))
    else:
        for n in sys.argv[1:]: JOBS[n]()
