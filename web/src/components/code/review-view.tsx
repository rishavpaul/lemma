"use client";
import { Statement } from "@/components/shell/page-header";
import { LEVELS } from "@/lib/types";
import { ListenButton } from "@/components/listen-button";
import { Markdown } from "@/components/markdown";
import { dimLabel, scoreTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CodeReviewResult } from "@/lib/types";

const VERDICT = { wrong: "Does not solve the problem", correct_slow: "Correct, but not the expected approach", correct_optimal: "Correct, with the expected approach" } as const;
const SIGNAL = { strong_no: "Strong no", lean_no: "Lean no", lean_hire: "Lean hire", strong_hire: "Strong hire" } as const;
const SEV: Record<string, string> = { high: "coral", medium: "signal", low: "muted" };

function Sec({ title, children }: { icon?: unknown; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h3 className="mb-3 font-serif text-[1.35rem] font-medium tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

/** The staff-interview review of a solution: verdict, rubric scores, issues tied to the code, and what to say out loud. */
export function ReviewView({ r, id }: { r: CodeReviewResult; id: string }) {
  const dims = Object.entries(r.dimension_scores);
  return (
    <div className="p-5 text-[15px]">
      <div className="flex items-start gap-6">
        <div className={cn("fig text-[4.2rem] font-semibold", scoreTone(r.overall_score))}>{r.overall_score.toFixed(1)}</div>
        <div className="pt-1">
          <p className="display text-[1.7rem]">{SIGNAL[r.hire_signal]}. {VERDICT[r.verdict_kind]}.</p>
          <p className="mt-1 text-[14px] text-muted-foreground">{LEVELS[r.overall_level]}, on the 1 to 4 scale where staff is 3.0.</p>
        </div>
      </div>
      {r.caps_applied && r.caps_applied.length > 0 && (
        <p className="mt-3 text-[13px] text-signal">Score capped at {Math.min(...r.caps_applied.map((c) => c.cap)).toFixed(1)}: {r.caps_applied.map((c) => c.reason.toLowerCase()).join("; ")}.</p>
      )}
      <p className="mt-5 max-w-[68ch] font-serif text-[1.12rem] leading-relaxed">{r.summary}</p>

      <div className="mt-8 grid gap-x-10 gap-y-4 sm:grid-cols-2">
        {dims.map(([k, d]) => (
          <div key={k} title={d.rationale}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="capitalize">{dimLabel(k)}</span>
              {d.assessed ? <span className={cn("num font-medium", scoreTone(d.score))}>{d.score.toFixed(1)}</span> : <span className="text-xs text-muted-foreground">not assessed</span>}
            </div>
            <div className="mt-1 h-2 bg-muted"><div className={cn("ink-in h-full", d.score >= 3 ? "bg-mint" : d.score >= 2 ? "bg-signal" : "bg-coral")} style={{ width: d.assessed ? `${(d.score / 4) * 100}%` : 0 }} /></div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{d.rationale}</p>
          </div>
        ))}
      </div>

      <Sec title="Complexity">
        <table className="booktabs max-w-xl text-[14px]">
          <thead><tr><th /><th>Time</th><th>Space</th></tr></thead>
          <tbody>
            <tr><td className="text-muted-foreground">Yours</td><td className="font-mono text-[13px]">{r.complexity.your_time}</td><td className="font-mono text-[13px]">{r.complexity.your_space}</td></tr>
            <tr><td className="text-muted-foreground">Expected</td><td className="font-mono text-[13px]">{r.complexity.optimal_time}</td><td className="font-mono text-[13px]">{r.complexity.optimal_space}</td></tr>
          </tbody>
        </table>
        <p className="mt-3 max-w-[70ch] text-muted-foreground">{r.complexity.note}</p>
      </Sec>

      {r.strengths.length > 0 && (
        <Sec title="What works"><ul className="space-y-1.5">{r.strengths.map((s, i) => <li key={i} className="flex gap-3"><span aria-hidden className="mt-[0.55em] size-[5px] shrink-0 bg-mint" />{s}</li>)}</ul></Sec>
      )}

      {r.issues.length > 0 && (
        <Sec title="Issues in your code">
          <ul className="space-y-7">
            {r.issues.map((x, i) => (
              <li key={i} className="max-w-[72ch]">
                <p className="font-semibold"><span className={cn(SEV[x.severity] === "coral" ? "text-coral" : SEV[x.severity] === "signal" ? "text-signal" : "text-muted-foreground")}>{x.severity}. </span>{x.title}</p>
                <p className="mt-1 leading-relaxed">{x.detail}</p>
                {x.quote && <pre className="mt-2 overflow-x-auto rounded-[2px] bg-background px-3 py-2 font-mono text-xs">{x.quote}</pre>}
                <p className="mt-2 text-muted-foreground"><span className="font-semibold text-foreground">Fix: </span>{x.fix}</p>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {r.staff_gaps.length > 0 && (
        <Sec title="Gap to the staff bar">
          <ul className="space-y-7">
            {r.staff_gaps.map((g, i) => (
              <li key={i} className="max-w-[72ch]">
                <p><span className="font-semibold text-signal">{g.area}. </span>{g.gap}</p>
                <Statement label="Staff does" className="mt-2 bg-background px-4 py-3 text-[1rem]">{g.what_staff_does}</Statement>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {r.improvements.length > 0 && (
        <Sec title="Better ways to write it">
          <ul className="space-y-7">
            {r.improvements.map((x, i) => (
              <li key={i}>
                <p className="font-semibold">{x.title}</p>
                <p className="mt-1 max-w-[72ch] text-muted-foreground">{x.why}</p>
                <pre className="mt-2 overflow-x-auto rounded-[2px] bg-background px-3 py-2.5 font-mono text-xs leading-relaxed">{x.code}</pre>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      <Sec title="What to say out loud">
        <Markdown>{r.say_out_loud}</Markdown><ListenButton id={`${id}-say`} text={r.say_out_loud} className="mt-3" />
      </Sec>

      {r.interviewer_follow_ups.length > 0 && (
        <Sec title="What the interviewer asks next">
          <ul className="space-y-5">
            {r.interviewer_follow_ups.map((f, i) => (
              <li key={i} className="max-w-[72ch]"><p className="statement text-[1.1rem]">{f.question}</p><p className="mt-1 text-muted-foreground">{f.strong_answer}</p></li>
            ))}
          </ul>
        </Sec>
      )}

      <Sec title="Next">
        <Statement label="Drill" className="max-w-[68ch] text-[1.15rem]">{r.drill}</Statement>
        <p className="mt-2 max-w-[70ch] text-muted-foreground">{r.redo_advice}</p>
      </Sec>
    </div>
  );
}
