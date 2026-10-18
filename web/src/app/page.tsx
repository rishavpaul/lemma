"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Code2, Dices, Flame, Loader2, Target, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, Panel, Section, Empty } from "@/components/shell/page-header";
import { SetupGuide } from "@/components/setup-guide";
import { Heatmap } from "@/components/home/heatmap";
import { Sparkline } from "@/components/home/sparkline";
import { Pill, ScoreChip } from "@/components/score-chip";
import { DeleteSession } from "@/components/delete-session";
import { api } from "@/lib/api";
import { ModePicker } from "@/components/mode-picker";
import { modeBody, useStartMode } from "@/lib/start-mode";
import { speech } from "@/lib/speech";
import { useApi } from "@/lib/use-api";
import { dayKey, fmtDate, streakStats } from "@/lib/format";
import { LEVELS, type CodeProgress, type Progress, type Question, type SessionRow } from "@/lib/types";

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
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of activity) m.set(dayKey(t), (m.get(dayKey(t)) ?? 0) + 1);
    return m;
  }, [activity]);

  async function start(body: { question_id?: number; mode?: string }, tag: string) {
    setStarting(tag);
    speech.unlock();
    try { const s = await api<{ id: number }>("/api/sessions", { method: "POST", body: { ...body, ...modeBody(startMode) } }); router.push(`/session/?id=${s.id}`); }
    catch (e) { toast.error("Could not start", { description: (e as Error).message }); setStarting(null); }
  }

  const loading = !sessions.data || !questions.data || !progress.data;
  const sug = progress.data?.focus.suggested;
  const suggestedQ = questions.data?.find((q) => q.id === sug?.question_id);
  const totalSec = (fw.data?.sections ?? []).reduce((a, s) => a + s.budget_sec, 0);
  const scores = (progress.data?.timeline ?? []).slice(-12).map((t) => t.overall_score);
  const last = sessions.data?.find((s) => s.overall_score != null);
  const nextProblem = code.data ? (code.data.next.core[0] ?? code.data.next.practical[0]) : undefined;
  const greeting = stats.doneToday ? "You practiced today. One more rep never hurts." : stats.current > 0 ? `Practice today to keep your ${stats.current}-day streak.` : "Start your streak with a design session or a coding problem.";
  const inProgress = sessions.data?.filter((s) => s.status === "in_progress") ?? [];

  return (
    <Page wide>
      <SetupGuide />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <Wordmark />
            <p className="text-sm text-muted-foreground">{greeting}</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {loading ? <Skeleton className="h-80 w-full rounded-2xl" /> : (
              <div className="relative overflow-hidden rounded-2xl border border-signal/30 bg-card p-6">
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(var(--grid-dot) 1.2px, transparent 1.2px)", backgroundSize: "20px 20px", maskImage: "linear-gradient(180deg, black, transparent 70%)" }} />
                <div className="relative flex h-full flex-col">
                  <Pill tone="signal" className="self-start"><Target className="size-3" />System design{suggestedQ && scores.length > 0 ? " · picked for your weakest areas" : ""}</Pill>
                  <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-tight">{sug?.title ?? "Pick a question"}</h2>
                  {sug?.reason && <p className="mt-2 text-sm text-muted-foreground">{sug.reason}</p>}
                  {suggestedQ && <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed">{suggestedQ.prompt}</p>}
                  <ModePicker className="mt-5" />
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button size="lg" className="h-11 px-5 text-base" disabled={!!starting} onClick={() => start({ mode: "suggested" }, "s")}>
                      {starting === "s" ? <Loader2 className="animate-spin" /> : <ArrowRight data-icon="inline-end" className="order-last" />}Start session
                    </Button>
                    <Button variant="outline" className="h-11" disabled={!!starting} onClick={() => start({ mode: "random" }, "r")}>{starting === "r" ? <Loader2 className="animate-spin" /> : <Dices />}Surprise me</Button>
                    <span className="num text-sm text-muted-foreground">{totalSec ? `${Math.round(totalSec / 60)} min` : ""}</span>
                  </div>
                  {inProgress.length > 0 && (
                    <p className="mt-5 text-sm text-muted-foreground">Unfinished: {inProgress.slice(0, 2).map((s, i) => <span key={s.id}>{i > 0 && ", "}<Link href={`/session/?id=${s.id}`} className="font-medium text-signal underline underline-offset-4">{s.title} ({s.sections_saved}/{s.sections_total})</Link></span>)}</p>
                  )}
                </div>
              </div>
            )}

            {!code.data ? <Skeleton className="h-80 w-full rounded-2xl" /> : (
              <div className="relative overflow-hidden rounded-2xl border border-code/30 bg-card p-6">
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(var(--grid-dot) 1.2px, transparent 1.2px)", backgroundSize: "20px 20px", maskImage: "linear-gradient(180deg, black, transparent 70%)" }} />
                <div className="relative flex h-full flex-col">
                  <Pill tone="code" className="self-start"><Code2 className="size-3" />Coding{nextProblem?.status === "attempted" ? " · in progress" : ""}</Pill>
                  {nextProblem ? (
                    <>
                      <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-tight">{nextProblem.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">{[nextProblem.difficulty, nextProblem.tags.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</p>
                      {nextProblem.note && <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed">{nextProblem.note}</p>}
                    </>
                  ) : (
                    <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-tight">Roadmap complete</h2>
                  )}
                  <div className="num mt-5 text-sm text-muted-foreground">{code.data.stats.done} of {code.data.stats.total} problems done{code.data.stats.done ? `, ${code.data.stats.clean} clean` : ""}{code.data.needs_review.length ? ` · ${code.data.needs_review.length} to revisit` : ""}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-code" style={{ width: `${code.data.stats.total ? Math.round((100 * code.data.stats.done) / code.data.stats.total) : 0}%` }} /></div>
                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
                    {nextProblem && <Link href={`/code/problem/?slug=${nextProblem.slug}`} className={cn(buttonVariants({ size: "lg" }), "h-11 bg-code px-5 text-base text-code-foreground hover:bg-code/90")}>{nextProblem.status === "attempted" ? "Continue" : "Start problem"}<ArrowRight data-icon="inline-end" /></Link>}
                    <Link href="/code" className={cn(buttonVariants({ variant: "outline" }), "h-11")}>Roadmap</Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Section title="Recent sessions" className="mt-10" aside={<Link href="/progress" className="text-xs text-muted-foreground hover:text-foreground">All progress</Link>}>
            {!sessions.data ? <Skeleton className="h-40 w-full" /> : sessions.data.length === 0 ? (
              <Empty title="No sessions yet">Your first one takes about 55 minutes. Talk through each section out loud and sketch the system as you go.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <tbody>
                    {(showAll ? sessions.data : sessions.data.slice(0, 8)).map((s) => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-3"><Link className="font-medium hover:underline" href={s.status === "in_progress" ? `/session/?id=${s.id}` : `/report/?id=${s.id}`}>{s.title}</Link></td>
                        <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{fmtDate(s.started_at)}</td>
                        <td className="px-4 py-3 text-right">{s.status === "in_progress" ? <Pill>{s.sections_saved}/{s.sections_total} saved</Pill> : s.overall_score != null ? <ScoreChip score={s.overall_score} level={s.overall_level ?? undefined} /> : <Pill tone="signal"><Loader2 className="size-3 animate-spin" />grading</Pill>}</td>
                        <td className="w-10 py-3 pr-3 text-right">
                          <DeleteSession id={s.id} title={s.title} onDeleted={() => { sessions.reload(); progress.reload(); }}>
                            {(open) => <Button variant="ghost" size="icon-xs" aria-label={`Delete session ${s.id}`} title="Delete session" onClick={open}><Trash2 /></Button>}
                          </DeleteSession>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sessions.data.length > 8 && (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full border-t px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                    {showAll ? "Show fewer" : `Show all ${sessions.data.length} sessions`}
                  </button>
                )}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Panel>
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-xl bg-signal/15"><Flame className="size-7 text-signal" /></div>
              <div>
                <div className="fig text-5xl leading-none">{stats.current}</div>
                <div className="mt-1 text-sm text-muted-foreground">day streak <span className="text-muted-foreground/70">· best {stats.best}</span></div>
              </div>
            </div>
            <div className="mt-5 overflow-x-auto pb-1"><Heatmap counts={counts} /></div>
          </Panel>

          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-muted-foreground">Latest level</div>
                <div className="mt-1 text-xl font-semibold">{last?.overall_level ? LEVELS[last.overall_level] : "Not graded yet"}</div>
                {last?.overall_score != null && <div className="num text-sm text-muted-foreground">{last.overall_score.toFixed(1)} of 4, staff is 3.0</div>}
              </div>
              <Sparkline values={scores} />
            </div>
          </Panel>

          <Panel>
            <div className="text-sm font-medium">Drill for today</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{progress.data?.focus.drill ?? "Finish a graded session and your coach leaves one concrete thing to practice next time."}</p>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
