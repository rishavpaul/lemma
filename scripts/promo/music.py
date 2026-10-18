import numpy as np, wave
from scipy.signal import butter, sosfilt, fftconvolve
sr = 44100; bpm = 76; beat = 60/bpm; bar = 4*beat
dur = 120; N = int(dur*sr); rng = np.random.default_rng(3)
def hz(m): return 440*2**((m-69)/12)
# progression (midi note lists), one per bar, 4-bar loop
chords = [[50,57,61,64,69],   # Dmaj9-ish (D A C# E A)
          [47,54,57,62,66],   # Bm11 (B F# A D F#)
          [43,50,55,59,64],   # Gmaj9 (G D G B E)
          [45,52,57,61,66]]   # A6/9 (A E A C# F#)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=sr, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=sr, output='sos'), x)
t = np.arange(N)/sr
pad = np.zeros(N); arp = np.zeros(N); sub = np.zeros(N); bell = np.zeros(N)
nbars = int(dur/bar)
for b in range(nbars):
    ch = chords[b % 4]; s0 = int(b*bar*sr); L = int((bar+2.2)*sr); L = min(L, N-s0)
    tt = np.arange(L)/sr
    env = np.minimum(tt/1.6, 1)*np.exp(-np.maximum(tt-bar, 0)/0.9)
    for m in ch:
        for det in (-0.07, 0, 0.09):
            f = hz(m)*2**(det/12); ph = rng.uniform(0, 1)
            saw = 2*((tt*f+ph) % 1)-1
            pad[s0:s0+L] += saw*env*0.035
    sub[s0:s0+L] += np.sin(2*np.pi*hz(ch[0]-12)*tt)*env*0.22
    # arpeggio: 8th notes through chord tones an octave up, soft felt pluck
    order = [1,2,3,4,3,2,3,2]
    for i in range(8):
        n0 = s0 + int(i*beat/2*sr); m = ch[order[i]] + 12
        l = int(1.6*sr); l = min(l, N-n0)
        if l <= 0: continue
        x = np.arange(l)/sr; f = hz(m)
        v = (np.sin(2*np.pi*f*x) + 0.35*np.sin(2*np.pi*2*f*x)*np.exp(-x*6) + 0.12*np.sin(2*np.pi*3*f*x)*np.exp(-x*10))
        v *= np.exp(-x*3.2)*np.minimum(x/0.004, 1)*(0.9 if i % 2 == 0 else 0.55)
        arp[n0:n0+l] += v*0.10
    # high bell on the downbeat, a fifth-ish color
    n0 = s0 + int(2*beat*sr); l = min(int(3*sr), N-n0)
    if l > 0:
        x = np.arange(l)/sr; f = hz(ch[4]+12)
        bell[n0:n0+l] += (np.sin(2*np.pi*f*x)+0.4*np.sin(2*np.pi*2.76*f*x)*np.exp(-x*3))*np.exp(-x*1.4)*0.05
pad = lp(pad, 1800, 2)
# slow filter-like swell on the pad
pad *= 0.75 + 0.25*np.sin(2*np.pi*t/(bar*4))
dry = pad + arp + sub + bell
# stereo: slight decorrelation + reverb
def ir(sec, seed):
    r = np.random.default_rng(seed); n = int(sec*sr); x = r.standard_normal(n)*np.exp(-np.arange(n)/sr*3.0)
    return lp(x, 5500, 1)*0.02
wet_l = fftconvolve(arp+bell+pad*0.8, ir(2.8, 1))[:N]; wet_r = fftconvolve(arp+bell+pad*0.8, ir(2.8, 2))[:N]
dl = np.roll(arp, int(0.19*sr))*0.35; dr = np.roll(arp, int(0.28*sr))*0.35
L = dry + wet_l*0.9 + dl; R = dry + wet_r*0.9 + dr
y = np.stack([hp(L, 35), hp(R, 35)], 1)
# global intro fade-in, final fade-out
y *= np.minimum(t/3, 1)[:, None]
y /= np.max(np.abs(y))*1.15
with wave.open('music_raw.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((y*32767).astype(np.int16).tobytes())
print('ok')
