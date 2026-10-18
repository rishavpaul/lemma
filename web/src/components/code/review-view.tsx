"use client";
import { AlertTriangle, ArrowRight, CheckCircle2, Lightbulb, MessageSquareQuote, Target } from "lucide-react";
import { ScoreChip, Pill } from "@/components/score-chip";
import { ListenButton } from "@/components/listen-button";
import { Markdown } from "@/components/markdown";
import { dimLabel, scoreTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CodeReviewResult } from "@/lib/types";

const VERDICT = { wrong: "Does not solve the problem", correct_slow: "Correct, but not the expected approach", correct_optimal: "Correct, with the expected approach" } as const;
const SIGNAL = { strong_no: "Strong no", lean_no: "Lean no", lean_hire: "Lean hire", strong_hire: "Strong hire" } as const;
const SEV: Record<string, "coral" | "signal" | "muted"> = { high: "coral", medium: "signal", low: "muted" };

function Sec({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-signal" />{title}</h3>
      {children}
    </section>
  );
}

/** The staff-interview review of a solution: verdict, rubric scores, issues tied to the code, and what to say out loud. */
export function ReviewView({ r, id }: { r: CodeReviewResult; id: string }) {
  const dims = Object.entries(r.dimension_scores);
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreChip score={r.overall_score} level={r.overall_level} />
        <Pill tone={r.hire_signal === "strong_hire" || r.hire_signal === "lean_hire" ? "mint" : "coral"}>{SIGNAL[r.hire_signal]}</Pill>
        <Pill tone={r.verdict_kind === "correct_optimal" ? "mint" : r.verdict_kind === "wrong" ? "coral" : "signal"}>{VERDICT[r.verdict_kind]}</Pill>
      </div>
      {r.caps_applied && r.caps_applied.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Score capped at {Math.min(...r.caps_applied.map((c) => c.cap)).toFixed(1)}: {r.caps_applied.map((c) => c.reason.toLowerCase()).join("; ")}.</p>
      )}
      <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed">{r.summary}</p>

      <div className="mt-5 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {dims.map(([k, d]) => (
          <div key={k} title={d.rationale}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="capitalize">{dimLabel(k)}</span>
              {d.assessed ? <span className={cn("num font-medium", scoreTone(d.score))}>{d.score.toFixed(1)}</span> : <span className="text-xs text-muted-foreground">not assessed</span>}
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", d.score >= 3 ? "bg-mint" : d.score >= 2 ? "bg-signal" : "bg-coral")} style={{ width: d.assessed ? `${(d.score / 4) * 100}%` : 0 }} /></div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{d.rationale}</p>
          </div>
        ))}
      </div>

      <Sec icon={Target} title="Complexity">
        <div className="overflow-hidden rounded-lg border text-sm">
          <table className="w-full"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left font-medium" /><th className="px-3 py-1.5 text-left font-medium">Time</th><th className="px-3 py-1.5 text-left font-medium">Space</th></tr></thead>
            <tbody>
              <tr className="border-t"><td className="px-3 py-1.5 text-muted-foreground">Yours</td><td className="num px-3 py-1.5">{r.complexity.your_time}</td><td className="num px-3 py-1.5">{r.complexity.your_space}</td></tr>
              <tr className="border-t"><td className="px-3 py-1.5 text-muted-foreground">Expected</td><td className="num px-3 py-1.5">{r.complexity.optimal_time}</td><td className="num px-3 py-1.5">{r.complexity.optimal_space}</td></tr>
            </tbody></table>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{r.complexity.note}</p>
      </Sec>

      {r.strengths.length > 0 && (
        <Sec icon={CheckCircle2} title="What works"><ul className="list-disc space-y-1 pl-5 text-sm">{r.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></Sec>
      )}

      {r.issues.length > 0 && (
        <Sec icon={AlertTriangle} title="Issues in your code">
          <ul className="space-y-3">
            {r.issues.map((x, i) => (
              <li key={i} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2"><Pill tone={SEV[x.severity] ?? "muted"}>{x.severity}</Pill><span className="text-sm font-medium">{x.title}</span></div>
                <p className="mt-1.5 text-sm leading-relaxed">{x.detail}</p>
                {x.quote && <pre className="num mt-2 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs">{x.quote}</pre>}
                <p className="mt-2 flex gap-1.5 text-sm text-muted-foreground"><ArrowRight className="mt-0.5 size-3.5 shrink-0" />{x.fix}</p>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {r.staff_gaps.length > 0 && (
        <Sec icon={Target} title="Gap to the staff bar">
          <ul className="space-y-3">
            {r.staff_gaps.map((g, i) => (
              <li key={i} className="rounded-lg border p-3 text-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-signal">{g.area}</div>
                <p className="mt-1">{g.gap}</p>
                <p className="mt-2 rounded-md bg-mint/10 px-2.5 py-1.5"><b>Staff does: </b>{g.what_staff_does}</p>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {r.improvements.length > 0 && (
        <Sec icon={Lightbulb} title="Better ways to write it">
          <ul className="space-y-3">
            {r.improvements.map((x, i) => (
              <li key={i} className="rounded-lg border p-3">
                <div className="text-sm font-medium">{x.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{x.why}</p>
                <pre className="num mt-2 overflow-x-auto rounded bg-muted px-3 py-2 text-xs leading-relaxed">{x.code}</pre>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      <Sec icon={MessageSquareQuote} title="What to say out loud">
        <div className="rounded-lg border bg-muted/30 p-3"><Markdown>{r.say_out_loud}</Markdown><ListenButton id={`${id}-say`} text={r.say_out_loud} className="mt-2" /></div>
      </Sec>

      {r.interviewer_follow_ups.length > 0 && (
        <Sec icon={MessageSquareQuote} title="Follow-ups the interviewer asks next">
          <ul className="space-y-2">
            {r.interviewer_follow_ups.map((f, i) => (
              <li key={i} className="rounded-lg border p-3 text-sm"><p className="font-medium">{f.question}</p><p className="mt-1 text-muted-foreground">{f.strong_answer}</p></li>
            ))}
          </ul>
        </Sec>
      )}

      <Sec icon={ArrowRight} title="Next">
        <p className="text-sm"><b>Drill: </b>{r.drill}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{r.redo_advice}</p>
      </Sec>
    </div>
  );
}
