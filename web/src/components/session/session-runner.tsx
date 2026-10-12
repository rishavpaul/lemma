"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, MessageCircleQuestion, Mic, PenTool, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, ScoreChip } from "@/components/score-chip";
import { DiagramCanvas, type CanvasHandle } from "@/components/canvas/diagram-canvas";
import { emptyDiagram } from "@/components/canvas/legacy";
import { Stepper } from "./stepper";
import { ProbePanel } from "./probe-panel";
import { SectionTimer, TotalTimer } from "./timers";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { mmss } from "@/lib/format";
import type { Job, SceneDiagram, SessionPayload } from "@/lib/types";

const Canvas = memo(DiagramCanvas);
type Phase = "idle" | "recording" | "uploading" | "transcribing";

export function SessionRunner() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { data, error, reload, setData } = useApi<SessionPayload>(`/api/sessions/${id}`, (d) =>
    d.research.state === "researching" || (d.session.show_feedback_live && d.sections.some((s) => s.status === "saved" && !s.grade)) ||
    d.sections.some((s) => ["recorded", "transcribing"].includes(s.status)) ||
    d.sections.some((s) => s.probe && !s.probe.question && s.probe_job && ["queued", "running"].includes(s.probe_job.status)) ? 4000 : false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [rerecord, setRerecord] = useState<string | null>(null);
  const [pane, setPane] = useState<"speak" | "draw">("speak");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");

  const rec = useRef<{ recorder: MediaRecorder | null; stream: MediaStream | null; chunks: Blob[]; start: number }>({ recorder: null, stream: null, chunks: [], start: 0 });
  const accMs = useRef<Record<string, number>>({});
  const sessionStart = useRef<number | null>(null);
  const canvas = useRef<CanvasHandle>(null);

  const sections = data?.sections ?? [];
  const idx = sections.findIndex((s) => s.status !== "saved");
  const sec = idx >= 0 ? sections[idx] : null;
  const isLast = idx === sections.length - 1;
  // A probe that is asked (or being generated) but not answered blocks everything else.
  const openProbe = sections.find((s) => s.status === "saved" && s.probe && !s.probe.answer) ?? null;
  const allSaved = sections.length > 0 && idx < 0;
  const secRef = useRef(sec);
  const phaseRef = useRef(phase);
  useEffect(() => { secRef.current = sec; phaseRef.current = phase; });

  useEffect(() => { if (data && data.session.status !== "in_progress") router.replace(`/report/?id=${id}`); }, [data, id, router]);

  // The editor shows the saved transcript until the user types; edits are kept per section.
  const text = sec ? (edits[sec.key] ?? sec.transcript_edited ?? "") : "";
  const setText = (v: string) => { if (sec) setEdits((e) => ({ ...e, [sec.key]: v })); };

  const getUsedSec = useCallback((now: number) => {
    const s = secRef.current; if (!s) return 0;
    const live = phaseRef.current === "recording" ? now - rec.current.start : 0;
    return ((accMs.current[s.key] ?? 0) + live) / 1000;
  }, []);

  const stopStream = () => { rec.current.stream?.getTracks().forEach((t) => t.stop()); rec.current.stream = null; };
  useEffect(() => () => { try { if (rec.current.recorder?.state === "recording") rec.current.recorder.stop(); } catch {} stopStream(); }, []);

  async function waitJob(jobId: number) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const j = await api<Job>(`/api/jobs/${jobId}`);
      if (j.status === "done") return;
      if (j.status === "failed" || j.status === "pending_retry") throw new Error(j.error || j.status);
    }
  }

  async function startRec() {
    const s = secRef.current; if (!s) return;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast.error("Microphone unavailable", { description: `${(e as Error).message}. Allow microphone access for this site, then try again.` }); return; }
    const mime = ["audio/webm;codecs=opus", "audio/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) ?? "";
    const r = rec.current;
    r.stream = stream; r.chunks = [];
    r.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    r.recorder.ondataavailable = (e) => { if (e.data?.size) r.chunks.push(e.data); };
    const recorder = r.recorder;
    recorder.onstop = () => onRecorded(s.key, recorder.mimeType || mime || "audio/webm");
    recorder.start(1000);
    r.start = Date.now();
    sessionStart.current ??= Date.now();
    setPhase("recording");
  }
  function stopRec() {
    const s = secRef.current; const r = rec.current;
    if (!s || phaseRef.current !== "recording") return;
    accMs.current[s.key] = (accMs.current[s.key] ?? 0) + (Date.now() - r.start);
    setPhase("uploading");
    r.recorder?.stop(); stopStream();
  }
  async function onRecorded(key: string, mime: string) {
    const blob = new Blob(rec.current.chunks, { type: mime });
    const fd = new FormData();
    fd.append("file", blob, "clip." + (mime.includes("mp4") ? "mp4" : "webm"));
    try {
      const r = await api<{ job_id: number }>(`/api/sessions/${id}/sections/${key}/audio`, { method: "POST", body: fd });
      setPhase("transcribing");
      await waitJob(r.job_id);
    } catch (e) { toast.error("Transcription failed", { description: (e as Error).message }); }
    setRerecord(null);
    await reload();
    setPhase("idle");
  }

  async function saveSection(s: NonNullable<typeof sec>, deferGrading = false) {
    const used = (accMs.current[s.key] ?? 0) / 1000;
    canvas.current?.flush();
    await api(`/api/sessions/${id}/sections/${s.key}/transcript`, {
      method: "PUT", body: { text, duration_sec: used > 0 ? used : null, diagram: canvas.current?.getDiagram(), defer_grading: deferGrading },
    });
  }
  async function finish() {
    setBusy(true);
    try { await api(`/api/sessions/${id}/finish`, { method: "POST" }); router.push(`/report/?id=${id}`); return; }
    catch (e) { toast.error("Could not finish", { description: (e as Error).message }); }
    setBusy(false);
  }
  async function save() {
    const s = secRef.current; if (!s || busy) return;
    setBusy(true);
    try {
      await saveSection(s);
      if (isLast) { await api(`/api/sessions/${id}/finish`, { method: "POST" }); router.push(`/report/?id=${id}`); return; }
      await reload();
    } catch (e) { toast.error("Could not save", { description: (e as Error).message }); }
    setBusy(false);
  }
  // Save this section, then ask the interviewer to probe it; the probe must be answered before moving on.
  async function probeMe() {
    const s = secRef.current; if (!s || busy) return;
    setBusy(true);
    try {
      await saveSection(s, true);
      await api(`/api/sessions/${id}/sections/${s.key}/probe`, { method: "POST" });
    } catch (e) { toast.error("Could not start the probe", { description: (e as Error).message }); }
    await reload();
    setBusy(false);
  }

  // Space toggles recording (unless typing, or working on the canvas); Cmd/Ctrl+Enter saves.
  const stateRef = useRef({ startRec, stopRec, save });
  useEffect(() => { stateRef.current = { startRec, stopRec, save }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = ["TEXTAREA", "INPUT", "SELECT", "BUTTON"].includes(t.tagName) || !!t.closest?.(".excalidraw");
      const s = secRef.current;
      if (e.code === "Space" && !typing && s) {
        if (phaseRef.current === "recording") { e.preventDefault(); stateRef.current.stopRec(); }
        else if (phaseRef.current === "idle" && (s.status === "pending" || rerecord === s.key)) { e.preventDefault(); stateRef.current.startRec(); }
      }
      if (e.code === "Enter" && (e.metaKey || e.ctrlKey) && s?.status === "transcribed" && phaseRef.current === "idle") { e.preventDefault(); stateRef.current.save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rerecord]);

  const onDiagramChange = useCallback(async (d: SceneDiagram) => {
    setSaveState("saving");
    try { await api(`/api/sessions/${id}/diagram`, { method: "PUT", body: d }); setSaveState("saved"); }
    catch { setSaveState("error"); }
  }, [id]);

  async function toggleLive(v: boolean) {
    setData((d) => (d ? { ...d, session: { ...d.session, show_feedback_live: v ? 1 : 0 } } : d));
  }

  if (error && !data) return <div className="p-10 text-sm text-coral">Could not load this session: {error}</div>;
  if (!data) return <div className="space-y-4 p-8"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-[60vh] w-full" /></div>;

  const effectiveStatus = sec ? (rerecord === sec.key ? "pending" : sec.status) : "saved";
  const processing = phase === "uploading" || phase === "transcribing" || (phase === "idle" && sec && ["recorded", "transcribing"].includes(sec.status) && rerecord !== sec.key);
  const rs = data.research.state;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b bg-card/50 px-5 pb-3 pt-4 md:px-8">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight" title={data.question.title}>{data.question.title}</h1>
          {rs === "researching" && <Pill tone="signal"><Loader2 className="size-3 animate-spin" />Building the answer key</Pill>}
          {rs === "ready" && <Pill tone="mint">Answer key ready</Pill>}
          {rs === "failed" && <Pill tone="coral">Answer key failed: grading will be ungrounded</Pill>}
          <TotalTimer getStart={() => sessionStart.current} />
        </div>
        <Stepper sections={sections} current={idx} />
      </div>

      <div className="flex shrink-0 border-b lg:hidden" role="tablist">
        {([["speak", "Speak", Mic], ["draw", "Draw", PenTool]] as const).map(([k, l, Icon]) => (
          <button key={k} role="tab" aria-selected={pane === k} onClick={() => setPane(k)} className={cn("flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium", pane === k ? "border-b-2 border-signal text-foreground" : "text-muted-foreground")}><Icon className="size-4" />{l}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(380px,440px)_1fr]">
        <aside className={cn("min-h-0 overflow-y-auto border-r px-5 py-5 md:px-6", pane !== "speak" && "hidden lg:block")}>
          <details className="group mb-5 rounded-lg border bg-card/60 px-3 py-2 text-sm" open={idx === 0}>
            <summary className="cursor-pointer select-none font-medium">The prompt</summary>
            <p className="mt-2 leading-relaxed text-muted-foreground">{data.question.prompt}</p>
          </details>

          {openProbe && <ProbePanel key={openProbe.key} sec={openProbe} sessionId={id} onChange={reload} />}

          {!openProbe && allSaved && data.session.status === "in_progress" && (
            <div className="space-y-3 rounded-2xl border bg-card p-5 text-sm">
              <p className="font-medium">All sections are done.</p>
              <Button size="lg" onClick={finish} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check />}Finish and grade</Button>
            </div>
          )}

          {sec && !openProbe && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-tight">{sec.title}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Section {idx + 1} of {sections.length}, {mmss(sec.budget_sec)} budget</p>
                </div>
                <div className="w-28 shrink-0"><SectionTimer getUsedSec={getUsedSec} budget={sec.budget_sec} /></div>
              </div>

              <ul className="mt-4 space-y-1.5 text-sm">
                {sec.cover.map((c) => (
                  <li key={c} className="flex gap-2 text-muted-foreground"><span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />{c}</li>
                ))}
              </ul>

              <div className="mt-6">
                {phase === "recording" ? (
                  <button onClick={stopRec} className="rec-pulse flex w-full items-center justify-center gap-3 rounded-2xl bg-coral px-6 py-5 text-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <Square className="size-5 fill-current" /> Stop <kbd className="num rounded border border-white/40 px-1.5 text-xs font-normal">Space</kbd>
                  </button>
                ) : processing ? (
                  <div className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-5 text-sm"><Loader2 className="size-5 animate-spin text-signal" />{phase === "uploading" ? "Uploading your recording" : "Transcribing on this machine"}</div>
                ) : effectiveStatus === "transcribed" ? (
                  <div>
                    <label htmlFor="transcript" className="mb-1.5 block text-sm font-medium">Check the transcript</label>
                    <p className="mb-2 text-xs text-muted-foreground">Fix speech-to-text mistakes (terms like p99 or Kafka) before saving. This text is what gets graded.</p>
                    <textarea id="transcript" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[220px] w-full resize-y rounded-lg border bg-card p-3 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => setRerecord(sec.key)}><RotateCcw /> Re-record</Button>
                      <Button variant="outline" onClick={probeMe} disabled={busy || rs !== "ready"} title={rs === "ready" ? "Save this section and get one question from the interviewer" : "The answer key is still being prepared"}>
                        <MessageCircleQuestion /> Probe me
                      </Button>
                      <Button className="ml-auto" size="lg" onClick={save} disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : <Check />}{isLast ? "Save and finish" : "Save and next"}
                        <kbd className="num ml-1 text-[10px] opacity-70">⌘↵</kbd>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button onClick={startRec} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-signal px-6 py-5 text-lg font-semibold text-signal-foreground transition-transform hover:brightness-105 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <Mic className="size-5" /> Start talking <kbd className="num rounded border border-black/30 px-1.5 text-xs font-normal">Space</kbd>
                  </button>
                )}
              </div>
              {phase === "idle" && effectiveStatus === "pending" && <p className="mt-3 text-xs text-muted-foreground">The clock only runs while you record. Draw on the canvas as you go; it is read with your answer.</p>}
            </>
          )}

          <label className="mt-8 flex items-center gap-3 text-sm">
            <Switch checked={!!data.session.show_feedback_live} onCheckedChange={toggleLive} aria-label="Show feedback after each section" />
            Show feedback after each section
          </label>
          {!!data.session.show_feedback_live && (
            <div className="mt-3 space-y-2">
              {sections.filter((s) => s.status === "saved").map((s) => (
                <div key={s.key} className="rounded-lg border bg-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{s.title}</span>{s.grade ? <ScoreChip score={s.grade.score} level={s.grade.level_signal} /> : <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />{s.probe && !s.probe.answer ? "after your probe" : "grading"}</span>}</div>
                  {s.grade && <p className="mt-1.5 text-muted-foreground">{s.grade.summary}</p>}
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className={cn("relative min-h-0", pane !== "draw" && "hidden lg:block")}>
          <Canvas key={id} initial={data.diagram ?? emptyDiagram()} onChange={onDiagramChange} handleRef={canvas} />
          <div className="pointer-events-none absolute left-1/2 top-3 hidden -translate-x-1/2 rounded-full border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur lg:block" aria-live="polite">
            {saveState === "saving" ? "Saving diagram…" : saveState === "error" ? "Diagram not saved: check the server" : "Diagram saved"}
          </div>
        </div>
      </div>
    </div>
  );
}
