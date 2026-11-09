import sys, subprocess
from PIL import Image
f, times = sys.argv[1], [float(t) for t in sys.argv[2:]]
ims=[]
for t in times:
    subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str(t),'-i',f,'-frames:v','1','/tmp/_f.png']); ims.append(Image.open('/tmp/_f.png').convert('RGB'))
w,h=ims[0].size; sc=640/w if w>h else 300/w; ims=[i.resize((int(w*sc),int(h*sc))) for i in ims]
W=sum(i.width for i in ims[:3]); rows=(len(ims)+2)//3; H=max(i.height for i in ims)
s=Image.new('RGB',(W,H*rows),'white')
for k,i in enumerate(ims): s.paste(i,(sum(x.width for x in ims[(k//3)*3:k]) ,(k//3)*H))
s.save(f.replace('.mp4','_sheet.jpg'),quality=75)
