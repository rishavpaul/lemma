"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, MessageCircleQuestion, Mic, RotateCcw, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Section } from "@/lib/types";

/** The single probe exchange after a section: wait for the question, answer once, then move on. */
export function ProbePanel({ sec, sessionId, onChange }: { sec: Section; sessionId: string; onChange: () => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<"idle" | "recording" | "transcribing">("idle");
  const media = useRef<{ recorder: MediaRecorder | null; stream: MediaStream | null; chunks: Blob[] }>({ recorder: null, stream: null, chunks: [] });
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
    <div className="mt-2 space-y-4" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><MessageCircleQuestion className="size-4" />Interviewer probe on “{sec.title}”</div>

      {!probe?.question && !failed && (
        <div className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-5 text-sm"><Loader2 className="size-5 animate-spin text-signal" />The interviewer is reading your answer…</div>
      )}

      {failed && (
        <div className="space-y-3 rounded-2xl border border-coral/40 bg-card p-4 text-sm">
          <p className="text-coral">Could not get a probe: {job?.error || job?.status}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => act(() => api(`/api/jobs/${job!.id}/retry`, { method: "POST" }), "Retry failed")}><RotateCcw /> Try again</Button>
            <Button variant="ghost" disabled={busy} onClick={() => act(() => api(base, { method: "DELETE" }), "Could not skip")}><SkipForward /> Skip the probe</Button>
          </div>
        </div>
      )}

      {probe?.question && (
        <>
          <div className="space-y-2 rounded-2xl border bg-card p-4 text-sm leading-relaxed">
            <p className="font-medium">{probe.question}</p>
            {probe.hint && <p className="text-muted-foreground"><span className="font-medium text-foreground">Nudge:</span> {probe.hint}</p>}
          </div>
          <div>
            <label htmlFor="probe-answer" className="mb-1.5 block text-sm font-medium">Your answer</label>
            <textarea id="probe-answer" autoFocus value={text} onChange={(e) => setText(e.target.value)}
              className="min-h-[160px] w-full resize-y rounded-lg border bg-card p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
              placeholder="Answer once, then move on. This is read by the graders along with the section." />
            <div className="mt-3 flex items-center justify-end gap-2">
              {rec === "recording" ? (
                <Button size="lg" variant="destructive" onClick={stopRec}><Square /> Stop recording</Button>
              ) : (
                <Button size="lg" variant="outline" disabled={busy || rec === "transcribing"} onClick={startRec}>
                  {rec === "transcribing" ? <Loader2 className="animate-spin" /> : <Mic />}{rec === "transcribing" ? "Transcribing…" : "Record answer"}
                </Button>
              )}
              <Button size="lg" disabled={busy || rec !== "idle" || !text.trim()} onClick={() => act(() => api(`${base}/answer`, { method: "PUT", body: { text } }), "Could not save the answer")}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}Submit and continue
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
