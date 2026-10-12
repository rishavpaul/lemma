"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Dices, Flame, Loader2, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, Panel, Section, Empty } from "@/components/shell/page-header";
import { SetupGuide } from "@/components/setup-guide";
import { Heatmap } from "@/components/home/heatmap";
import { Sparkline } from "@/components/home/sparkline";
import { Pill, ScoreChip } from "@/components/score-chip";
import { DeleteSession } from "@/components/delete-session";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { dayKey, fmtDate, streakStats } from "@/lib/format";
import { LEVELS, type Progress, type Question, type SessionRow } from "@/lib/types";

export default function Today() {
  const router = useRouter();
  const sessions = useApi<SessionRow[]>("/api/sessions");
  const questions = useApi<Question[]>("/api/questions");
  const progress = useApi<Progress>("/api/progress");
  const fw = useApi<{ sections: { budget_sec: number }[] }>("/api/framework");
  const [showAll, setShowAll] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const stats = useMemo(() => streakStats((sessions.data ?? []).map((s) => s.started_at)), [sessions.data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions.data ?? []) m.set(dayKey(s.started_at), (m.get(dayKey(s.started_at)) ?? 0) + 1);
    return m;
  }, [sessions.data]);

  async function start(body: { question_id?: number; mode?: string }, tag: string) {
    setStarting(tag);
    try { const s = await api<{ id: number }>("/api/sessions", { method: "POST", body }); router.push(`/session/?id=${s.id}`); }
    catch (e) { toast.error("Could not start", { description: (e as Error).message }); setStarting(null); }
  }

  const loading = !sessions.data || !questions.data || !progress.data;
  const sug = progress.data?.focus.suggested;
  const suggestedQ = questions.data?.find((q) => q.id === sug?.question_id);
  const totalSec = (fw.data?.sections ?? []).reduce((a, s) => a + s.budget_sec, 0);
  const scores = (progress.data?.timeline ?? []).slice(-12).map((t) => t.overall_score);
  const last = sessions.data?.find((s) => s.overall_score != null);
  const inProgress = sessions.data?.filter((s) => s.status === "in_progress") ?? [];

  return (
    <Page wide>
      <SetupGuide />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">{stats.doneToday ? "You practiced today. One more rep never hurts." : stats.current > 0 ? `Practice today to keep your ${stats.current}-day streak.` : "Start your streak with one session."}</p>
          {loading ? <Skeleton className="h-64 w-full rounded-2xl" /> : (
            <div className="relative overflow-hidden rounded-2xl border bg-card p-6 md:p-8">
              <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(var(--grid-dot) 1.2px, transparent 1.2px)", backgroundSize: "20px 20px", maskImage: "linear-gradient(120deg, transparent 35%, #000)" }} />
              <div className="relative">
                <Pill tone="signal"><Target className="size-3" />{suggestedQ && scores.length > 0 ? "Picked for your weakest areas" : "Today's question"}</Pill>
                <h1 className="mt-4 max-w-[22ch] text-[2.1rem] font-semibold leading-[1.1] tracking-tight md:text-[2.6rem]">{sug?.title ?? "Pick a question"}</h1>
                {sug?.reason && <p className="mt-3 max-w-[56ch] text-sm text-muted-foreground">{sug.reason}</p>}
                {suggestedQ && <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed">{suggestedQ.prompt}</p>}
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button size="lg" className="h-11 px-5 text-base" disabled={!!starting} onClick={() => start({ mode: "suggested" }, "s")}>
                    {starting === "s" ? <Loader2 className="animate-spin" /> : <ArrowRight data-icon="inline-end" className="order-last" />}Start session
                  </Button>
                  <Button variant="outline" className="h-11" disabled={!!starting} onClick={() => start({ mode: "random" }, "r")}>{starting === "r" ? <Loader2 className="animate-spin" /> : <Dices />}Surprise me</Button>
                  <span className="num text-sm text-muted-foreground">{totalSec ? `${Math.round(totalSec / 60)} min, 5 sections` : ""}</span>
                </div>
                {inProgress.length > 0 && (
                  <p className="mt-5 text-sm text-muted-foreground">Unfinished: {inProgress.slice(0, 2).map((s, i) => <span key={s.id}>{i > 0 && ", "}<Link href={`/session/?id=${s.id}`} className="font-medium text-signal underline underline-offset-4">{s.title} ({s.sections_saved}/7)</Link></span>)}</p>
                )}
              </div>
            </div>
          )}

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
                        <td className="px-4 py-3 text-right">{s.status === "in_progress" ? <Pill>{s.sections_saved}/7 saved</Pill> : s.overall_score != null ? <ScoreChip score={s.overall_score} level={s.overall_level ?? undefined} /> : <Pill tone="signal"><Loader2 className="size-3 animate-spin" />grading</Pill>}</td>
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
