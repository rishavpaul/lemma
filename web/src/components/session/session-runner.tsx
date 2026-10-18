"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, MessageCircleQuestion, Mic, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreChip } from "@/components/score-chip";
import { Statement, Tomb } from "@/components/shell/page-header";
import { DiagramCanvas, type CanvasHandle } from "@/components/canvas/diagram-canvas";
import { emptyDiagram } from "@/components/canvas/legacy";
import { Stepper } from "./stepper";
import { FeedbackReview } from "./feedback-review";
import { ProbePanel } from "./probe-panel";
import { SectionTimer, TotalTimer } from "./timers";
import { api } from "@/lib/api";
import { useWakeLock } from "@/lib/use-wake-lock";
import { speech, useSpeech } from "@/lib/speech";
import { ListenButton } from "@/components/listen-button";
import { feedbackSpeech } from "@/lib/speech";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
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
  const [review, setReview] = useState<string | null>(null); // section whose feedback is being shown (interactive mode)
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
  useWakeLock(phase === "recording");
  const tts = useSpeech();
  const secRef = useRef(sec);
  const phaseRef = useRef(phase);
  useEffect(() => { secRef.current = sec; phaseRef.current = phase; });
  const introText = sec && data
    ? `${idx === 0 ? `The question. ${data.question.prompt} ` : ""}Section ${idx + 1} of ${sections.length}: ${sec.title}. Cover: ${sec.cover.join(". ")}.`
    : "";
  const introRef = useRef(introText);
  useEffect(() => { introRef.current = introText; });
  const interactive = !!data?.session.show_feedback_live;
  const voiced = interactive || tts.autoRead;
  // Read each new section aloud in interactive mode or when the user asked for it. Queued, so it never cuts off feedback.
  useEffect(() => {
    if (!voiced || !sec || openProbe || review || sec.status !== "pending" || phaseRef.current !== "idle") return;
    speech.enqueue(`sec:${sec.key}`, introRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the section, not on every poll of its data
  }, [sec?.key, openProbe?.key, voiced, review]);

  // Interactive mode: read each grade aloud the moment it arrives. Grades already there on load are not replayed, and
  // nothing is spoken while recording (the microphone would hear it); it waits for the recording to end.
  const heard = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    if (heard.current === null) { heard.current = new Set(data.sections.filter((s) => s.grade).map((s) => s.key)); return; }
    if (!interactive || phase === "recording") return;
    for (const s of data.sections) {
      if (!s.grade || heard.current.has(s.key)) continue;
      heard.current.add(s.key);
      if (s.key === review) continue; // FeedbackReview reads this one
      speech.enqueue(`fb:${s.key}`, feedbackSpeech(s.title, s.grade));
    }
  }, [data, interactive, phase, review]);

  // After a probe is answered the section is graded; show that feedback before moving on.
  const prevProbe = useRef<string | null>(null);
  useEffect(() => {
    if (prevProbe.current && !openProbe && interactive) setReview(prevProbe.current);
    prevProbe.current = openProbe?.key ?? null;
  }, [openProbe, interactive]);

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
    speech.unlock();
    speech.stop(); // so the microphone does not pick up the speaker
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
    speech.unlock();
    setBusy(true);
    try {
      await saveSection(s);
      if (interactive) { setReview(s.key); await reload(); setBusy(false); return; }
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
    speech.unlock();
    setData((d) => (d ? { ...d, session: { ...d.session, show_feedback_live: v ? 1 : 0 } } : d));
    try { await api(`/api/sessions/${id}/interactive`, { method: "PUT", body: { on: v } }); }
    catch (e) { toast.error("Could not change the mode", { description: (e as Error).message }); await reload(); }
    if (!v) speech.stop();
  }

  if (error && !data) return <div className="p-10 text-sm text-coral">Could not load this session: {error}</div>;
  if (!data) return <div className="space-y-4 p-8"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-[60vh] w-full" /></div>;

  const effectiveStatus = sec ? (rerecord === sec.key ? "pending" : sec.status) : "saved";
  const processing = phase === "uploading" || phase === "transcribing" || (phase === "idle" && sec && ["recorded", "transcribing"].includes(sec.status) && rerecord !== sec.key);
  const rs = data.research.state;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-5 pb-4 pt-5 md:px-8">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h1 className="min-w-0 flex-1 truncate font-serif text-[1.6rem] font-medium tracking-tight" title={data.question.title}>{data.question.title}</h1>
          {rs === "researching" && <span className="inline-flex items-center gap-1.5 text-[13px] text-signal"><Loader2 className="size-3.5 animate-spin" />Building the answer key</span>}
          {rs === "ready" && <span className="text-[13px] text-muted-foreground">Answer key ready</span>}
          {rs === "failed" && <span className="text-[13px] text-coral">No answer key: grading will be ungrounded</span>}
          <TotalTimer getStart={() => sessionStart.current} />
        </div>
        <Stepper sections={sections} current={idx} />
      </div>

      <div className="flex shrink-0 gap-6 px-5 lg:hidden" role="tablist">
        {([["speak", "Speak"], ["draw", "Draw"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={pane === k} onClick={() => setPane(k)} className={cn("relative py-2 text-[15px] font-medium after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-foreground after:transition-transform", pane === k ? "text-foreground after:scale-x-100" : "text-muted-foreground after:scale-x-0")}>{l}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(400px,480px)_1fr]">
        <aside className={cn("min-h-0 overflow-y-auto px-5 pb-10 pt-4 md:px-8", pane !== "speak" && "hidden lg:block")}>
          <details className="group mb-8" open={idx === 0}>
            <summary className="cursor-pointer select-none text-[14px] font-medium text-muted-foreground hover:text-foreground">The question</summary>
            <Statement label={`Lemma ${data.question.id}`} tone="design" className="mt-2 text-[1.08rem]">{data.question.prompt}</Statement>
          </details>

          {openProbe && <ProbePanel key={openProbe.key} sec={openProbe} sessionId={id} onChange={reload} interactive={interactive} />}

          {!openProbe && !review && allSaved && data.session.status === "in_progress" && (
            <div className="rise space-y-5">
              <p className="display text-[2.4rem]">Every part is answered.<Tomb className="ml-3 text-signal" /></p>
              <Button variant="design" size="lg" className="h-12 w-full text-base" onClick={finish} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check />}Finish and send to the referee</Button>
            </div>
          )}

          {review && !openProbe && (() => {
            const rs = sections.find((x) => x.key === review);
            if (!rs) return null;
            const nextSec = sections.find((x) => x.status !== "saved");
            return <FeedbackReview key={review} sec={rs} nextLabel={nextSec ? `Next: ${nextSec.title}` : "Continue"} onContinue={() => setReview(null)} />;
          })()}

          {sec && !openProbe && !review && (
            <div key={sec.key} className="rise">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <h2 className="display text-[2.3rem]">{sec.title}</h2>
                  <p className="mt-2 text-[14px] text-muted-foreground">Part {idx + 1} of {sections.length}. {Math.round(sec.budget_sec / 60)} minutes.</p>
                </div>
                <div className="w-28 shrink-0 pt-1"><SectionTimer getUsedSec={getUsedSec} budget={sec.budget_sec} /></div>
              </div>

              <ul className="mt-5 space-y-2 text-[15px] leading-snug">
                {sec.cover.map((c) => (
                  <li key={c} className="flex gap-3"><span aria-hidden className="mt-[0.45em] size-[5px] shrink-0 bg-signal" />{c}</li>
                ))}
              </ul>
              <ListenButton id={`sec:${sec.key}`} className="mt-4" label="Read it to me" text={introText} />

              <div className="mt-8">
                {phase === "recording" ? (
                  <button onClick={stopRec} className="flex w-full items-center justify-center gap-3 rounded-[3px] bg-coral px-6 py-6 text-lg font-semibold text-white transition-transform active:scale-[0.99] dark:text-ink">
                    <span className="rec-dot size-3 rounded-full bg-current" />Listening. Stop<kbd className="ml-1 rounded-[2px] bg-black/15 px-1.5 text-xs font-medium">Space</kbd>
                  </button>
                ) : processing ? (
                  <div className="flex items-center gap-3 rounded-[3px] bg-card px-5 py-6 text-[15px]"><Loader2 className="size-5 animate-spin text-signal" />{phase === "uploading" ? "Uploading your recording" : "Transcribing on this Mac"}</div>
                ) : effectiveStatus === "transcribed" ? (
                  <div>
                    <label htmlFor="transcript" className="block text-[15px] font-semibold">What you said</label>
                    <p className="mb-3 mt-0.5 text-[13px] text-muted-foreground">Fix speech-to-text mistakes (p99, Kafka) before saving. This text is what the referee reads.</p>
                    <textarea id="transcript" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[240px] w-full resize-y rounded-[3px] bg-card p-4 font-serif text-[1.05rem] leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-ring" />
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button variant="ghost" onClick={() => setRerecord(sec.key)}><RotateCcw />Re-record</Button>
                      <Button variant="outline" onClick={probeMe} disabled={busy || rs !== "ready"} title={rs === "ready" ? "Save this part and get one question from the interviewer" : "The answer key is still being prepared"}>
                        <MessageCircleQuestion />Probe me
                      </Button>
                      <Button variant="design" className="ml-auto" size="lg" onClick={save} disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : <Check />}{isLast ? "Save and finish" : "Save, next part"}
                        <kbd className="ml-1 text-[11px] opacity-70">⌘↵</kbd>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button onClick={startRec} className="group flex w-full items-center justify-center gap-3 rounded-[3px] bg-signal px-6 py-6 text-lg font-semibold text-signal-foreground transition-[transform,background-color] hover:bg-[color-mix(in_oklch,var(--signal),var(--foreground)_12%)] active:scale-[0.99]">
                    <Mic className="size-5 transition-transform group-hover:scale-110" />Start talking<kbd className="ml-1 rounded-[2px] bg-black/15 px-1.5 text-xs font-medium">Space</kbd>
                  </button>
                )}
              </div>
              {phase === "idle" && effectiveStatus === "pending" && <p className="mt-3 text-[13px] text-muted-foreground">The clock runs only while you record. Draw as you go: the diagram is read with your answer.</p>}
            </div>
          )}

          <div className="mt-12 space-y-4 bg-card p-4">
            <label className="flex items-start gap-3 text-[14px]">
              <Switch className="mt-0.5" checked={interactive} onCheckedChange={toggleLive} aria-label="Interactive coaching" />
              <span>Interactive coaching<span className="block text-[13px] text-muted-foreground">Grade each part as you submit it and read the feedback aloud.</span></span>
            </label>
            {!interactive && (
              <label className="flex items-center gap-3 text-[14px]">
                <Switch checked={tts.autoRead} onCheckedChange={(v) => { speech.unlock(); speech.setAutoRead(v); if (v && sec && !openProbe) speech.play(`sec:${sec.key}`, introText); else if (!v) speech.stop(); }} aria-label="Read each part aloud" />
                Read each part and probe aloud
              </label>
            )}
          </div>
          {!!data.session.show_feedback_live && sections.some((s) => s.status === "saved") && (
            <div className="mt-8 space-y-6">
              {sections.filter((s) => s.status === "saved").map((s) => (
                <div key={s.key} className="text-[15px]">
                  <div className="flex items-baseline justify-between gap-2"><span className="font-serif text-[1.15rem]">{s.title}</span>{s.grade ? <ScoreChip score={s.grade.score} level={s.grade.level_signal} /> : <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Loader2 className="size-3 animate-spin" />{s.probe && !s.probe.answer ? "after your probe" : "grading"}</span>}</div>
                  {s.grade && <p className="mt-1 leading-relaxed text-muted-foreground">{s.grade.summary}</p>}
                  {s.grade && <ListenButton id={`fb:${s.key}`} className="mt-2" text={`${s.title}. ${s.grade.summary}`} />}
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className={cn("relative min-h-0 bg-card", pane !== "draw" && "hidden lg:block")}>
          <Canvas key={id} initial={data.diagram ?? emptyDiagram()} onChange={onDiagramChange} handleRef={canvas} />
          <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 text-[12px] text-muted-foreground lg:block" aria-live="polite">
            {saveState === "saving" ? "Saving the diagram…" : saveState === "error" ? "Diagram not saved: check the server" : "Diagram saved"}
          </div>
        </div>
      </div>
    </div>
  );
}
