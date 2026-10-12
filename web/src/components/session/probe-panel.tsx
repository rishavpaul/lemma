"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, MessageCircleQuestion, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Section } from "@/lib/types";

/** The single probe exchange after a section: wait for the question, answer once, then move on. */
export function ProbePanel({ sec, sessionId, onChange }: { sec: Section; sessionId: string; onChange: () => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const probe = sec.probe;
  const job = sec.probe_job;
  const failed = !probe?.question && !!job && (job.status === "failed" || job.status === "pending_retry");
  const base = `/api/sessions/${sessionId}/sections/${sec.key}/probe`;

  async function act(fn: () => Promise<unknown>, error: string) {
    setBusy(true);
    try { await fn(); await onChange(); } catch (e) { toast.error(error, { description: (e as Error).message }); }
    setBusy(false);
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
            <div className="mt-3 flex justify-end">
              <Button size="lg" disabled={busy || !text.trim()} onClick={() => act(() => api(`${base}/answer`, { method: "PUT", body: { text } }), "Could not save the answer")}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />}Submit and continue
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
