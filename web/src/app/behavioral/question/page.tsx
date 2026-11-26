"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Mic, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, Statement } from "@/components/shell/page-header";
import { ScoreChip } from "@/components/score-chip";
import { Markdown } from "@/components/markdown";
import { StoryDialog } from "@/components/behavioral/story-dialog";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useRecorder } from "@/lib/use-recorder";
import { fmtDate } from "@/lib/format";
import { DIMS, spokenMinutes, wordCount, type Attempt, type QuestionDetail, type Review } from "@/lib/behavioral";
import { cn } from "@/lib/utils";

const pending = (a: Attempt) => a.status === "queued" || a.status === "running";
const TONE = (s: number) => (s >= 3 ? "text-mint" : s >= 2 ? "text-signal" : "text-coral");

function Feedback({ r }: { r: Review }) {
  return (
    <div className="space-y-6">
      {!r.answers_the_question && <p className="rounded-[3px] bg-coral/10 px-4 py-3 text-[15px] text-coral">This story does not answer the question that was asked, so the score is capped at senior.</p>}
      <p className="font-serif text-[1.15rem] leading-relaxed">{r.summary}</p>

      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {DIMS.map(([k, label]) => {
          const d = r.dimension_scores[k];
          if (!d) return null;
          return (
            <div key={k}>
              <dt className="flex items-baseline gap-2 text-[14px] font-semibold">
                {label}
                {d.assessed ? <span className={cn("fig", TONE(d.score))}>{d.score.toFixed(1)}</span> : <span className="font-normal text-muted-foreground">not tested</span>}
              </dt>
              {d.assessed && <dd className="text-[14px] leading-relaxed text-muted-foreground">{d.rationale}</dd>}
            </div>
          );
        })}
      </dl>

      {r.strengths.length > 0 && (
        <div>
          <h4 className="mb-2 text-[15px] font-semibold">What already reads as staff</h4>
          <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed">{r.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {r.gaps.length > 0 && (
        <div>
          <h4 className="mb-2 text-[15px] font-semibold">What to fix</h4>
          <ol className="space-y-3">
            {r.gaps.map((g, i) => (
              <li key={i} className="text-[15px] leading-relaxed">
                <p><span className="num mr-2 text-muted-foreground">{i + 1}.</span>{g.issue}</p>
                {g.quote && <p className="mt-1 pl-5 font-serif italic text-muted-foreground">&ldquo;{g.quote}&rdquo;</p>}
                <p className="mt-1"><span className="font-semibold text-lead">Fix: </span>{g.fix}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {r.follow_ups.length > 0 && (
        <div>
          <h4 className="mb-2 text-[15px] font-semibold">The interviewer would ask next</h4>
          <ul className="space-y-1.5">{r.follow_ups.map((f, i) => <li key={i} className="statement text-[1.05rem]">{f}</li>)}</ul>
        </div>
      )}
      {r.stronger_outline && (
        <div>
          <h4 className="mb-2 text-[15px] font-semibold">The same story, tighter</h4>
          <div className="rounded-[3px] bg-background px-4 py-3"><Markdown>{r.stronger_outline}</Markdown></div>
        </div>
      )}
    </div>
  );
}

function AttemptCard({ a, n, open, reload }: { a: Attempt; n: number; open: boolean; reload: () => void }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [expanded, setExpanded] = useState(open);
  async function run(fn: () => Promise<unknown>) { try { await fn(); reload(); } catch (e) { toast.error((e as Error).message); } }
  const failed = a.status === "failed" || a.job?.status === "pending_retry";

  return (
    <section className="rounded-[3px] bg-card px-5 py-5 md:px-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="font-serif text-[1.25rem] font-medium hover:underline hover:underline-offset-4">Attempt {n}</button>
        <span className="text-[14px] text-muted-foreground">{fmtDate(a.created_at)}, {wordCount(a.text)} words</span>
        {a.result && <ScoreChip score={a.result.overall_score} level={a.result.level_signal} />}
        {pending(a) && <span className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 className="size-4 animate-spin text-lead" />The judge is reading your answer…</span>}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setShowAnswer((v) => !v)}>{showAnswer ? "Hide answer" : "Your answer"}</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete this attempt" title="Delete this attempt" onClick={() => { if (window.confirm("Delete this attempt and its feedback?")) void run(() => api(`/api/behavioral/attempts/${a.id}`, { method: "DELETE" })); }}><Trash2 /></Button>
        </div>
      </div>
      {showAnswer && <p className="mt-4 whitespace-pre-wrap rounded-[3px] bg-background px-4 py-3 font-serif text-[1.02rem] leading-relaxed">{a.text}</p>}
      {failed && a.job && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[3px] bg-coral/10 px-4 py-3 text-[15px] text-coral">
          Could not grade: {a.job.error || a.job.status}
          <Button variant="outline" size="sm" onClick={() => run(() => api(`/api/jobs/${a.job!.id}/retry`, { method: "POST" }))}><RotateCcw />Try again</Button>
        </div>
      )}
      {a.result && expanded && <div className="mt-5"><Feedback r={a.result} /></div>}
    </section>
  );
}

function Practice({ id }: { id: number }) {
  const { data, reload } = useApi<QuestionDetail>(`/api/behavioral/questions/${id}`, (d) => (d.attempts.some(pending) ? 2000 : false));
  const [text, setText] = useState<string | null>(null);
  const [storyId, setStoryId] = useState<number | null | undefined>(undefined);
  const [newStory, setNewStory] = useState(false);
  const [lookFor, setLookFor] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const answer = text ?? data?.draft ?? "";
  const story = storyId === undefined ? data?.story_id ?? null : storyId;
  const { rec, start, stop } = useRecorder("/api/behavioral/transcribe", (t) => edit((answer.trim() ? answer.trimEnd() + " " : "") + t));

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  function edit(next: string) {
    setText(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void api(`/api/behavioral/questions/${id}/draft`, { method: "PUT", body: { text: next } }).catch(() => {}); }, 700);
  }
  async function pickStory(sid: number | null) {
    setStoryId(sid);
    try { await api(`/api/behavioral/questions/${id}/draft`, { method: "PUT", body: { story_id: sid } }); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function submit() {
    setBusy(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await api(`/api/behavioral/questions/${id}/draft`, { method: "PUT", body: { text: answer } });
      await api(`/api/behavioral/questions/${id}/attempts`, { method: "POST", body: { text: answer, story_id: story } });
      await reload();
    } catch (e) { toast.error("Could not submit", { description: (e as Error).message }); }
    setBusy(false);
  }

  if (!data) return <Skeleton className="h-96 w-full" />;
  const words = wordCount(answer);
  const mins = spokenMinutes(words);
  const chosen = data.stories.find((s) => s.id === story);

  return (
    <>
      <Link href="/behavioral/" className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Behavioral</Link>
      <h1 className="display text-[2.3rem] md:text-[3rem]">{data.title}</h1>
      <Statement label={data.competency_name} tone="lead" className="mt-4 max-w-[66ch] text-[1.3rem]">{data.prompt}</Statement>
      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={() => setLookFor((v) => !v)}>{lookFor ? "Hide" : "Show"} what a staff interviewer listens for</Button>
        {lookFor && <Statement label="Listening for" className="mt-2 max-w-[66ch] rounded-[3px] bg-card px-4 py-3 text-[1rem]">{data.look_for}</Statement>}
      </div>

      <section className="mt-10 space-y-3">
        <h2 className="font-serif text-[1.4rem] font-medium">Story</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={story ?? ""} aria-label="Story for this question" onChange={(e) => void pickStory(e.target.value ? Number(e.target.value) : null)}
            className="h-10 min-w-0 flex-1 rounded-[3px] bg-card px-3 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-ring">
            <option value="">No story picked</option>
            {data.stories.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <Button variant="outline" onClick={() => setNewStory(true)}>New story</Button>
        </div>
        {chosen?.notes && <p className="whitespace-pre-wrap rounded-[3px] bg-card px-4 py-3 text-[14px] leading-relaxed text-muted-foreground">{chosen.notes}</p>}
      </section>

      <section className="mt-10">
        <label htmlFor="answer" className="mb-3 block font-serif text-[1.4rem] font-medium">Your answer</label>
        <textarea id="answer" value={answer} onChange={(e) => edit(e.target.value)}
          className="min-h-[260px] w-full resize-y rounded-[3px] bg-card p-4 font-serif text-[1.08rem] leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-ring"
          placeholder="Record it out loud the way you would say it in the room, then tidy the transcript. Saved as you type." />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={cn("num text-[14px]", words === 0 ? "text-muted-foreground" : mins > 3.5 ? "text-coral" : mins >= 1.5 ? "text-mint" : "text-signal")}>
            {words} words, about {mins < 1 ? "under a minute" : `${mins.toFixed(1)} minutes`} spoken
          </span>
          <span className="text-[13px] text-muted-foreground">Aim for two to three minutes.</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {rec === "recording"
              ? <Button size="lg" variant="destructive" onClick={stop}><Square />Stop recording</Button>
              : <Button size="lg" variant="outline" disabled={busy || rec === "transcribing"} onClick={start}>{rec === "transcribing" ? <Loader2 className="animate-spin" /> : <Mic />}{rec === "transcribing" ? "Transcribing…" : "Record"}</Button>}
            <Button size="lg" variant="lead" disabled={busy || rec !== "idle" || words < 20} onClick={submit}>{busy && <Loader2 className="animate-spin" />}Get staff feedback</Button>
          </div>
        </div>
      </section>

      {data.attempts.length > 0 && (
        <section className="mt-14 space-y-4">
          <h2 className="font-serif text-[1.4rem] font-medium">Feedback</h2>
          {data.attempts.map((a, i) => <AttemptCard key={a.id} a={a} n={data.attempts.length - i} open={i === 0} reload={reload} />)}
        </section>
      )}

      {newStory && <StoryDialog story={null} onClose={() => setNewStory(false)} onSaved={async (sid) => { await reload(); await pickStory(sid); }} />}
    </>
  );
}

function Inner() {
  const id = Number(useSearchParams().get("id"));
  if (!id) return <p className="text-sm text-muted-foreground">No question selected.</p>;
  return <Practice key={id} id={id} />;
}

export default function BehavioralQuestionPage() {
  return <Page><Suspense fallback={<Skeleton className="h-96 w-full" />}><Inner /></Suspense></Page>;
}
