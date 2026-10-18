"use client";
import { useSyncExternalStore } from "react";

/**
 * Read-aloud for articles, questions and feedback. One module-level player, so only one thing speaks at a time.
 *
 * Two voices: the Mac's neural voice (Kokoro, POST /api/tts, played through an <audio> element) when it is ready, and the
 * browser's own speechSynthesis otherwise. Text is spoken in short chunks; the server voice prefetches the next chunk while
 * the current one plays. Browser pause is "stop and resume from this chunk" because pause() is unreliable on iOS.
 */

export interface VoiceInfo { uri: string; name: string; lang: string }
export type Engine = "server" | "browser";
interface State {
  supported: boolean; engine: Engine; playingId: string | null; paused: boolean; rate: number;
  voiceURI: string; serverVoice: string; /** the selection for the active engine */ voice: string;
  autoRead: boolean; voices: VoiceInfo[];
}

const KEY = "sdc.tts";
const initial: State = { supported: false, engine: "browser", playingId: null, paused: false, rate: 1, voiceURI: "", serverVoice: "", voice: "", autoRead: false, voices: [] };
let state: State = initial;
const listeners = new Set<() => void>();
let started = false;
let token = 0;
let chunks: string[] = [];
let pos = 0;
let queue: { id: string; text: string }[] = [];
let unlocked = false;
let browserVoices: VoiceInfo[] = [];
let serverVoices: VoiceInfo[] = [];
let serverReady = false;
let lastCheck = 0;
let audio: HTMLAudioElement | null = null;
let clips = new Map<number, Promise<string>>();

function derive(s: State): State {
  const engine: Engine = serverReady ? "server" : "browser";
  return { ...s, engine, voices: engine === "server" ? serverVoices : browserVoices, voice: engine === "server" ? s.serverVoice : s.voiceURI,
    supported: serverReady || typeof window !== "undefined" && "speechSynthesis" in window };
}
function set(patch: Partial<State>) { state = derive({ ...state, ...patch }); listeners.forEach((l) => l()); }
function synth(): SpeechSynthesis | null { return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null; }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ rate: state.rate, voiceURI: state.voiceURI, serverVoice: state.serverVoice, autoRead: state.autoRead })); } catch { /* private mode */ }
}

function loadVoices() {
  const s = synth(); if (!s) return;
  browserVoices = s.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en")).map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
  set({});
}

const VOICE_KIND: Record<string, string> = { af: "US woman", am: "US man", bf: "UK woman", bm: "UK man" };
/** Asks the Mac whether its neural voice is loaded. Cheap; repeated until it is ready, then cached for the page. */
async function checkServer() {
  lastCheck = Date.now();
  try {
    const r = await fetch("/api/tts/status");
    if (!r.ok) return;
    const j = await r.json() as { ready: boolean; voices: string[]; default_voice: string };
    if (!j.ready) return;
    serverVoices = j.voices.map((v) => ({ uri: v, name: `${v.slice(3).replace(/^./, (c) => c.toUpperCase())} (${VOICE_KIND[v.slice(0, 2)] ?? "voice"})`, lang: "en" }));
    serverReady = true;
    const chosen = serverVoices.some((v) => v.uri === state.serverVoice) ? state.serverVoice : j.default_voice;
    set({ serverVoice: chosen });
  } catch { /* offline or not signed in: stay on browser voices */ }
}

function start() {
  if (started) return;
  started = true;
  let saved: Partial<State> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { /* ignore */ }
  set({ rate: saved.rate ?? 1, voiceURI: saved.voiceURI ?? "", serverVoice: saved.serverVoice ?? "", autoRead: saved.autoRead ?? false });
  const s = synth();
  if (s) { loadVoices(); s.addEventListener?.("voiceschanged", loadVoices); }
  void checkServer();
}

/** The saved browser voice if it still exists, else the best English one installed (Premium/Enhanced first). */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const all = synth()?.getVoices() ?? [];
  const en = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return all.find((v) => v.voiceURI === state.voiceURI)
    ?? en.find((v) => /premium|enhanced/i.test(v.name))
    ?? en.find((v) => /^(samantha|ava|allison|daniel|karen|serena)/i.test(v.name))
    ?? en.find((v) => v.lang === "en-US") ?? en[0];
}

export function chunkText(text: string, max = 260): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let cur = "";
    for (const sentence of para.split(/(?<=[.!?:;])\s+/)) {
      if (cur && cur.length + sentence.length + 1 > max) { out.push(cur); cur = ""; }
      if (sentence.length > max) {
        // a run-on sentence: break it at commas, then at spaces
        for (const piece of sentence.split(/(?<=,)\s+/)) {
          let rest = piece;
          while (rest.length > max) { const cut = rest.lastIndexOf(" ", max); const at = cut > 0 ? cut : max; out.push(rest.slice(0, at)); rest = rest.slice(at).trim(); }
          if (rest) cur = cur ? `${cur} ${rest}` : rest;
          if (cur.length > max * 0.8) { out.push(cur); cur = ""; }
        }
      } else cur = cur ? `${cur} ${sentence}` : sentence;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.filter((c) => /\w/.test(c));
}

/** Markdown to something worth hearing: no symbols read aloud, code and tables replaced by a short spoken note. */
export function mdToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "\n(code block skipped).\n")
    .replace(/(^[ \t]*\|.*\|[ \t]*\n?)+/gm, "(table skipped).\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]*(.+?)[ \t]*#*$/gm, "$1.")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/(\*\*|__|\*|`|~~)/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/\n{2,}/g, "\n");
}


