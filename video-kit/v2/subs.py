import re, sys
sys.path.insert(0, '/home/claude/cbe-v2')
from compose2 import P
def ts(t): h=int(t//3600); m=int(t%3600//60); s=t%60; return f'{h}:{m:02d}:{s:05.2f}'
def chunks(tx, n=46):
    out, cur = [], ''
    for w in tx.split(' '):
        if cur and len(cur) + 1 + len(w) > n: out.append(cur); cur = w
        else: cur = (cur + ' ' + w).strip()
    out.append(cur); return out
ev = []
for sc, a, b, tx in P:
    cs = chunks(tx); L = [len(re.sub(r'\s', '', c)) for c in cs]; t = a
    for c, l in zip(cs, L):
        d = (b - a) * l / sum(L); ev.append((t, t + d, c)); t += d
hdr = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: N,Loma,44,&H00FFFFFF,&H00FFFFFF,&H502C1207,&H502C1207,1,0,0,0,100,100,0,0,3,14,0,2,80,80,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
open('/home/claude/cbe-v2/narration.ass', 'w').write(hdr + ''.join(f'Dialogue: 0,{ts(a)},{ts(b)},N,,0,0,0,,{c}\n' for a, b, c in ev))
print(len(ev), 'events')
