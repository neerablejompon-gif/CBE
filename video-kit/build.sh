#!/usr/bin/env bash
# CBE Reporting launch video — full rebuild (1920x1080, 30 fps, 1:46)
# Needs: python3 (numpy, Pillow, playwright), node, ffmpeg, google-chrome at /usr/bin/google-chrome
# Usage: bash build.sh /path/to/voice.wav /path/to/music.mp3 [/path/to/CBE-repo]
set -euo pipefail
VO="${1:?voice wav}"; MUSIC="${2:?music mp3}"; REPO="${3:-/home/claude/neerablejompon-gif/cbe}"
KIT="$(cd "$(dirname "$0")" && pwd)"

# 0) Same folder layout the scripts expect (absolute paths inside the scripts)
mkdir -p /home/claude/cbe-data/site /home/claude/cbe-rec2 /home/claude/cbe-final
[ -d /home/claude/neerablejompon-gif/cbe ] || { mkdir -p /home/claude/neerablejompon-gif; ln -s "$REPO" /home/claude/neerablejompon-gif/cbe; }
cp "$KIT"/data/gen.js /home/claude/cbe-data/
cp "$KIT"/record/*.py /home/claude/cbe-rec2/
cp "$KIT"/compose/*.py /home/claude/cbe-final/

# 1) Synthetic demo data (no real report content) + local copy of the real UI
cd /home/claude/cbe-data && node gen.js
cp "$REPO"/mockup/index.html site/ && cp -r "$REPO"/mockup/assets site/ && cp data.js data-2570.js site/
(cd site && python3 -m http.server 8790 >/dev/null 2>&1 &) ; sleep 1

# 2) Screen recordings of the real UI (PC 1280x720 @1.5x, mobile 390x844 @2x)
cd /home/claude/cbe-rec2
python3 scenes.py stills sc_login sc_overview sc_mhome sc_score
python3 scenes.py sc_wizard sc_gate sc_review sc_users

# 3) Compose segments (two jobs in parallel)
cd /home/claude/cbe-final
python3 compose.py a_open b_reveal c_login d_over e_mhome f_score &
python3 compose.py l_close k_dark j_users i_review h_gate g_wiz &
wait
printf "file '%s.mp4'\n" a_open b_reveal c_login d_over e_mhome f_score g_wiz h_gate i_review j_users k_dark l_close > list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy video.mp4

# 4) Audio: voice normalised and placed at 9.5 s; music from 20 s, ducked under the voice
#    Voice is cut at 91.0 s (stray word "หมายเหตุ" at the end of the file)
ffmpeg -y -loglevel error -i "$VO" -af "atrim=end=91.0,afade=t=out:st=90.85:d=0.15,aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000" vo_n.wav
ffmpeg -y -loglevel error -i "$MUSIC" -af "atrim=start=20,asetpts=PTS-STARTPTS,aresample=48000" mu.wav
ffmpeg -y -loglevel error -i vo_n.wav -i mu.wav -filter_complex "
[0:a]pan=stereo|c0=c0|c1=c0,adelay=9500|9500,apad[vo];
[1:a]volume=eval=frame:volume='if(lt(t,9.0),0.6,if(lt(t,9.6),0.6-(t-9.0)/0.6*0.42,if(lt(t,100.6),0.18,if(lt(t,101.4),0.18+(t-100.6)/0.8*0.42,0.6))))',afade=t=in:d=0.8,afade=t=out:st=104.3:d=1.7[mu];
[vo][mu]amix=inputs=2:normalize=0:duration=shortest,alimiter=limit=0.95,volume=-1.8dB,atrim=0:106[a]" -map "[a]" -c:a aac -b:a 192k mix.m4a
ffmpeg -y -loglevel error -i video.mp4 -i mix.m4a -map 0:v -map 1:a -c:v copy -c:a copy -movflags +faststart CBE_Reporting_Launch.mp4
echo "done: /home/claude/cbe-final/CBE_Reporting_Launch.mp4"
