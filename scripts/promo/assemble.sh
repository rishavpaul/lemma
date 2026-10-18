set -e
cd "$(dirname "$0")"
XF=0.8
python3 - <<PY
import json, subprocess
XF = $XF
segs = json.load(open('rec/segs.json'))
# 1. each segment -> constant 30 fps 1080p clip
for s in segs:
    subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',f"rec/seg{s['k']}.txt",
        '-vf','fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=2','-t',str(s['len']),'-c:v','libx264','-preset','fast','-crf','12','-r','30','-an',f"rec/clip{s['k']}.mp4"], check=True)
# 2. dissolve chain
inputs = []; fl = []; cur = '[0:v]'; run = segs[0]['len']; offsets = [0.0]
for s in segs: inputs += ['-i', f"rec/clip{s['k']}.mp4"]
for k in range(1, len(segs)):
    off = run - XF; offsets.append(off)
    fl.append(f"{cur}[{k}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}[x{k}]"); cur = f'[x{k}]'
    run = off + segs[k]['len']
subprocess.run(['ffmpeg','-y','-v','error',*inputs,'-filter_complex',';'.join(fl),'-map',cur,'-c:v','libx264','-preset','slow','-crf','15','-pix_fmt','yuv420p','-r','30','video_only.mp4'], check=True)
# 3. voice placement
marks = []
for s, off in zip(segs, offsets):
    for m in s['marks']: marks.append((m['key'], off + m['rel']))
args = []; f2 = []
for i, (key, at) in enumerate(marks):
    args += ['-i', f'vo/{key}.wav']; ms = int(at*1000)
    f2.append(f"[{i}:a]adelay={ms}|{ms},highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=4,equalizer=f=3500:t=q:w=1.2:g=1.5[v{i}]")
mix = ''.join(f'[v{i}]' for i in range(len(marks))) + f'amix=inputs={len(marks)}:normalize=0[vo]'
subprocess.run(['ffmpeg','-y','-v','error',*args,'-filter_complex',';'.join(f2)+';'+mix,'-map','[vo]','-ar','48000','-ac','2','vo_mix.wav'], check=True)
print('video', round(run,2))
PY
VD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 video_only.mp4)
ffmpeg -y -v error -i music_raw.wav -i vo_mix.wav -filter_complex \
"[0:a]atrim=0:$VD,asetpts=N/SR/TB,volume=0.55,afade=t=out:st=$(python3 -c "print($VD-4)"):d=4[m];[1:a]apad=whole_dur=$VD,asplit=2[vs][vk];[m][vk]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=500:makeup=1[md];[md][vs]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]" \
-map "[a]" -ar 48000 -ac 2 mix.wav
ffmpeg -y -v error -i video_only.mp4 -i mix.wav -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart promo_new.mp4
ls -la promo_new.mp4; ffprobe -v error -show_entries format=duration -of csv=p=0 promo_new.mp4
