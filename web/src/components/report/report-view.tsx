"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModelPicker, useProviders } from "@/components/model-picker";
import { toast } from "sonner";
import { ChevronRight, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, Section, Statement } from "@/components/shell/page-header";
import { DeleteSession } from "@/components/delete-session";
import { Markdown } from "@/components/markdown";
import { DiagramCanvas } from "@/components/canvas/diagram-canvas";
import { diagramSize, emptyDiagram } from "@/components/canvas/legacy";
import { DimensionChart, TimeChart } from "./charts";
import { ConceptsPanel } from "@/components/concepts-panel";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { fmtDate, fmtTok, fmtUsd, mmss, scoreTone } from "@/lib/format";
import { LEVELS, SIGNALS, type Cost, type Job, type Section as Sec, type SessionPayload } from "@/lib/types";

const pending = (j: Job | null | undefined) => !!j && (j.status === "queued" || j.status === "running");

const money = (c: Cost) => (!c.reported ? "not reported" : c.cost_usd < 0.01 ? `≈$${c.cost_usd.toFixed(3)}` : `≈${fmtUsd(c.cost_usd)}`);

/** Which model did each piece of work and what it cost, where the provider reports it. */
function CostPanel({ p }: { p: SessionPayload }) {
  const rows: { label: string; note?: string; c: Cost | null | undefined }[] = [
    { label: "Answer key", note: "shared by every session on this question", c: p.costs?.answer_key },
    ...p.sections.flatMap((s) => [
      { label: `${s.ord}. ${s.title}`, note: s.probe?.answer ? "graded with the probe" : undefined, c: s.cost?.grade },
      ...(s.cost?.probe ? [{ label: `${s.ord}. ${s.title}: probe question`, c: s.cost.probe }] : []),
    ]),
    { label: "Overall grade", c: p.costs?.overall },
  ];
  if (!rows.some((r) => r.c)) return null;
  return (
    <section className="mt-20">
      <h2 className="font-serif text-[1.55rem] font-medium tracking-tight">Models and cost</h2>
      <p className="mb-5 mt-1 max-w-[70ch] text-[14px] text-muted-foreground">Cost is the API-equivalent price the Claude CLI reports (a Pro or Max login is not billed per call). Transcription runs on this Mac and is free.</p>
      <div className="overflow-x-auto">
        <table className="booktabs text-[14px]">
          <thead><tr><th>Task</th><th>Model</th><th className="text-right">Tokens</th><th className="text-right">Cost</th></tr></thead>
          <tbody>
            {rows.filter((r) => r.c).map((r) => (
              <tr key={r.label}>
                <td>{r.label}{r.note && <span className="ml-2 text-[13px] text-muted-foreground">{r.note}</span>}</td>
                <td>{r.c!.model ?? "?"}</td>
                <td className="num text-right">{fmtTok(r.c!.total_tokens)}</td>
                <td className="num text-right">{money(r.c!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function JobNote({ job, what, onRetry }: { job: Job | null; what: string; onRetry: () => void }) {
  if (!job) return null;
  if (pending(job)) return <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Loader2 className="size-3 animate-spin" />{what}{job.status === "queued" ? " (queued)" : ""}</span>;
  if (job.status === "failed" || job.status === "pending_retry") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[3px] bg-coral/10 p-3 text-[14px] text-coral">
        <span><b>{what} {job.status === "pending_retry" ? "paused" : "failed"}:</b> {job.error}{job.status === "pending_retry" && " Claude Pro limits reset after a few hours."}</span>
        <Button size="sm" variant="outline" onClick={async () => { await api(`/api/jobs/${job.id}/retry`, { method: "POST" }); onRetry(); }}>Retry</Button>
      </div>
    );
  }
  return null;
}

const sevTone = (s: string) => (s === "high" ? "text-coral" : s === "medium" ? "text-signal" : "text-muted-foreground");

/** One part of the answer, set like a paragraph of a refereed paper: the text in the column, the referee's marks in the margin. */
function SectionCard({ s, reload, i }: { s: Sec; reload: () => void; i: number }) {
  const [open, setOpen] = useState(false);
  const g = s.grade;
  return (
    <article className="rise grid grid-cols-1 gap-x-12 gap-y-3 md:grid-cols-[minmax(0,1fr)_13rem]" style={{ "--i": i } as React.CSSProperties}>
      <div className="min-w-0">
        <h3 className="font-serif text-[1.6rem] font-medium leading-tight tracking-tight">{s.title}</h3>
        {g && <p className="mt-2 max-w-[68ch] font-serif text-[1.1rem] leading-relaxed">{g.summary}</p>}
        {pending(s.grade_job) || (s.grade_job && s.grade_job.status !== "done" && !g) ? <div className="mt-2"><JobNote job={s.grade_job} what="Grading" onRetry={reload} /></div> : null}
        {g && (
          <button className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-medium underline decoration-1 underline-offset-4 hover:decoration-2" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Close the referee's notes" : "Read the referee's notes"}<ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
        )}
        {open && g && (
          <div className="mt-6 max-w-[70ch] space-y-8 text-[15px] leading-relaxed">
            {g.ungrounded && <p className="rounded-[3px] bg-signal/10 p-3 text-signal">Ungrounded: graded from general knowledge, without an answer key.</p>}
            {g.gap_summary ? (
              <div><h4 className="mb-1.5 font-semibold">Where it fell short</h4><p>{g.gap_summary}</p></div>
            ) : g.gaps.length > 0 && (
              <div className="space-y-5"><h4 className="font-semibold">Gaps</h4>
                {g.gaps.map((x, k) => (
                  <div key={k}>
                    <p><span className={cn("font-semibold", sevTone(x.severity))}>{x.tag}. </span>{x.description}</p>
                    {x.what_a_staff_answer_sounds_like && <Statement label="A staff answer" className="mt-2 bg-card px-4 py-3 text-[1rem]">{x.what_a_staff_answer_sounds_like}</Statement>}
                  </div>
                ))}
              </div>
            )}
            {g.language_review && (
              <div>
                <h4 className="font-semibold">Wording <span className={cn("ml-1 font-normal", g.language_review.register === "staff" ? "text-mint" : g.language_review.register === "mixed" ? "text-signal" : "text-coral")}>{g.language_review.register === "staff" ? "staff register" : g.language_review.register === "mixed" ? "mixed register" : "below staff register"}</span></h4>
                <p className="mt-1.5">{g.language_review.assessment}</p>
                {g.language_review.issues.length > 0 && <div className="mt-4 space-y-4">{g.language_review.issues.map((x, k) => (
                  <div key={k}>
                    <p className="font-serif italic text-muted-foreground">&ldquo;{x.said}&rdquo;</p>
                    <p className="mt-1">{x.problem}</p>
                    <Statement label="A staff engineer would say" className="mt-2 bg-card px-4 py-3 text-[1rem]">{x.better}</Statement>
                  </div>))}</div>}
              </div>
            )}
            {g.concepts_writeup && <div><h4 className="mb-2 font-semibold">What to learn</h4><Markdown>{g.concepts_writeup}</Markdown></div>}
            {(g.evidence.length > 0 || g.fact_checks.length > 0) && (
              <details><summary className="cursor-pointer font-semibold">Evidence and fact checks</summary>
                <div className="mt-3 space-y-4">
                  {g.evidence.map((e, k) => <div key={k}><blockquote className="border-l-[3px] border-border pl-3 font-serif italic text-muted-foreground">&ldquo;{e.quote}&rdquo;</blockquote><p className="mt-1">{e.observation}</p></div>)}
                  {g.fact_checks.map((f, k) => (
                    <p key={k}><span className={cn("font-semibold", f.verdict === "correct" ? "text-mint" : f.verdict === "incorrect" ? "text-coral" : "text-signal")}>{f.verdict.replace("_", " ")}. </span>{f.claim}. <span className="text-muted-foreground">{f.explanation}</span>{f.url && <a className="ml-1 inline-flex items-center gap-0.5 text-signal underline underline-offset-2" href={f.url} target="_blank" rel="noopener noreferrer">source<ExternalLink className="size-3" /></a>}</p>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
      <aside className="flex flex-wrap items-baseline gap-x-5 gap-y-1 md:block md:space-y-2 md:pt-1" aria-label={`Referee's marks on ${s.title}`}>
        {g ? <div className={cn("fig text-[2.6rem] font-semibold", scoreTone(g.score))}>{g.score.toFixed(1)}</div> : <div className="fig text-[2.6rem] text-muted-foreground">–</div>}
        {g && <div className="text-[14px]">{LEVELS[g.level_signal]}</div>}
        <div className="num text-[14px] text-muted-foreground">{s.duration_sec ? mmss(s.duration_sec) : "--:--"} of {mmss(s.budget_sec)}</div>
        {g && g.gaps.length > 0 && <ul className="space-y-0.5 pt-1 text-[13px] leading-snug">{g.gaps.map((x, k) => <li key={k} className={sevTone(x.severity)}>{x.tag}</li>)}</ul>}
      </aside>
    </article>
  );
}

export function ReportView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { data: p, error, reload } = useApi<SessionPayload>(`/api/sessions/${id}`, (d) =>
    pending(d.grade_job) || d.sections.some((s) => pending(s.grade_job)) || pending(d.research.job) ? 5000 : false);
  const [model, setModel] = useState("default");
  const providers = useProviders();
  const [brief, setBrief] = useState<{ brief_md: string | null; state: string } | null>(null);
  const [diagramSec, setDiagramSec] = useState<string>("final");

  if (error && !p) return <Page><p className="text-sm text-coral">Could not load this report: {error}</p></Page>;
  if (!p) return <Page><Skeleton className="mb-6 h-40 w-full" /><Skeleton className="h-96 w-full" /></Page>;
  if (p.session.status === "in_progress") { router.replace(`/session/?id=${id}`); return null; }
  const g = p.grade;

  async function regrade() {
    try { await api(`/api/sessions/${id}/regrade`, { method: "POST", body: { model } }); toast.success("Re-grading started"); reload(); }
    catch (e) { toast.error((e as Error).message); }
  }
  const diagramSnap = diagramSec === "final" ? (p.diagram ?? emptyDiagram()) : p.sections.find((s) => s.key === diagramSec)?.diagram ?? emptyDiagram();
  const hasDiagram = diagramSize(p.diagram) > 0;

  return (
    <Page wide>
      <header className="grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <h1 className="rise display text-[2.8rem] md:text-[4.25rem]">{g ? `${LEVELS[g.overall_level]}. ${SIGNALS[g.hire_signal_at_staff]} at staff.` : "The referee is reading"}</h1>
          <p className="rise mt-4 text-[15px] text-muted-foreground" style={{ "--i": 1 } as React.CSSProperties}>Referee&apos;s report on <span className="font-medium text-foreground">{p.question.title}</span>, {fmtDate(p.session.started_at)}.</p>
          {g && <p className="rise mt-7 max-w-[64ch] font-serif text-[1.25rem] leading-relaxed" style={{ "--i": 2 } as React.CSSProperties}>{g.verdict}</p>}
          <div className="mt-4 space-y-2">
            {!g && <JobNote job={p.grade_job} what="Overall grade" onRetry={reload} />}
            {p.research.state === "researching" && <p className="flex items-center gap-1.5 text-[14px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Building the reference answer key. Grading waits for it.</p>}
            {p.research.state === "failed" && <p className="text-[14px] text-signal">Research failed, so the parts were graded without an answer key.</p>}
          </div>
        </div>
        <aside className="rise" style={{ "--i": 2 } as React.CSSProperties}>
          {g ? (
            <>
              <div className={cn("fig text-[8rem]", scoreTone(g.overall_score))}>{g.overall_score.toFixed(1)}</div>
              <p className="mt-3 text-[15px] text-muted-foreground">out of 4. Staff is 3.0.</p>
            </>
          ) : <div className="flex h-32 items-center gap-2 text-[15px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />Grading</div>}
          <div className="mt-8 flex flex-col items-start gap-2.5">
            <a href={`/api/sessions/${id}/export.md`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[14px] font-medium underline decoration-1 underline-offset-4 hover:decoration-2"><Download className="size-3.5" />Export as markdown</a>
            <div className="flex flex-wrap items-center gap-2"><ModelPicker compact allowDefault value={model} onChange={setModel} providers={providers.data} /><Button variant="outline" size="sm" onClick={regrade}><RefreshCw />Re-grade</Button></div>
            <DeleteSession id={p.session.id} title={p.question.title} onDeleted={() => router.push("/")}>
              {(open) => <button type="button" className="text-[14px] font-medium text-coral underline decoration-1 underline-offset-4 hover:decoration-2" onClick={open}>Delete this session</button>}
            </DeleteSession>
            {p.usage && p.usage.calls > 0 && <p className="num pt-1 text-[13px] text-muted-foreground">{p.usage.calls} model calls, {fmtTok(p.usage.total_tokens)} tokens, ≈{fmtUsd(p.usage.cost_usd)}</p>}
          </div>
        </aside>
      </header>

      <Tabs defaultValue="report" className="mt-16">
        <TabsList>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="diagram">Diagram{hasDiagram ? "" : " (empty)"}</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="brief" onClick={async () => { if (!brief) setBrief(await api(`/api/questions/${p.question.id}/research`)); }}>Answer key</TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-12 text-[15px]">
          {g && (
            <div className="mb-20 grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <Statement label="Remark" className="text-[1.45rem] leading-snug">{g.drill_for_next_session}</Statement>
              {g.strengths.length > 0 && <div><h2 className="mb-3 font-semibold">What went well</h2><ul className="space-y-2 leading-relaxed">{g.strengths.map((x) => <li key={x} className="flex gap-3"><span aria-hidden className="mt-[0.5em] size-[5px] shrink-0 bg-mint" />{x}</li>)}</ul></div>}
            </div>
          )}

          <div className="mb-20 grid grid-cols-1 gap-x-16 gap-y-14 lg:grid-cols-2">
            {g && <section><h2 className="mb-8 font-serif text-[1.55rem] font-medium tracking-tight">Ten dimensions</h2><DimensionChart scores={g.dimension_scores} /></section>}
            <section><h2 className="mb-8 font-serif text-[1.55rem] font-medium tracking-tight">Time against budget</h2>
              <TimeChart rows={p.sections.map((s) => ({ name: s.title, used: Math.round(s.duration_sec ?? 0), budget: s.budget_sec }))} /></section>
          </div>

          {g?.interview_focus && (
            <Section title="What to explain in the hour" className="mb-20">
              <p className="max-w-[68ch] font-serif text-[1.15rem] leading-relaxed">{g.interview_focus.shape}</p>
              <ol className="mt-8 space-y-5">
                {g.interview_focus.priorities.map((x, i) => (
                  <li key={i} className="grid gap-x-8 sm:grid-cols-[5rem_minmax(0,1fr)]">
                    <span className="fig text-[1.6rem] text-muted-foreground">{Math.round(x.minutes)}<span className="ml-1 font-sans text-[13px] tracking-normal">min</span></span>
                    <div><b className="font-semibold">{x.topic}</b><p className="mt-0.5 max-w-[70ch] leading-relaxed text-muted-foreground">{x.explain}</p></div>
                  </li>))}
              </ol>
              {g.interview_focus.can_skip.length > 0 && <div className="mt-10"><h3 className="mb-2 font-semibold">Skip, or say in one line</h3><ul className="space-y-1.5 text-muted-foreground">{g.interview_focus.can_skip.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            </Section>
          )}

          <Section title="Part by part" className="mb-20"><div className="space-y-14">{p.sections.map((s, i) => <SectionCard key={s.key} s={s} reload={reload} i={i} />)}</div></Section>

          {g && (g.improvements_vs_previous.length > 0 || g.recurring_patterns_vs_previous.length > 0) && (
            <div className="mb-20 grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-2">
              {g.improvements_vs_previous.length > 0 && <section><h2 className="mb-3 font-serif text-[1.55rem] font-medium">Better than last time</h2><ul className="space-y-2 leading-relaxed">{g.improvements_vs_previous.map((x) => <li key={x} className="flex gap-3"><span aria-hidden className="mt-[0.5em] size-[5px] shrink-0 bg-mint" />{x}</li>)}</ul></section>}
              {g.recurring_patterns_vs_previous.length > 0 && <section><h2 className="mb-3 font-serif text-[1.55rem] font-medium">Still recurring</h2><ul className="space-y-2 leading-relaxed">{g.recurring_patterns_vs_previous.map((x) => <li key={x} className="flex gap-3"><span aria-hidden className="mt-[0.5em] size-[5px] shrink-0 bg-coral" />{x}</li>)}</ul></section>}
            </div>
          )}
          {g && (
            <>
              {p.study_plan.length > 0 && (
                <Section title="Study plan">
                  <ol className="list-decimal space-y-5 pl-6 marker:font-serif marker:text-muted-foreground">{p.study_plan.map((x) => (
                    <li key={x.concept} className="pl-2"><b className="font-semibold">{x.concept}</b><p className="mt-0.5 max-w-[70ch] leading-relaxed">{x.why}</p><p className="mt-0.5 text-[13px] text-muted-foreground">{x.resource}. From {x.sections.join(", ")}.</p></li>))}</ol>
                </Section>
              )}
              <Section title="Concepts to study"><ConceptsPanel fixedSession={p.session.id} /></Section>
              {g.sources.length > 0 && <Section title="Sources"><ol className="list-decimal space-y-1.5 pl-6 marker:text-muted-foreground">{g.sources.map((s) => <li key={s.url} className="pl-1"><a className="underline decoration-1 underline-offset-4 hover:decoration-2" href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>)}</ol></Section>}
            </>
          )}
          <CostPanel p={p} />
        </TabsContent>

        <TabsContent value="diagram" className="mt-10">
          {!hasDiagram ? (
            <p className="max-w-[60ch] text-[15px] text-muted-foreground">No diagram was drawn in this session. The high-level design and the deep dives are graded against what you draw, so sketch while you talk next time.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Diagram snapshots">
                {[{ key: "final", title: "Final" }, ...p.sections.filter((s) => diagramSize(s.diagram) > 0).map((s) => ({ key: s.key, title: `After ${s.title}` }))].map((o) => (
                  <button key={o.key} role="tab" aria-selected={diagramSec === o.key} onClick={() => setDiagramSec(o.key)} className={cn("rounded-[3px] px-3 py-1.5 text-[13px] font-medium transition-colors", diagramSec === o.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}>{o.title}</button>
                ))}
              </div>
              <div className="h-[620px] overflow-hidden rounded-[3px] bg-card">
                <DiagramCanvas key={diagramSec} initial={diagramSnap} readOnly />
              </div>
              <p className="mt-3 text-[13px] text-muted-foreground">Each snapshot is what the referee saw when you saved that part.</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="transcript" className="mt-10 space-y-12">
          {p.sections.map((s) => (
            <section key={s.key} className="max-w-[70ch]">
              <h3 className="font-serif text-[1.45rem] font-medium">{s.title}</h3>
              <p className="mt-2 whitespace-pre-wrap font-serif text-[1.08rem] leading-relaxed">{s.transcript_edited || "(nothing said)"}</p>
              {s.probe?.question && (
                <div className="mt-5 space-y-2 bg-card p-5 text-[15px]">
                  <Statement label="Probe" className="text-[1.08rem]">{s.probe.question}</Statement>
                  {s.probe.hint && <p className="text-muted-foreground">A nudge: {s.probe.hint}</p>}
                  <p className="whitespace-pre-wrap pt-2 font-serif text-[1.05rem]">{s.probe.answer || "(no answer)"}</p>
                </div>
              )}
            </section>
          ))}
        </TabsContent>

        <TabsContent value="brief" className="mt-10">
          {!brief ? <p className="text-[15px] text-muted-foreground">Loading…</p> : brief.brief_md ? <Markdown>{brief.brief_md}</Markdown> : <p className="text-[15px] text-muted-foreground">No answer key yet ({brief.state}).</p>}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
