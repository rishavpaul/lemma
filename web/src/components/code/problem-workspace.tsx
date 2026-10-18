"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Award, ChevronRight, Clock, FlaskConical, Lightbulb, Loader2, Play, RotateCcw, Send, Sparkles, TriangleAlert, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/markdown";
import { Pill } from "@/components/score-chip";
import { JavaEditor } from "@/components/code/java-editor";
import { ResultsPanel } from "@/components/code/results-panel";
import { ReviewView } from "@/components/code/review-view";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { fmtDate, mmss } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CodeAttempt, CodeProblemDetail, CodeRun, CodeSolution, Rating } from "@/lib/types";

const DIFF_TONE: Record<string, "mint" | "signal" | "coral" | "muted"> = { Easy: "mint", Medium: "signal", Hard: "coral", Build: "muted" };
const RATING_TEXT: Record<Rating, string> = { clean: "Clean solve", hints: "Solved with hints", solution: "Needed the solution" };
type LeftTab = "problem" | "tests" | "about";
type RightTab = "results" | "review" | "hints" | "solution";

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: React.ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", value === t.id ? "border-signal text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ProblemWorkspace({ slug, attemptParam }: { slug: string; attemptParam: number | null }) {
  const detail = useApi<CodeProblemDetail>(`/api/code/problems/${slug}`, (d) => (d.problem.spec === "generating" ? 3000 : false));
  const [chosenId, setAttemptId] = useState<number | null>(attemptParam);
  const attemptId = chosenId ?? detail.data?.attempts.find((x) => x.status === "in_progress")?.id ?? null;  // reopen the unfinished attempt
  const pending = (a: CodeAttempt) => a.reviews.some((r) => r.job && ["queued", "running"].includes(r.job.status)) || a.coach_hints.some((h) => h.job && ["queued", "running"].includes(h.job.status));
  const attempt = useApi<CodeAttempt>(attemptId ? `/api/code/attempts/${attemptId}` : null, (a) => (pending(a) ? 2500 : false));
  const requested = useRef(false);

  // First visit: the problem has no tests yet, so build them.
  const d = detail.data;
  useEffect(() => {
    if (d && d.problem.spec === "none" && !requested.current) {
      requested.current = true;
      api(`/api/code/problems/${slug}/generate`, { method: "POST" }).then(() => detail.reload()).catch((e) => toast.error((e as Error).message));
    }
  }, [d, slug, detail]);

  async function start(restart: boolean) {
    try { const r = await api<{ id: number }>(`/api/code/problems/${slug}/attempts`, { method: "POST", body: { restart } }); setAttemptId(r.id); detail.reload(); }
    catch (e) { toast.error((e as Error).message); }
  }

  if (!d) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  const p = d.problem;
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-4 md:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/code" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Roadmap</Link>
        <h1 className="text-xl font-semibold tracking-tight">{p.num ? <span className="num mr-2 text-muted-foreground">{p.num}</span> : null}{p.title}</h1>
        <Pill tone={DIFF_TONE[p.difficulty] ?? "muted"}>{p.difficulty}</Pill>
        {p.premium && <Pill>premium</Pill>}
        {p.status === "done" && p.rating && <Pill tone={p.rating === "clean" ? "mint" : "signal"}>{RATING_TEXT[p.rating]}</Pill>}
      </div>
      {!d.brief && !d.spec ? (p.spec === "failed" ? (
          <div className="rounded-xl border border-coral/40 bg-coral/5 p-5">
            <p className="flex items-center gap-2 font-medium text-coral"><TriangleAlert className="size-4" />This problem could not be written.</p>
            <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">{p.spec_error ?? "Unknown error."}</p>
            <Button className="mt-3" onClick={async () => { await api(`/api/code/problems/${slug}/generate`, { method: "POST" }); detail.reload(); }}>Try again</Button>
          </div>
        ) : <Preparing detail={d} />) : !attemptId || !attempt.data ? (
          attemptId ? <Skeleton className="h-96 w-full" /> : <StartScreen d={d} onStart={start} onOpen={setAttemptId} />
        ) : <Workspace key={attempt.data.id} d={d} a={attempt.data} reload={() => { void attempt.reload(); void detail.reload(); }} onRestart={() => start(true)} />}
    </div>
  );
}

