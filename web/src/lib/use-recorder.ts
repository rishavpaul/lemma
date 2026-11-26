"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "./api";
import { speech } from "./speech";
import { useWakeLock } from "./use-wake-lock";

export type RecState = "idle" | "recording" | "transcribing";

/**
 * Record one spoken answer from the microphone, post it to `url` (an endpoint that returns `{ text }`) and hand the text to
 * `onText`. The audio is never kept in the page after upload. Keeps the screen awake while recording.
 */
export function useRecorder(url: string, onText: (text: string) => void) {
  const [rec, setRec] = useState<RecState>("idle");
  const media = useRef<{ recorder: MediaRecorder | null; stream: MediaStream | null; chunks: Blob[] }>({ recorder: null, stream: null, chunks: [] });
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; });
  useWakeLock(rec === "recording");

  async function upload(mime: string) {
    const fd = new FormData();
    fd.append("file", new Blob(media.current.chunks, { type: mime }), "clip." + (mime.includes("mp4") ? "mp4" : "webm"));
    media.current.chunks = [];
    try {
      const r = await api<{ text: string }>(url, { method: "POST", body: fd });
      onTextRef.current(r.text);
    } catch (e) { toast.error("Transcription failed", { description: (e as Error).message }); }
    setRec("idle");
  }

  async function start() {
    speech.stop();
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast.error("Microphone unavailable", { description: `${(e as Error).message}. Allow microphone access, then try again.` }); return; }
    const mime = ["audio/webm;codecs=opus", "audio/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) ?? "";
    const m = media.current;
    m.stream = stream; m.chunks = [];
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    m.recorder = recorder;
    recorder.ondataavailable = (e) => { if (e.data?.size) m.chunks.push(e.data); };
    recorder.onstop = () => void upload(recorder.mimeType || mime || "audio/webm");
    recorder.start(1000);
    setRec("recording");
  }

  function stop() {
    const m = media.current;
    setRec("transcribing");
    m.recorder?.stop();
    m.stream?.getTracks().forEach((t) => t.stop());
  }

  return { rec, start, stop };
}
