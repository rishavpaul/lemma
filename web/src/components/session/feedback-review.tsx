"use client";
import { useEffect } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreChip } from "@/components/score-chip";
import { ListenButton } from "@/components/listen-button";
import { feedbackSpeech, speech } from "@/lib/speech";
import type { Section } from "@/lib/types";

/** Interactive mode: after you submit a section, stay here until its feedback is in and has been read to you. */
export function FeedbackReview({ sec, nextLabel, onContinue }: { sec: Section; nextLabel: string; onContinue: () => void }) {
  const g = sec.grade;
  const failed = !g && !!sec.grade_job && (sec.grade_job.status === "failed" || sec.grade_job.status === "pending_retry");
  useEffect(() => {
    if (g) speech.play(`fb:${sec.key}`, feedbackSpeech(sec.title, g));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the grade lands, not on every refresh of the section
  }, [!!g, sec.key]);
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4 text-sm" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Feedback: {sec.title}</h2>
        {g && <ScoreChip score={g.score} level={g.level_signal} />}
      </div>
      {!g && !failed && <div className="flex items-center gap-3 py-3"><Loader2 className="size-5 animate-spin text-signal" />Grading your answer. The feedback is read aloud as soon as it is ready.</div>}
      {failed && <p className="text-coral">Grading failed: {sec.grade_job?.error || sec.grade_job?.status}. You can continue; it is retried from the report.</p>}
      {g && (
        <div className="space-y-3 leading-relaxed">
          <p>{g.summary}</p>
          {(g.gap_summary || g.gaps.length > 0) && (
            <div>
              <p className="font-medium">Gaps</p>
              {g.gap_summary ? <p className="text-muted-foreground">{g.gap_summary}</p> : (
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{g.gaps.slice(0, 3).map((x) => <li key={x.tag}>{x.description}</li>)}</ul>
              )}
            </div>
          )}
          <ListenButton id={`fb:${sec.key}`} label="Replay" text={feedbackSpeech(sec.title, g)} controls />
        </div>
      )}
      <Button size="lg" className="w-full" onClick={() => { speech.stop(); onContinue(); }} disabled={!g && !failed}><ArrowRight />{nextLabel}</Button>
    </div>
  );
}
