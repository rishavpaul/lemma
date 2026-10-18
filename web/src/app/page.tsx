"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, Statement, Tomb } from "@/components/shell/page-header";
import { SetupGuide } from "@/components/setup-guide";
import { Ledger, type DayWork } from "@/components/home/ledger";
import { Sparkline } from "@/components/home/sparkline";
import { ScoreChip } from "@/components/score-chip";
import { DeleteSession } from "@/components/delete-session";
import { api } from "@/lib/api";
import { ModePicker } from "@/components/mode-picker";
import { modeBody, useStartMode } from "@/lib/start-mode";
import { speech } from "@/lib/speech";
import { useApi } from "@/lib/use-api";
import { dayKey, fmtDate, streakStats } from "@/lib/format";
import { LEVELS, type CodeProgress, type Progress, type Question, type SessionRow } from "@/lib/types";

/**
 * Today is the day's page of the paper: the lemma to prove (a design question picked for your weakest areas), the
 * problem to solve, the ledger of days, and the record of sessions so far.
 */
export default function Today() {
  const router = useRouter();
  const sessions = useApi<SessionRow[]>("/api/sessions");
  const questions = useApi<Question[]>("/api/questions");
  const progress = useApi<Progress>("/api/progress");
  const fw = useApi<{ sections: { budget_sec: number }[] }>("/api/framework");
  const code = useApi<CodeProgress>("/api/code/progress");
  const [showAll, setShowAll] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const startMode = useStartMode();

  // One streak for both tracks: a day counts if you did a design session or touched a coding problem.
  const activity = useMemo(() => [...(sessions.data ?? []).map((s) => s.started_at), ...(code.data?.activity ?? [])], [sessions.data, code.data]);
  const stats = useMemo(() => streakStats(activity), [activity]);
  const days = useMemo(() => {
    const m = new Map<string, DayWork>();
    const at = (k: string) => m.get(k) ?? (m.set(k, { design: [], code: 0 }), m.get(k)!);
    for (const s of sessions.data ?? []) at(dayKey(s.started_at)).design.push({ title: s.title, score: s.overall_score });
    for (const t of code.data?.activity ?? []) at(dayKey(t)).code += 1;
    return m;
  }, [sessions.data, code.data]);

  async function start(body: { question_id?: number; mode?: string }, tag: string) {
    setStarting(tag);
    speech.unlock();
    try { const s = await api<{ id: number }>("/api/sessions", { method: "POST", body: { ...body, ...modeBody(startMode) } }); router.push(`/session/?id=${s.id}`); }
    catch (e) { toast.error("Could not start", { description: (e as Error).message }); setStarting(null); }
  }

  const loading = !sessions.data || !questions.data || !progress.data;
  const sug = progress.data?.focus.suggested;
  const suggestedQ = questions.data?.find((q) => q.id === sug?.question_id);
  const totalMin = Math.round((fw.data?.sections ?? []).reduce((a, s) => a + s.budget_sec, 0) / 60);
  const scores = (progress.data?.timeline ?? []).slice(-12).map((t) => t.overall_score);
  const last = sessions.data?.find((s) => s.overall_score != null);
  const nextProblem = code.data ? (code.data.next.core[0] ?? code.data.next.practical[0]) : undefined;
  const inProgress = sessions.data?.filter((s) => s.status === "in_progress") ?? [];
  const cs = code.data?.stats;

  return (
    <Page wide>
      <SetupGuide />

      {/* The lemma for today, and the ledger beside it. */}
      <div className="grid grid-cols-1 gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,1fr)_auto]">
        <section aria-labelledby="lemma" className="min-w-0">
          {loading ? <Skeleton className="h-[26rem] w-full" /> : (
            <>
              <h1 id="lemma" className="rise display max-w-[18ch] text-[2.9rem] sm:text-[4rem] xl:text-[4.75rem]" style={{ "--i": 1 } as React.CSSProperties}>{sug?.title ?? "Pick a question"}</h1>
              {suggestedQ && (
                <Statement label={`Lemma ${suggestedQ.id}`} tone="design" className="rise mt-7 max-w-[60ch] text-[1.3rem] md:text-[1.45rem]">{suggestedQ.prompt}</Statement>
              )}
              {sug?.reason && <p className="rise mt-4 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground" style={{ "--i": 3 } as React.CSSProperties}>{sug.reason}</p>}
              <div className="rise mt-9 max-w-[44rem]" style={{ "--i": 4 } as React.CSSProperties}>
                <ModePicker />
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <Button variant="design" size="lg" className="h-12 px-6 text-base" disabled={!!starting} onClick={() => start({ mode: "suggested" }, "s")}>
                    Begin the proof{starting === "s" ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                  </Button>
                  <button type="button" disabled={!!starting} onClick={() => start({ mode: "random" }, "r")}
                    className="text-[15px] font-medium underline decoration-1 underline-offset-4 hover:decoration-2 disabled:opacity-50">
                    {starting === "r" ? "Starting…" : "Or a random question"}
                  </button>
                  {totalMin > 0 && <span className="num text-[15px] text-muted-foreground">{totalMin} minutes, five parts</span>}
                </div>
                {inProgress.length > 0 && (
                  <p className="mt-6 text-[15px]">
                    <span className="text-muted-foreground">Still open: </span>
                    {inProgress.slice(0, 2).map((s, i) => <span key={s.id}>{i > 0 && ", "}<Link href={`/session/?id=${s.id}`} className="font-medium underline decoration-signal decoration-2 underline-offset-4">{s.title}, {s.sections_saved} of {s.sections_total} parts</Link></span>)}
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        <aside aria-label="Streak" className="rise min-w-0 lg:pt-10" style={{ "--i": 3 } as React.CSSProperties}>
          <div className="flex items-baseline gap-3">
            <span className="fig text-[6.5rem]">{stats.current}</span>
            <span className="text-[15px] leading-snug">
              {stats.current === 1 ? "day" : "days"} in a row<br />
              <span className="text-muted-foreground">best {stats.best}</span>
            </span>
          </div>
          <div className="-ml-1 mt-6"><Ledger days={days} /></div>
        </aside>
      </div>

      {/* The coding problem: a whole field of tone, laid out the other way round. */}
      <section aria-labelledby="problem" className="rise mt-20 bg-card px-6 py-10 md:-mx-8 md:px-8 md:py-12" style={{ "--i": 5 } as React.CSSProperties}>
        {!code.data || !cs ? <Skeleton className="h-40 w-full" /> : (
          <div className="grid items-end gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="min-w-0">
              <h2 id="problem" className="display text-[2.2rem] md:text-[3rem]">
                {nextProblem ? nextProblem.title : "Roadmap complete"}
              </h2>
              {nextProblem && (
                <Statement label={nextProblem.num ? `Problem ${nextProblem.num}` : "Build"} tone="code" className="mt-4 max-w-[62ch] text-[1.15rem]">
                  {nextProblem.note}
                </Statement>
              )}
              {nextProblem && <p className="mt-3 text-[14px] text-muted-foreground">{[nextProblem.difficulty, ...nextProblem.tags.slice(0, 3)].join(", ")}{nextProblem.status === "attempted" ? ". You started this one." : "."}</p>}
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                {nextProblem && <Link href={`/code/problem/?slug=${nextProblem.slug}`} className={cn(buttonVariants({ variant: "code", size: "lg" }), "h-12 px-6 text-base")}>{nextProblem.status === "attempted" ? "Continue the problem" : "Solve it"}<ArrowRight /></Link>}
                <Link href="/code" className="text-[15px] font-medium underline decoration-1 underline-offset-4 hover:decoration-2">The whole roadmap</Link>
              </div>
            </div>
            <div>
              <div className="flex items-baseline gap-2"><span className="fig text-[4.5rem] text-code">{cs.done}</span><span className="text-[15px] text-muted-foreground">of {cs.total} problems solved</span></div>
              <div className="mt-3 h-2 bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={cs.total} aria-valuenow={cs.done} aria-label="Problems solved">
                <div className="ink-in h-full bg-code" style={{ width: `${cs.total ? (100 * cs.done) / cs.total : 0}%` }} />
              </div>
              <p className="mt-3 text-[14px] text-muted-foreground">{cs.done ? `${cs.clean} clean, without hints or the solution.` : "None yet."}{code.data.needs_review.length ? ` ${code.data.needs_review.length} to redo from scratch.` : ""}</p>
            </div>
          </div>
        )}
      </section>

      {/* The record, with the referee's standing remark beside it. */}
      <div className="mt-20 grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="record" className="min-w-0">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 id="record" className="font-serif text-[1.9rem] font-medium tracking-tight">The record</h2>
            <Link href="/progress" className="text-[14px] font-medium underline decoration-1 underline-offset-4 hover:decoration-2">Progress</Link>
          </div>
          {!sessions.data ? <Skeleton className="h-40 w-full" /> : sessions.data.length === 0 ? (
            <p className="max-w-[56ch] text-[15px] leading-relaxed text-muted-foreground">No sessions yet. The first one takes about {totalMin || 55} minutes: talk through each part out loud and sketch the system as you go.</p>
          ) : (
            <>
              <table className="booktabs text-[15px]">
                <thead><tr><th>Question</th><th className="hidden sm:table-cell">Started</th><th className="text-right">Grade</th><th className="w-8"><span className="sr-only">Delete</span></th></tr></thead>
                <tbody>
                  {(showAll ? sessions.data : sessions.data.slice(0, 8)).map((s) => (
                    <tr key={s.id} className="group">
                      <td className="font-serif text-[1.05rem]">
                        <Link className="hover:underline hover:underline-offset-4" href={s.status === "in_progress" ? `/session/?id=${s.id}` : `/report/?id=${s.id}`}>{s.title}</Link>
                        {s.status === "done" && <Tomb className="ml-2 text-[0.8em] text-muted-foreground" />}
                      </td>
                      <td className="hidden whitespace-nowrap text-[14px] text-muted-foreground sm:table-cell">{fmtDate(s.started_at)}</td>
                      <td className="whitespace-nowrap text-right">
                        {s.status === "in_progress" ? <span className="text-[14px] text-signal">{s.sections_saved} of {s.sections_total} parts</span>
                          : s.overall_score != null ? <ScoreChip score={s.overall_score} level={s.overall_level ?? undefined} />
                          : <span className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Grading</span>}
                      </td>
                      <td className="text-right">
                        <DeleteSession id={s.id} title={s.title} onDeleted={() => { sessions.reload(); progress.reload(); }}>
                          {(open) => <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete session ${s.id}`} title="Delete session" onClick={open}><X /></Button>}
                        </DeleteSession>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sessions.data.length > 8 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-[14px] font-medium underline decoration-1 underline-offset-4 hover:decoration-2">
                  {showAll ? "Show fewer" : `All ${sessions.data.length} sessions`}
                </button>
              )}
            </>
          )}
        </section>

        <aside className="space-y-10">
          <div>
            <div className="text-[15px] text-muted-foreground">Latest level</div>
            <div className="mt-1 flex items-end justify-between gap-4">
              <div>
                <div className="font-serif text-[2rem] leading-tight">{last?.overall_level ? LEVELS[last.overall_level] : "Not graded yet"}</div>
                {last?.overall_score != null && <div className="num text-[14px] text-muted-foreground">{last.overall_score.toFixed(1)} of 4. Staff is 3.0.</div>}
              </div>
              <Sparkline values={scores} />
            </div>
          </div>
          <Statement label="Remark" className="text-[1.1rem]">
            {progress.data?.focus.drill ?? "Finish a graded session and the referee leaves one concrete thing to practice next time."}
          </Statement>
        </aside>
      </div>
    </Page>
  );
}