function Preparing({ detail }: { detail: CodeProblemDetail }) {
  return (
    <div className="rounded-xl border p-8 text-center">
      <Loader2 className="mx-auto size-6 animate-spin text-signal" />
      <p className="mt-3 font-medium">Writing {detail.problem.title}</p>
      <p className="mx-auto mt-1 max-w-[56ch] text-sm text-muted-foreground">The statement and your starter file appear in about 20 seconds. The tests are built in the background after that, so you can start reading and coding straight away.</p>
    </div>
  );
}

function StartScreen({ d, onStart, onOpen }: { d: CodeProblemDetail; onStart: (restart: boolean) => void; onOpen: (id: number) => void }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted-foreground">{d.problem.note}</p>
      <Button className="mt-4" size="lg" onClick={() => onStart(true)}><Play />{d.attempts.length ? "Start a new attempt" : "Start"}</Button>
      {d.attempts.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Earlier attempts</h2>
          <ul className="overflow-hidden rounded-xl border">
            {d.attempts.map((a) => (
              <li key={a.id} className="border-b last:border-0">
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40" onClick={() => onOpen(a.id)}>
                  <span className="flex-1">{fmtDate(a.started_at)}</span>
                  {a.status === "solved" ? <Pill tone={a.rating === "clean" ? "mint" : "signal"}>{RATING_TEXT[a.rating]}</Pill> : <Pill>{a.status === "in_progress" ? "unfinished" : a.status}</Pill>}
                  <span className="num text-xs text-muted-foreground">{mmss(a.active_sec)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Workspace({ d, a, reload, onRestart }: { d: CodeProblemDetail; a: CodeAttempt; reload: () => void; onRestart: () => void }) {
  const spec = d.spec;                    // the validated tests; null while they are still being built
  const pub = (d.spec ?? d.brief)!;       // the statement and starter exist before the tests do
  const testsReady = !!spec;
  const building = !testsReady && d.problem.spec === "generating";
  const nLevels = Math.max(1, pub.levels.length);
  const [code, setCode] = useState(a.code);
  const [explanation, setExplanation] = useState(a.explanation);
  const [left, setLeft] = useState<LeftTab>("problem");
  const [right, setRight] = useState<RightTab>("results");
  const [running, setRunning] = useState<"run" | "submit" | null>(null);
  const [run, setRun] = useState<CodeRun | null>(a.last_run);
  const [levelPassed, setLevelPassed] = useState(false);
  const solved = a.status === "solved";

  const wasReady = useRef(testsReady);
  useEffect(() => {
    if (testsReady && !wasReady.current) toast.success("The tests are ready. Run and Submit are unlocked.");
    wasReady.current = testsReady;
  }, [testsReady]);

  // Active time: counts only while the tab is visible.
  const [seconds, setSeconds] = useState(a.active_sec);
  const active = useRef(seconds);
  useEffect(() => { active.current = seconds; }, [seconds]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && a.status !== "solved") setSeconds((n) => n + 1); }, 1000);
    return () => clearInterval(t);
  }, [a.status]);

  // Autosave
  const dirty = useRef(false);
  const latest = useRef({ code, explanation });
  useEffect(() => { latest.current = { code, explanation }; }, [code, explanation]);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => { api(`/api/code/attempts/${a.id}/code`, { method: "PUT", body: { code, explanation, active_sec: active.current } }).catch(() => {}); dirty.current = false; }, 1200);
    return () => clearTimeout(t);
  }, [code, explanation, a.id]);
  useEffect(() => {
    const id = setInterval(() => { api(`/api/code/attempts/${a.id}/code`, { method: "PUT", body: { code: latest.current.code, explanation: latest.current.explanation, active_sec: active.current } }).catch(() => {}); }, 30000);
    return () => clearInterval(id);
  }, [a.id]);

  const readyRef = useRef(testsReady);
  useEffect(() => { readyRef.current = testsReady; }, [testsReady]);
  const doRun = useCallback(async (kind: "run" | "submit") => {
    if (!readyRef.current) { toast.info("The tests are still being built", { description: "Keep coding. Run unlocks as soon as they are ready." }); return; }
    setRunning(kind); setRight("results"); setLevelPassed(false);
    try {
      const r = await api<{ run_id: number; kind: string; verdict: CodeRun["verdict"]; duration_ms: number; solved: boolean; level_passed: boolean; level: number }>(
        `/api/code/attempts/${a.id}/run`, { method: "POST", body: { code: latest.current.code, kind, active_sec: active.current } });
      setRun({ id: r.run_id, kind: r.kind, status: r.verdict?.status ?? "", passed: r.verdict?.passed ?? 0, total: r.verdict?.total ?? 0, level: r.level, created_at: Date.now() / 1000, duration_ms: r.duration_ms, verdict: r.verdict });
      dirty.current = false;
      if (r.solved) { toast.success("Solved. Ask for the staff review while it is fresh."); setRight("results"); reload(); }
      else if (r.level_passed) { setLevelPassed(true); toast.success(`Level ${r.level} passed`); reload(); }
    } catch (e) { toast.error("Could not run", { description: (e as Error).message }); }
    setRunning(null);
  }, [a.id, reload]);
  const runRef = useRef(doRun);
  useEffect(() => { runRef.current = doRun; }, [doRun]);
  const onRun = useCallback(() => void runRef.current("run"), []);
  const onSubmit = useCallback(() => void runRef.current("submit"), []);

  const elapsed = Math.round(seconds);
  const target = (d.problem.difficulty === "Hard" ? 35 : 25) * 60;
  const lastReview = a.reviews.find((r) => r.status === "done");
  const reviewing = a.reviews.some((r) => r.job && ["queued", "running"].includes(r.job.status));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="min-w-0 lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto lg:pr-1">
        <Tabs<LeftTab> value={left} onChange={setLeft} tabs={[{ id: "problem", label: "Problem" }, { id: "tests", label: spec ? `Tests (${spec.cases.length}${spec.hidden_cases ? ` + ${spec.hidden_cases} hidden` : ""})` : "Tests" }, { id: "about", label: "About" }]} />
        <div className="py-4">
          {left === "problem" && (
            <>
              <Markdown>{pub.statement_md}</Markdown>
              {pub.constraints.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Constraints</h3><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{pub.constraints.map((c, i) => <li key={i}><code className="num text-xs">{c}</code></li>)}</ul></>}
              {pub.levels.slice(0, a.level).map((lv) => (
                <div key={lv.n} className="mt-5 rounded-lg border p-3">
                  <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><Pill tone="signal">Level {lv.n}</Pill>{lv.title}{d.levels_text?.[lv.n - 1]?.staff && <Pill tone="coral">staff</Pill>}</div>
                  <Markdown>{lv.statement_md}</Markdown>
                </div>
              ))}
              {a.level < nLevels && <p className="mt-4 text-sm text-muted-foreground">{nLevels - a.level} more level{nLevels - a.level === 1 ? "" : "s"} unlock as you pass each one. Keep the same class and do not restart between levels.</p>}
            </>
          )}
          {left === "tests" && !spec && <TestsPending building={building} d={d} reload={reload} />}
          {left === "tests" && spec && (
            <ul className="space-y-3">
              {spec.cases.filter((c) => c.level <= a.level).map((c) => (
                <li key={c.id} className="rounded-lg border p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">{c.name}<Pill>{c.kind === "example" ? "example" : "edge case"}</Pill>{c.level > 1 && <Pill tone="signal">L{c.level}</Pill>}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Input</div><pre className="num max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-xs">{c.input}</pre></div>
                    <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Expected</div><pre className="num max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-xs">{c.expected}</pre></div>
                  </div>
                </li>
              ))}
              <li className="text-sm text-muted-foreground">Submit also runs {spec.hidden_cases} hidden random and stress case{spec.hidden_cases === 1 ? "" : "s"}. Their expected answers came from a reference solution that agreed with an independent brute-force solution on every case kept.</li>
            </ul>
          )}
          {left === "about" && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">{d.problem.note}</p>
              <div className="flex flex-wrap gap-1.5">{d.problem.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div>
              {spec && <div className="rounded-lg border p-3">
                <p className="font-medium">How these tests were built</p>
                <p className="mt-1 text-muted-foreground">Model {spec.model}. {spec.report.kept ?? spec.cases.length} cases kept{spec.report.dropped ? `, ${spec.report.dropped} dropped because the reference and the brute force disagreed` : ""}{spec.report.unverified ? `, ${spec.report.unverified} larger cases checked against the reference only` : ""}. {spec.report.rounds && spec.report.rounds.length > 1 ? `It took ${spec.report.rounds.length} rounds of fixing before the two solutions agreed.` : "The two solutions agreed on the first try."}</p>
                {spec.status === "partial" && <p className="mt-2 text-coral">Some cases could not be validated and were left out, so coverage is thinner than usual. {spec.report.issues?.[0]}</p>}
                <Button size="sm" variant="outline" className="mt-3" onClick={async () => { await api(`/api/code/problems/${d.problem.slug}/generate`, { method: "POST" }); toast.success("Rebuilding the tests. Your current attempt keeps the old ones."); }}>Rebuild tests</Button>
              </div>}
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {nLevels > 1 && <Pill tone="signal">Level {a.level} of {nLevels}</Pill>}
          <span className="num inline-flex items-center gap-1.5 text-sm text-muted-foreground" title="Active time, paused when this tab is hidden"><Clock className="size-3.5" />{mmss(elapsed)}<span className="text-xs">/ {mmss(target)} target</span></span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" title="Replace your code with the starter file" onClick={() => { if (code === pub.starter_code || window.confirm("Replace your code with the starter file?")) { setCode(pub.starter_code); dirty.current = true; } }}><RotateCcw />Reset</Button>
            <Button size="sm" variant="outline" disabled={!!running || !testsReady} title={testsReady ? undefined : "Unlocks when the tests are built"} onClick={onRun}>{running === "run" ? <Loader2 className="animate-spin" /> : <Play />}Run</Button>
            <Button size="sm" disabled={!!running || !testsReady} title={testsReady ? undefined : "Unlocks when the tests are built"} onClick={onSubmit}>{running === "submit" ? <Loader2 className="animate-spin" /> : <Send />}Submit</Button>
          </div>
        </div>
        {!testsReady && (
          <div className={cn("mb-2 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm", d.problem.spec === "failed" ? "border-coral/40 bg-coral/5 text-coral" : "border-signal/40 bg-signal/10")}>
            {d.problem.spec === "failed" ? (
              <><TriangleAlert className="size-4 shrink-0" /><span className="min-w-0 flex-1">The tests could not be built: {d.problem.spec_error ?? "unknown error"}</span>
                <Button size="sm" variant="outline" onClick={async () => { await api(`/api/code/problems/${d.problem.slug}/generate`, { method: "POST" }); reload(); }}>Try again</Button></>
            ) : (
              <><Loader2 className="size-4 shrink-0 animate-spin text-signal" /><span className="min-w-0 flex-1"><b>Building the tests in the background</b> (about a minute). Keep reading and coding. Run and Submit unlock when they are ready.</span></>
            )}
          </div>
        )}
        <JavaEditor value={code} onChange={(v) => { setCode(v); dirty.current = true; }} onRun={onRun} onSubmit={onSubmit} attemptId={a.id} height="clamp(320px, 48vh, 620px)" />

        {(solved || levelPassed) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-mint/40 bg-mint/10 p-3">
            <Award className="size-5 text-mint" />
            <div className="min-w-0 flex-1 text-sm">
              {solved ? <><b>{RATING_TEXT[a.rating]}</b> in {mmss(Math.round(a.active_sec || seconds))}. {a.rating !== "clean" && "This problem is in your review list."}</>
                : <><b>Level {a.level} passed.</b> Unlock the next level and extend the same class.</>}
            </div>
            {!solved && a.level < nLevels && <Button size="sm" onClick={async () => { try { await api(`/api/code/attempts/${a.id}/advance`, { method: "POST" }); setLevelPassed(false); setRun(null); setLeft("problem"); reload(); } catch (e) { toast.error((e as Error).message); } }}><Unlock />Unlock level {a.level + 1}</Button>}
            {solved && <Button size="sm" variant="outline" onClick={onRestart}><RotateCcw />Redo from scratch</Button>}
          </div>
        )}

        <div className="mt-3 overflow-hidden rounded-xl border">
          <Tabs<RightTab> value={right} onChange={setRight} tabs={[
            { id: "results", label: <span className="inline-flex items-center gap-1.5"><FlaskConical className="size-3.5" />Results</span> },
            { id: "review", label: <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" />Staff review{reviewing && <Loader2 className="size-3 animate-spin" />}</span> },
            { id: "hints", label: <span className="inline-flex items-center gap-1.5"><Lightbulb className="size-3.5" />Hints{a.hints_used > 0 && <span className="num text-xs text-muted-foreground">{a.hints_used}</span>}</span> },
            { id: "solution", label: "Solution" },
          ]} />
          {right === "results" && <ResultsPanel run={run} running={running} />}
          {right === "review" && <ReviewTab a={a} explanation={explanation} setExplanation={(v) => { setExplanation(v); dirty.current = true; }} code={code} hasRun={!!run} lastReview={lastReview} reload={reload} />}
          {right === "hints" && (spec ? <HintsTab a={a} spec={spec} code={code} reload={reload} /> : <WaitingForTests what="Hints and the coach" />)}
          {right === "solution" && (spec ? <SolutionTab a={a} reload={reload} /> : <WaitingForTests what="The solution and write-up" />)}
        </div>
      </section>
    </div>
  );
}