/** Playback finished: start whatever was queued, else go idle. */
function finishAll() {
  const next = queue.shift();
  if (next) begin(next.id, next.text); else set({ playingId: null, paused: false });
}

// ---- browser voice ----

function speakFrom(i: number) {
  const s = synth(); if (!s) { set({ playingId: null, paused: false }); return; }
  const mine = ++token;
  s.cancel();
  const run = (k: number) => {
    if (mine !== token) return;
    if (k >= chunks.length) { finishAll(); return; }
    pos = k;
    const u = new SpeechSynthesisUtterance(chunks[k]);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = state.rate;
    u.onend = () => run(k + 1);
    u.onerror = (e) => { if (e.error === "interrupted" || e.error === "canceled") return; run(k + 1); };
    s.speak(u);
  };
  setTimeout(() => run(i), 60); // Safari drops a speak() issued in the same tick as cancel()
}

// ---- Mac neural voice ----

function player(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    (audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    audio.preservesPitch = true;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => speech.resume());
      navigator.mediaSession.setActionHandler("pause", () => speech.pause());
    }
  }
  return audio;
}
function clearClips() { for (const p of clips.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {}); clips = new Map(); }
function fetchClip(k: number): Promise<string> {
  let p = clips.get(k);
  if (!p) {
    p = (async () => {
      const r = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: chunks[k], voice: state.serverVoice }) });
      if (!r.ok) throw new Error(`tts ${r.status}`);
      return URL.createObjectURL(await r.blob());
    })();
    clips.set(k, p);
  }
  return p;
}
function serverFrom(i: number) {
  const mine = ++token;
  synth()?.cancel();
  clearClips();
  const a = player();
  const run = async (k: number) => {
    if (mine !== token) return;
    if (k >= chunks.length) { finishAll(); return; }
    pos = k;
    let url: string;
    try { url = await fetchClip(k); }
    catch { if (mine === token) { serverReady = false; set({}); speakFrom(k); } return; } // the Mac voice failed: finish with the browser voice
    if (mine !== token) return;
    void fetchClip(k + 1).catch(() => {}); // generate the next chunk while this one plays
    a.src = url;
    a.defaultPlaybackRate = state.rate;
    a.playbackRate = state.rate;
    a.onended = () => run(k + 1);
    a.onerror = () => run(k + 1);
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: "Lemma", artist: "Reading aloud" });
    try { await a.play(); } catch { if (mine === token) set({ playingId: null, paused: false }); } // blocked: needs a tap first
  };
  void run(i);
}

function begin(id: string, text: string) {
  chunks = chunkText(text);
  if (!chunks.length) { finishAll(); return; }
  if (!serverReady && Date.now() - lastCheck > 15_000) void checkServer(); // the model may have finished loading since
  set({ playingId: id, paused: false });
  if (serverReady) serverFrom(0); else speakFrom(0);
}

function silentWav(): string {
  const n = 2400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export const speech = {
  /** Speak now, replacing whatever is playing or queued. For buttons the user pressed. */
  play(id: string, text: string) { start(); queue = []; begin(id, text); },
  /** Speak after what is playing (or now, if idle). For automatic reading, so feedback never cuts off an intro or the other way round. */
  enqueue(id: string, text: string) {
    start();
    if (state.playingId === id || queue.some((q) => q.id === id)) return;
    if (state.playingId) queue.push({ id, text }); else begin(id, text);
  },
  /** iOS only lets audio start from a tap the first time on a page. Call this from a tap handler so later automatic speech is allowed. */
  unlock() {
    if (unlocked) return;
    unlocked = true;
    try { const a = player(); a.src = silentWav(); void a.play().catch(() => {}); } catch { /* no audio */ }
    const s = synth(); if (s) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; s.speak(u); }
  },
  pause() {
    if (!state.playingId || state.paused) return;
    if (serverReady) player().pause(); else { token++; synth()?.cancel(); }
    set({ paused: true });
  },
  resume() {
    if (!state.playingId || !state.paused) return;
    set({ paused: false });
    if (serverReady && player().src) void player().play().catch(() => serverFrom(pos)); else if (serverReady) serverFrom(pos); else speakFrom(pos);
  },
  stop() {
    token++; queue = [];
    synth()?.cancel();
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    clearClips();
    set({ playingId: null, paused: false });
  },
  current: () => state.playingId,
  setRate(rate: number) { set({ rate }); if (audio && serverReady) audio.playbackRate = rate; save(); },
  setVoice(voice: string) {
    if (serverReady) { set({ serverVoice: voice }); if (state.playingId) { const id = state.playingId; speech.play(id, chunks.join(" ")); } } else set({ voiceURI: voice });
    save();
  },
  setAutoRead(autoRead: boolean) { set({ autoRead }); save(); },
};

function subscribe(l: () => void) { start(); listeners.add(l); return () => { listeners.delete(l); }; }
export function useSpeech(): State { return useSyncExternalStore(subscribe, () => state, () => initial); }

/** What is read aloud when a section's grade arrives: the grader's short spoken version when there is one, else the verdict and gaps. */
export function feedbackSpeech(title: string, g: { score: number; summary: string; spoken_feedback?: string; gap_summary?: string; gaps?: { description: string }[] }): string {
  const score = `Score ${g.score.toFixed(1)} out of 4.`;
  if (g.spoken_feedback?.trim()) return `${title}. ${score} ${g.spoken_feedback.trim()}`;
  const gaps = g.gap_summary ?? (g.gaps?.length ? `Main gaps. ${g.gaps.slice(0, 2).map((x) => x.description).join(" ")}` : "");
  return `Feedback on ${title}. ${score} ${g.summary} ${gaps}`.trim();
}
