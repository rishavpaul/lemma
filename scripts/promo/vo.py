import json, re, sys, wave
import numpy as np
sys.path.insert(0, '/Users/rishavpaul/Projects/mercadore/lemma')
from kokoro_onnx import Kokoro
from app import tts
import ctypes
voice = sys.argv[1] if len(sys.argv) > 1 else 'af_heart'
speed = float(sys.argv[2]) if len(sys.argv) > 2 else 0.95
tts.warm() if False else None
import os
lib, data = tts._espeak()
from kokoro_onnx.config import EspeakConfig
k = Kokoro(str(tts.MODEL_DIR/'kokoro-v1.0.onnx'), str(tts.MODEL_DIR/'voices-v1.0.bin'), espeak_config=EspeakConfig(lib_path=lib, data_path=data))
lang = 'en-gb' if voice.startswith('b') else 'en-us'
sr = 24000
for key, text in json.load(open('narration.json')):
    parts = re.split(r'(?<=[.!?])\s+', text)
    out = []
    for i, s in enumerate(parts):
        a, r = k.create(s, voice=voice, speed=speed, lang=lang)
        a = np.asarray(a, dtype=np.float32)
        # trim silence at the ends
        idx = np.where(np.abs(a) > 0.01)[0]
        a = a[max(idx[0]-int(.02*r),0): idx[-1]+int(.06*r)] if len(idx) else a
        out.append(a); out.append(np.zeros(int(r*(0.5 if i < len(parts)-1 else 0)), np.float32))
    y = np.concatenate(out)
    with wave.open(f'vo/{key}.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(y,-1,1)*32767).astype(np.int16).tobytes())
    print(key, round(len(y)/sr, 2))