function WaitingForTests({ what }: { what: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{what} come with the answer key, which is built together with the tests. They unlock as soon as the tests are ready.</p>;
}

function TestsPending({ building, d, reload }: { building: boolean; d: CodeProblemDetail; reload: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm">
      {building ? (
        <><p className="flex items-center gap-2 font-medium"><Loader2 className="size-4 animate-spin text-signal" />Building the tests</p>
          <p className="mt-1 text-muted-foreground">Claude writes a reference solution and an independent brute-force solution, and the app keeps only the cases they agree on. You can keep working: your code is saved, and Run unlocks when this finishes.</p></>
      ) : (
        <><p className="font-medium">No tests yet</p>
          <Button size="sm" className="mt-2" onClick={async () => { await api(`/api/code/problems/${d.problem.slug}/generate`, { method: "POST" }); reload(); }}>Build the tests</Button></>
      )}
    </div>
  );
}

function ReviewTab({ a, explanation, setExplanation, code, hasRun, lastReview, reload }: {
  a: CodeAttempt; explanation: string; setExplanation: (v: string) => void; code: string; hasRun: boolean; lastReview: CodeAttempt["reviews"][number] | undefined; reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const running = a.reviews.find((r) => r.job && ["queued", "running"].includes(r.job.status));
  const failed = !running && a.reviews[0]?.job && ["failed", "pending_retry"].includes(a.reviews[0].job.status) ? a.reviews[0] : null;
  const [showForm, setShowForm] = useState(false);
  async function request() {
    setBusy(true);
    try { await api(`/api/code/attempts/${a.id}/review`, { method: "POST", body: { code, explanation } }); setShowForm(false); reload(); }
    catch (e) { toast.error("Could not start the review", { description: (e as Error).message }); }
    setBusy(false);
  }
  const form = (
    <div className="p-4">
      <p className="text-sm text-muted-foreground">A staff-level interviewer reads your code the way a hiring committee would: correctness and the expected approach first, then structure, tradeoffs, production awareness and how you would test it. It is graded on the same 1-4 scale as your design sessions, where 3.0 is staff.</p>
      <label htmlFor="explain" className="mt-4 block text-sm font-medium">Explain your approach, as you would out loud <span className="font-normal text-muted-foreground">(optional)</span></label>
      <p className="text-xs text-muted-foreground">Approach, complexity, tradeoffs, what you would test, what you left out. Without it, communication is not graded.</p>
      <textarea id="explain" value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={6} placeholder="I would key each word by its sorted letters, so anagrams share a key. That is O(n k log k) time..." className="mt-2 w-full rounded-lg border bg-background p-3 text-sm outline-none focus-visible:border-ring" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={busy || !hasRun} onClick={request}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}Get staff review</Button>
        {!hasRun && <span className="text-xs text-muted-foreground">Run the tests once first so the review starts from real results.</span>}
        {a.hints_used > 0 && <span className="text-xs text-muted-foreground">Using hints or the solution lowers the cap on your score.</span>}
      </div>
    </div>
  );
  if (running) return <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin text-signal" />The reviewer is reading your code. This usually takes one to three minutes.</div>;
  if (showForm || !lastReview) return <>{failed && <p className="mx-4 mt-4 rounded-md border border-coral/40 bg-coral/5 p-3 text-sm text-coral">The last review failed: {failed.job?.error ?? "unknown error"}</p>}{form}</>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
        <span>Reviewed {fmtDate(lastReview.created_at)} by {lastReview.model}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setShowForm(true)}>Review again</Button>
      </div>
      {lastReview.result ? <ReviewView r={lastReview.result} id={`review-${lastReview.id}`} /> : null}
    </div>
  );
}

