import { Pill } from "@/components/score-chip";
import type { DiagramReview } from "@/lib/types";

export function DiagramReviewCard({ r }: { r: DiagramReview }) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-card/60 p-4 text-sm">
      <div className="font-medium">Diagram review</div>
      <p className="text-muted-foreground">{r.assessment}</p>
      {r.strengths.length > 0 && <ul className="list-disc space-y-1 pl-5">{r.strengths.map((s) => <li key={s}>{s}</li>)}</ul>}
      {r.issues.map((i, k) => (
        <div key={k} className="rounded-md border bg-card p-3">
          <div className="mb-1 flex items-center gap-2"><Pill tone={i.severity === "high" ? "coral" : i.severity === "medium" ? "signal" : "muted"}>{i.severity}</Pill><span>{i.issue}</span></div>
          <p className="text-muted-foreground"><span className="font-medium text-foreground">Instead: </span>{i.suggestion}</p>
        </div>
      ))}
      {r.narration_mismatches.length > 0 && (
        <div><div className="mb-1 text-xs font-medium text-muted-foreground">Said and drawn don&apos;t match</div><ul className="list-disc space-y-1 pl-5">{r.narration_mismatches.map((s) => <li key={s}>{s}</li>)}</ul></div>
      )}
    </div>
  );
}
