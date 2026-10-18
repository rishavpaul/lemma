set -e
cd "$(dirname "$0")"
# video: constant 30 fps, 1080p
ffmpeg -y -v error -f concat -safe 0 -i rec/list.txt -vf "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf 15 -r 30 -an video_only.mp4
VD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 video_only.mp4)
# voice track: place each clip at its mark
python3 - <<PY
import json
m = json.load(open('rec/marks.json'))
args = []; fl = []
for i, x in enumerate(m):
    args += ['-i', f"vo/{x['key']}.wav"]
    fl.append(f"[{i}:a]adelay={int(x['at']*1000)}|{int(x['at']*1000)},highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=4,equalizer=f=3500:t=q:w=1.2:g=1.5[v{i}]")
mix = ''.join(f'[v{i}]' for i in range(len(m))) + f'amix=inputs={len(m)}:normalize=0[vo]'
open('vo_cmd.txt','w').write(' '.join(args) + '\n' + ';'.join(fl) + ';' + mix)
PY
ARGS=$(sed -n 1p vo_cmd.txt); FC=$(sed -n 2p vo_cmd.txt)
ffmpeg -y -v error $ARGS -filter_complex "$FC" -map "[vo]" -ar 48000 -ac 2 vo_mix.wav
# music: trim, fade, duck under voice, master
ffmpeg -y -v error -i music_raw.wav -i vo_mix.wav -filter_complex \
"[0:a]atrim=0:$VD,asetpts=N/SR/TB,volume=0.55,afade=t=out:st=$(python3 -c "print($VD-4)"):d=4[m];[1:a]asplit=2[vs][vk];[m][vk]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=500:makeup=1[md];[md][vs]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]" \
-map "[a]" -ar 48000 -ac 2 mix.wav
ffmpeg -y -v error -i video_only.mp4 -i mix.wav -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart promo_new.mp4
ls -la promo_new.mp4; ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact promo_new.mp4
