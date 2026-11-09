#!/usr/bin/env bash
# CBE Reporting launch video v2 (2:16): new narration timing, LINE mock-up scene, QR close, RAOT logo badge
# Run ../build.sh steps 0-2 first (synthetic data, local server on :8790, screen recordings in /home/claude/cbe-rec2).
# Usage: bash build_v2.sh /path/to/music.mp3 [/path/to/new-voice.wav]
set -euo pipefail
MUSIC="${1:?music mp3}"; VO="${2:-}"
V2="$(cd "$(dirname "$0")" && pwd)"; W=/home/claude/cbe-v2
mkdir -p $W/out $W/assets /home/claude/cbe-data/site/line
cp "$V2"/*.py $W/; cp "$V2"/assets/* $W/assets/; cp "$V2"/line/* /home/claude/cbe-data/site/line/

# 1) Extra recordings: LINE mock-ups (executive / indicator owner) and a longer users scene
cd /home/claude/cbe-rec2 && python3 $W/scenes2.py sc_line_exec sc_line_owner sc_users

# 2) Compose (segment times come from script.py; edit it after recording the real voice)
cd $W && python3 compose2.py plan
python3 compose2.py a_open m_line l_close c_login d_over &
python3 compose2.py f_score e_mhome g_wiz h_gate &
python3 compose2.py i_review j_users k_dark b_reveal &
wait
printf "file 'out/%s.mp4'\n" a_open b_reveal c_login d_over f_score e_mhome g_wiz h_gate i_review m_line j_users k_dark l_close > list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy video_raw.mp4
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 video_raw.mp4)

# 3) RAOT logo badge, top right (fades in at 1 s, out with the final fade)
ffmpeg -y -loglevel error -i video_raw.mp4 -loop 1 -t $D -i assets/raot_badge.png -filter_complex \
 "[1:v]format=rgba,fade=t=in:st=1.0:d=0.8:alpha=1,fade=t=out:st=$(python3 -c "print($D-1.4)"):d=1.0:alpha=1[b];[0:v][b]overlay=x=W-w-12:y=2:shortest=1,format=yuv420p[v]" \
 -map "[v]" -c:v libx264 -preset medium -crf 17 video_badge.mp4

# 4) Music 130 s is shorter than the video: play 20-86.8 s then loop back 17 bars (to 44.2 s) with a 1.5 s crossfade
ffmpeg -y -loglevel error -i "$MUSIC" -filter_complex "[0:a]atrim=20:86.79,asetpts=PTS-STARTPTS[a];[0:a]atrim=44.23:130.32,asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=1.5:c1=tri:c2=tri,aresample=48000[m]" -map "[m]" mu_loop.wav
if [ -z "$VO" ]; then
  # no voice yet: music bed + narration subtitles (guide) and a clean copy
  ffmpeg -y -loglevel error -i mu_loop.wav -af "volume=eval=frame:volume='if(lt(t,9.0),0.6,if(lt(t,9.6),0.6-(t-9.0)/0.6*0.3,if(lt(t,$D-6),0.3,if(lt(t,$D-5.2),0.3+(t-($D-6))/0.8*0.3,0.6))))',afade=t=in:d=0.8,afade=t=out:st=$(python3 -c "print($D-2.2)"):d=2.2,atrim=0:$D,alimiter=limit=0.95" -c:a aac -b:a 192k music_bed.m4a
  python3 subs.py
  ffmpeg -y -loglevel error -i video_badge.mp4 -i music_bed.m4a -map 0:v -map 1:a -c copy -movflags +faststart CBE_Reporting_Launch_v2_clean.mp4
  ffmpeg -y -loglevel error -i video_badge.mp4 -i music_bed.m4a -map 0:v -map 1:a -vf ass=narration.ass -c:v libx264 -preset medium -crf 18 -c:a copy -movflags +faststart CBE_Reporting_Launch_v2_guide.mp4
else
  # with the recorded voice: placed at 9.5 s, music ducked to 0.18 under it
  ffmpeg -y -loglevel error -i "$VO" -af "aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000" vo_n.wav
  ffmpeg -y -loglevel error -i vo_n.wav -i mu_loop.wav -filter_complex "
  [0:a]pan=stereo|c0=c0|c1=c0,adelay=9500|9500,apad[vo];
  [1:a]volume=eval=frame:volume='if(lt(t,9.0),0.6,if(lt(t,9.6),0.6-(t-9.0)/0.6*0.42,if(lt(t,$D-5.6),0.18,if(lt(t,$D-4.8),0.18+(t-($D-5.6))/0.8*0.42,0.6))))',afade=t=in:d=0.8,afade=t=out:st=$(python3 -c "print($D-2.2)"):d=2.2[mu];
  [vo][mu]amix=inputs=2:normalize=0:duration=shortest,alimiter=limit=0.95,volume=-1.8dB,atrim=0:$D[a]" -map "[a]" -c:a aac -b:a 192k mix.m4a
  ffmpeg -y -loglevel error -i video_badge.mp4 -i mix.m4a -map 0:v -map 1:a -c copy -movflags +faststart CBE_Reporting_Launch_v2.mp4
fi
echo "done: $W"
