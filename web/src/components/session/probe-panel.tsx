"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Mic, RotateCcw, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useWakeLock } from "@/lib/use-wake-lock";
import { speech, useSpeech } from "@/lib/speech";
import { ListenButton } from "@/components/listen-button";
import type { Section } from "@/lib/types";

/** The single probe exchange after a section: wait for the question, answer once, then move on. */
export function ProbePanel({ sec, sessionId, onChange, interactive }: { sec: Section; sessionId: string; onChange: () => Promise<unknown>; interactive?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<"idle" | "recording" | "transcribing">("idle");
  const media = useRef<{ recorder: MediaRecorder | null; stream: MediaStream | null; chunks: Blob[] }>({ recorder: null, stream: null, chunks: [] });
  useWakeLock(rec === "recording");
  const tts = useSpeech();
  const question = sec.probe?.question;
  const spoken = question ? `${question}${sec.probe?.hint ? ` A nudge: ${sec.probe.hint}` : ""}` : "";
  const spokenRef = useRef(spoken);
  useEffect(() => { spokenRef.current = spoken; });
  useEffect(() => {
    if ((tts.autoRead || interactive) && question) speech.enqueue(`probe:${sec.key}`, spokenRef.current);
  }, [question, sec.key, tts.autoRead, interactive]);
  const probe = sec.probe;
  const job = sec.probe_job;
  const failed = !probe?.question && !!job && (job.status === "failed" || job.status === "pending_retry");
  const base = `/api/sessions/${sessionId}/sections/${sec.key}/probe`;

  async function act(fn: () => Promise<unknown>, error: string) {
    setBusy(true);
    try { await fn(); await onChange(); } catch (e) { toast.error(error, { description: (e as Error).message }); }
    setBusy(false);
  }

  async function startRec() {
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
  function stopRec() {
    const m = media.current;
    setRec("transcribing");
    m.recorder?.stop();
    m.stream?.getTracks().forEach((t) => t.stop());
  }
  async function upload(mime: string) {
    const fd = new FormData();
    fd.append("file", new Blob(media.current.chunks, { type: mime }), "clip." + (mime.includes("mp4") ? "mp4" : "webm"));
    try {
      const r = await api<{ text: string }>(`${base}/transcribe`, { method: "POST", body: fd });
      setText((t) => (t.trim() ? t.trimEnd() + " " : "") + r.text);
    } catch (e) { toast.error("Transcription failed", { description: (e as Error).message }); }
    setRec("idle");
  }

  return (
    <div className="rise space-y-5" aria-live="polite">
      <h2 className="display text-[2.1rem]">The interviewer asks</h2>
      <p className="-mt-3 text-[14px] text-muted-foreground">One follow-up on {sec.title}. Answer it once, then move on.</p>

      {!probe?.question && !failed && (
        <div className="flex items-center gap-3 rounded-[3px] bg-card px-5 py-6 text-[15px]"><Loader2 className="size-5 animate-spin text-signal" />The interviewer is reading your answer…</div>
      )}

      {failed && (
        <div className="space-y-3 rounded-[3px] bg-coral/10 p-4 text-[15px]">
          <p className="text-coral">Could not get a probe: {job?.error || job?.status}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => act(() => api(`/api/jobs/${job!.id}/retry`, { method: "POST" }), "Retry failed")}><RotateCcw /> Try again</Button>
            <Button variant="ghost" disabled={busy} onClick={() => act(() => api(base, { method: "DELETE" }), "Could not skip")}><SkipForward /> Skip the probe</Button>
          </div>
        </div>
      )}

      {probe?.question && (
        <>
          <div className="space-y-3">
            <p className="statement text-[1.35rem]">{probe.question}</p>
            <ListenButton id={`probe:${sec.key}`} label="Read it to me" text={spoken} />
            {probe.hint && <p className="text-[15px] text-muted-foreground"><span className="font-semibold text-foreground">A nudge: </span>{probe.hint}</p>}
          </div>
          <div>
            <label htmlFor="probe-answer" className="mb-2 block text-[15px] font-semibold">Your answer</label>
            <textarea id="probe-answer" autoFocus value={text} onChange={(e) => setText(e.target.value)}
              className="min-h-[180px] w-full resize-y rounded-[3px] bg-card p-4 font-serif text-[1.05rem] leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-ring"
              placeholder="Answer once, then move on. This is read by the graders along with the section." />
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {rec === "recording" ? (
                <Button size="lg" variant="destructive" onClick={stopRec}><Square /> Stop recording</Button>
              ) : (
                <Button size="lg" variant="outline" disabled={busy || rec === "transcribing"} onClick={startRec}>
                  {rec === "transcribing" ? <Loader2 className="animate-spin" /> : <Mic />}{rec === "transcribing" ? "Transcribing…" : "Record answer"}
                </Button>
              )}
              <Button variant="design" size="lg" disabled={busy || rec !== "idle" || !text.trim()} onClick={() => act(() => api(`${base}/answer`, { method: "PUT", body: { text } }), "Could not save the answer")}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}Submit and continue
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
