"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModelPicker, useProviders } from "@/components/model-picker";
import { toast } from "sonner";
import { ChevronRight, Download, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, Panel, Section } from "@/components/shell/page-header";
import { Pill, ScoreChip } from "@/components/score-chip";
import { DeleteSession } from "@/components/delete-session";
import { Markdown } from "@/components/markdown";
import { DiagramCanvas } from "@/components/canvas/diagram-canvas";
import { diagramSize, emptyDiagram } from "@/components/canvas/legacy";
import { DimensionChart, TimeChart } from "./charts";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { fmtTok, fmtUsd, mmss, scoreTone } from "@/lib/format";
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
    <Panel className="mt-8">
      <h2 className="mb-1 text-sm font-semibold">Models and cost</h2>
      <p className="mb-3 text-xs text-muted-foreground">Cost is the API-equivalent price the Claude CLI reports (a Pro/Max login is not billed per call). Transcription runs locally and is free.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-4 font-medium">Task</th><th className="py-1 pr-4 font-medium">Model</th><th className="py-1 pr-4 text-right font-medium">Tokens</th><th className="py-1 text-right font-medium">Cost</th></tr></thead>
          <tbody>
            {rows.filter((r) => r.c).map((r) => (
              <tr key={r.label} className="border-t">
                <td className="py-1.5 pr-4">{r.label}{r.note && <span className="ml-2 text-xs text-muted-foreground">{r.note}</span>}</td>
                <td className="num py-1.5 pr-4">{r.c!.model ?? "?"}</td>
                <td className="num py-1.5 pr-4 text-right">{fmtTok(r.c!.total_tokens)}</td>
                <td className="num py-1.5 text-right">{money(r.c!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function JobNote({ job, what, onRetry }: { job: Job | null; what: string; onRetry: () => void }) {
  if (!job) return null;
  if (pending(job)) return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />{what}{job.status === "queued" ? " (queued)" : ""}</span>;
  if (job.status === "failed" || job.status === "pending_retry") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-coral/40 bg-coral/10 p-3 text-sm text-coral">
        <span><b>{what} {job.status === "pending_retry" ? "paused" : "failed"}:</b> {job.error}{job.status === "pending_retry" && " Claude Pro limits reset after a few hours."}</span>
        <Button size="sm" variant="outline" onClick={async () => { await api(`/api/jobs/${job.id}/retry`, { method: "POST" }); onRetry(); }}>Retry</Button>
      </div>
    );
  }
  return null;
}

async function addStudy(concept: string, why: string, resource: string, sid: number | null, btn: HTMLButtonElement) {
  try { await api("/api/study_items", { method: "POST", body: { concept, why, resource, source_session_id: sid } }); btn.disabled = true; toast.success("Added to your study queue"); }
  catch (e) { toast.error((e as Error).message); }
}

function SectionCard({ s, reload }: { s: Sec; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const g = s.grade;
  return (
    <div className="rounded-xl border bg-card">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="flex-1 font-medium">{s.ord}. {s.title}</span>
        {g && <ScoreChip score={g.score} level={g.level_signal} />}
        <span className="num hidden text-xs text-muted-foreground sm:inline">{s.duration_sec ? mmss(s.duration_sec) : "--:--"} / {mmss(s.budget_sec)}</span>
      </button>
      {!open && g && <p className="-mt-1 px-4 pb-3 pl-11 text-sm text-muted-foreground">{g.summary}</p>}
      {pending(s.grade_job) || (s.grade_job && s.grade_job.status !== "done" && !g) ? <div className="px-4 pb-3 pl-11"><JobNote job={s.grade_job} what="Grading" onRetry={reload} /></div> : null}
      {open && g && (
        <div className="space-y-5 border-t px-4 py-4 pl-11 text-sm">
          {g.ungrounded && <div className="rounded-md border border-signal/40 bg-signal/10 p-2 text-signal">Ungrounded: graded from general knowledge (no reference brief).</div>}
          <p className="leading-relaxed">{g.summary}</p>
          {g.gap_summary ? (
            <div><h4 className="mb-1 font-medium">Where it fell short</h4>
              <p className="leading-relaxed">{g.gap_summary}</p>
              {g.gaps.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{g.gaps.map((x, i) => <Pill key={i} tone={x.severity === "high" ? "coral" : x.severity === "medium" ? "signal" : "muted"}>{x.tag}</Pill>)}</div>}
            </div>
          ) : g.gaps.length > 0 && (
            <div className="space-y-2"><h4 className="font-medium">Gaps</h4>
              {g.gaps.map((x, i) => (
                <div key={i} className="rounded-lg border bg-background p-3">
                  <div className="mb-1"><Pill tone={x.severity === "high" ? "coral" : x.severity === "medium" ? "signal" : "muted"}>{x.tag}</Pill></div>
                  <p>{x.description}</p>
                  {x.what_a_staff_answer_sounds_like && <p className="mt-2 rounded-md bg-accent/60 p-2"><b>A staff answer sounds like: </b>{x.what_a_staff_answer_sounds_like}</p>}
                </div>
              ))}
            </div>
          )}
          {g.language_review && (
            <div><h4 className="mb-1 flex items-center gap-2 font-medium">Wording and terminology <Pill tone={g.language_review.register === "staff" ? "mint" : g.language_review.register === "mixed" ? "signal" : "coral"}>{g.language_review.register === "staff" ? "staff register" : g.language_review.register === "mixed" ? "mixed" : "below staff"}</Pill></h4>
              <p className="leading-relaxed">{g.language_review.assessment}</p>
              {g.language_review.issues.length > 0 && <div className="mt-2 space-y-2">{g.language_review.issues.map((x, i) => (
                <div key={i} className="rounded-lg border bg-background p-3">
                  <p><span className="text-muted-foreground">You said: </span>&ldquo;{x.said}&rdquo;</p>
                  <p className="mt-1 text-muted-foreground">{x.problem}</p>
                  <p className="mt-2 rounded-md bg-accent/60 p-2"><b>A staff engineer would say: </b>{x.better}</p>
                </div>))}</div>}
            </div>
          )}
          {g.concepts_writeup && <div><h4 className="mb-1 font-medium">What to learn</h4><div className="rounded-lg bg-accent/60 p-3 leading-relaxed"><Markdown>{g.concepts_writeup}</Markdown></div></div>}
          {(g.evidence.length > 0 || g.fact_checks.length > 0) && (
            <details><summary className="cursor-pointer text-muted-foreground">Evidence and fact checks</summary>
              <div className="mt-2 space-y-3">
                {g.evidence.map((e, i) => <div key={i}><blockquote className="border-l-2 pl-3 italic text-muted-foreground">“{e.quote}”</blockquote><p className="mt-1">{e.observation}</p></div>)}
                {g.fact_checks.map((f, i) => (
                  <div key={i}><Pill tone={f.verdict === "correct" ? "mint" : f.verdict === "incorrect" ? "coral" : "signal"}>{f.verdict.replace("_", " ")}</Pill> {f.claim}. <span className="text-muted-foreground">{f.explanation}</span>{f.url && <a className="ml-1 inline-flex items-center gap-0.5 text-signal underline underline-offset-2" href={f.url} target="_blank" rel="noopener noreferrer">source<ExternalLink className="size-3" /></a>}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
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
      <div className="mb-8 grid gap-6 lg:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-5">
          {g ? (
            <div className="flex size-32 shrink-0 flex-col items-center justify-center rounded-2xl border bg-card">
              <div className={cn("fig text-6xl leading-none", scoreTone(g.overall_score))}>{g.overall_score.toFixed(1)}</div>
              <div className="mt-1 text-xs text-muted-foreground">of 4, staff is 3.0</div>
            </div>
          ) : (
            <div className="flex size-32 shrink-0 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Grading</div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{p.question.title}</p>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight">{g ? `${LEVELS[g.overall_level]}. ${SIGNALS[g.hire_signal_at_staff]} at staff.` : "Your report is being written"}</h1>
          {g && <p className="mt-2 max-w-[70ch] leading-relaxed text-muted-foreground">{g.verdict}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" render={<a href={`/api/sessions/${id}/export.md`} target="_blank" rel="noreferrer" />}><Download />Export markdown</Button>
            <ModelPicker compact allowDefault value={model} onChange={setModel} providers={providers.data} />
            <Button variant="outline" size="sm" onClick={regrade}><RefreshCw />Re-grade</Button>
            <DeleteSession id={p.session.id} title={p.question.title} onDeleted={() => router.push("/")}>
              {(open) => <Button variant="outline" size="sm" className="text-coral" onClick={open}><Trash2 />Delete</Button>}
            </DeleteSession>
            {p.usage && p.usage.calls > 0 && <Pill>{p.usage.calls} model calls · {fmtTok(p.usage.total_tokens)} tokens · ≈{fmtUsd(p.usage.cost_usd)}</Pill>}
          </div>
          <div className="mt-3 space-y-2">
            {!g && <JobNote job={p.grade_job} what="Overall grade" onRetry={reload} />}
            {p.research.state === "researching" && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Building the reference answer key. Grading waits for it.</p>}
            {p.research.state === "failed" && <p className="text-xs text-signal">Research failed, so sections were graded without an answer key.</p>}
          </div>
        </div>
      </div>

      <Tabs defaultValue="report">
        <TabsList>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="diagram">Diagram{hasDiagram ? "" : " (empty)"}</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="brief" onClick={async () => { if (!brief) setBrief(await api(`/api/questions/${p.question.id}/research`)); }}>Answer key</TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-6">
          <div className="mb-8 grid gap-4 lg:grid-cols-2">
            {g && <Panel><h2 className="mb-2 text-sm font-semibold">Ten dimensions</h2><DimensionChart scores={g.dimension_scores} /></Panel>}
            <Panel><h2 className="mb-2 text-sm font-semibold">Time used against budget</h2>
              <TimeChart rows={p.sections.map((s) => ({ name: s.title, used: Math.round(s.duration_sec ?? 0), budget: s.budget_sec }))} /></Panel>
          </div>

          {g && (
            <div className="mb-8 grid gap-4 lg:grid-cols-2">
              <Panel><h2 className="mb-2 text-sm font-semibold">Drill for next session</h2>
                <p className="text-sm leading-relaxed">{g.drill_for_next_session}</p></Panel>
              {g.strengths.length > 0 && <Panel><h2 className="mb-2 text-sm font-semibold">Strengths</h2><ul className="list-disc space-y-1 pl-5 text-sm">{g.strengths.map((x) => <li key={x}>{x}</li>)}</ul></Panel>}
            </div>
          )}

          {g?.interview_focus && (
            <Section title="What to explain in the hour">
              <Panel>
                <p className="mb-4 text-sm leading-relaxed">{g.interview_focus.shape}</p>
                <ol className="space-y-3 text-sm">
                  {g.interview_focus.priorities.map((x, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="num mt-0.5 w-5 text-muted-foreground">{i + 1}</span>
                      <div className="flex-1"><b>{x.topic}</b> <span className="num text-xs text-muted-foreground">~{Math.round(x.minutes)} min</span><div className="text-muted-foreground">{x.explain}</div></div>
                    </li>))}
                </ol>
                {g.interview_focus.can_skip.length > 0 && <div className="mt-4 border-t pt-3 text-sm"><h3 className="mb-1 font-medium">Can skip or say in one line</h3><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{g.interview_focus.can_skip.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              </Panel>
            </Section>
          )}

          <Section title="Sections"><div className="space-y-2">{p.sections.map((s) => <SectionCard key={s.key} s={s} reload={reload} />)}</div></Section>

          {g && (g.improvements_vs_previous.length > 0 || g.recurring_patterns_vs_previous.length > 0) && (
            <div className="mb-8 grid gap-4 lg:grid-cols-2">
              {g.improvements_vs_previous.length > 0 && <Panel><h2 className="mb-2 text-sm font-semibold">Improvements since last time</h2><ul className="list-disc space-y-1 pl-5 text-sm">{g.improvements_vs_previous.map((x) => <li key={x}>{x}</li>)}</ul></Panel>}
              {g.recurring_patterns_vs_previous.length > 0 && <Panel><h2 className="mb-2 text-sm font-semibold">Recurring patterns</h2><ul className="list-disc space-y-1 pl-5 text-sm">{g.recurring_patterns_vs_previous.map((x) => <li key={x}>{x}</li>)}</ul></Panel>}
            </div>
          )}
          {g && (
            <>
              {p.study_plan.length > 0 && (
                <Section title="Study plan">
                  <div className="overflow-hidden rounded-xl border">{p.study_plan.map((x, i) => (
                    <div key={x.concept} className="flex items-start gap-3 border-b px-4 py-3 text-sm last:border-0">
                      <span className="num mt-0.5 w-5 text-muted-foreground">{i + 1}</span>
                      <div className="flex-1"><b>{x.concept}</b><div className="text-muted-foreground">{x.why}</div><div className="text-xs text-muted-foreground">{x.resource} · from {x.sections.join(", ")}</div></div>
                      <Button size="xs" variant="outline" onClick={(e) => addStudy(x.concept, x.why, x.resource, p.session.id, e.currentTarget)}><Plus />Queue</Button>
                    </div>))}</div>
                </Section>
              )}
              {g.sources.length > 0 && <Section title={`Sources (${g.sources.length})`}><ul className="space-y-1 text-sm">{g.sources.map((s) => <li key={s.url}><a className="text-signal underline underline-offset-2" href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>)}</ul></Section>}
            </>
          )}
                  <CostPanel p={p} />
        </TabsContent>

        <TabsContent value="diagram" className="mt-6">
          {!hasDiagram ? (
            <Panel className="text-sm text-muted-foreground">No diagram was drawn in this session. High-level design and deep dives are graded against what you draw, so next time sketch while you talk.</Panel>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Diagram snapshots">
                {[{ key: "final", title: "Final" }, ...p.sections.filter((s) => diagramSize(s.diagram) > 0).map((s) => ({ key: s.key, title: `After ${s.title}` }))].map((o) => (
                  <button key={o.key} role="tab" aria-selected={diagramSec === o.key} onClick={() => setDiagramSec(o.key)} className={cn("rounded-full border px-3 py-1 text-xs", diagramSec === o.key ? "border-signal bg-signal/10 text-signal" : "text-muted-foreground hover:text-foreground")}>{o.title}</button>
                ))}
              </div>
              <div className="h-[560px] overflow-hidden rounded-xl border bg-card">
                <DiagramCanvas key={diagramSec} initial={diagramSnap} readOnly />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Each snapshot is what the grader saw when you saved that section.</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="transcript" className="mt-6 space-y-3">
          {p.sections.map((s) => <Panel key={s.key}><h3 className="mb-2 text-sm font-semibold">{s.ord}. {s.title}</h3><p className="whitespace-pre-wrap text-sm leading-relaxed">{s.transcript_edited || "(empty)"}</p>
            {s.probe?.question && (
              <div className="mt-3 space-y-1.5 rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Interviewer probe</p>
                <p>{s.probe.question}</p>
                {s.probe.hint && <p className="text-muted-foreground">Nudge: {s.probe.hint}</p>}
                <p className="whitespace-pre-wrap border-t pt-1.5">{s.probe.answer || "(no answer)"}</p>
              </div>
            )}</Panel>)}
        </TabsContent>

        <TabsContent value="brief" className="mt-6">
          {!brief ? <p className="text-sm text-muted-foreground">Loading…</p> : brief.brief_md ? <Panel><Markdown>{brief.brief_md}</Markdown></Panel> : <p className="text-sm text-muted-foreground">No reference brief yet ({brief.state}).</p>}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