function HintsTab({ a, spec, code, reload }: { a: CodeAttempt; spec: { hint_count: number }; code: string; reload: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const left = spec.hint_count - Math.min(a.hints_used, spec.hint_count);
  const prepared = a.canned_hints;
  const coach = useMemo(() => a.coach_hints, [a.coach_hints]);
  async function nextHint() {
    setBusy(true);
    try { await api(`/api/code/attempts/${a.id}/hint`, { method: "POST" }); setConfirm(false); reload(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }
  async function ask() {
    setBusy(true);
    try { await api(`/api/code/attempts/${a.id}/coach`, { method: "POST", body: { question: q, code } }); setQ(""); reload(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="p-4">
      <p className="text-sm text-muted-foreground">Hints are how you would get unstuck with a real interviewer, and they count: a solve with hints is marked for review and caps your review score at 3.0.</p>
      {prepared.length > 0 && (
        <ol className="mt-4 space-y-2">{prepared.map((h, i) => <li key={i} className="rounded-lg border p-3 text-sm"><span className="num mr-2 text-xs text-muted-foreground">Hint {i + 1}</span>{h}</li>)}</ol>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {left > 0 && !confirm && <Button variant="outline" size="sm" onClick={() => setConfirm(true)}><Lightbulb />Show hint {Math.min(a.hints_used, spec.hint_count) + 1} of {spec.hint_count}</Button>}
        {left > 0 && confirm && <><span className="text-sm">This marks the attempt as using hints.</span><Button size="sm" disabled={busy} onClick={nextHint}>Show it</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></>}
        {left === 0 && <span className="text-sm text-muted-foreground">You have seen all {spec.hint_count} prepared hints.</span>}
      </div>
      <div className="mt-6 border-t pt-4">
        <h3 className="text-sm font-semibold">Ask the coach about your code</h3>
        <p className="text-xs text-muted-foreground">It reads your code and your latest test results and gives one nudge, never the solution. Counts as a hint.</p>
        <div className="mt-2 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !busy) void ask(); }} placeholder="Why does my third example fail? (or leave empty)" aria-label="Question for the coach" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring" />
          <Button size="sm" disabled={busy} onClick={ask}>{busy ? <Loader2 className="animate-spin" /> : null}Ask</Button>
        </div>
        <ul className="mt-3 space-y-2">
          {[...coach].reverse().map((h) => (
            <li key={h.id} className="rounded-lg border p-3 text-sm">
              {h.question && <p className="mb-1 text-xs text-muted-foreground">You: {h.question}</p>}
              {h.text ? <p>{h.text}</p> : h.job && ["failed", "pending_retry"].includes(h.job.status) ? <p className="text-coral">Could not get a hint: {h.job.error}</p> : <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Thinking...</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SolutionTab({ a, reload }: { a: CodeAttempt; reload: () => void }) {
  const [sol, setSol] = useState<CodeSolution | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const solved = a.status === "solved";
  async function show() {
    setBusy(true);
    try { setSol(await api<CodeSolution>(`/api/code/attempts/${a.id}/solution`, { method: "POST" })); reload(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }
  if (!sol) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">{solved ? "You solved this one. Compare your approach with the reference and read what interviewers look for." : "Reading the reference solution ends a clean attempt: it is marked as needing the solution, and your review score is capped at 2.0. Try a hint first."}</p>
        <div className="mt-3 flex items-center gap-2">
          {!solved && !confirm && !a.solution_viewed ? <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>Show the solution</Button> :
            <Button size="sm" variant={solved ? "default" : "destructive"} disabled={busy} onClick={show}>{busy && <Loader2 className="animate-spin" />}{solved || a.solution_viewed ? "Show solution and write-up" : "Yes, show it"}</Button>}
          {confirm && !solved && <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>}
        </div>
      </div>
    );
  }
  return (
    <div className="p-4">
      <div className="flex flex-wrap gap-2 text-sm"><Pill tone="signal">Time {sol.time_complexity}</Pill><Pill tone="signal">Space {sol.space_complexity}</Pill></div>
      <Markdown>{sol.approach_md}</Markdown>
      <h3 className="mt-4 text-sm font-semibold">Reference solution</h3>
      <div className="mt-1"><JavaEditor value={sol.reference_solution} readOnly height="320px" /></div>
      {sol.pitfalls.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Pitfalls interviewers watch for</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{sol.pitfalls.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {sol.follow_ups.length > 0 && <><h3 className="mt-4 text-sm font-semibold">Follow-ups to be ready for</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{sol.follow_ups.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
    </div>
  );
}
