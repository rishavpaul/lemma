import { cn } from "@/lib/utils";
import { dimLabel, mmss } from "@/lib/format";

const tone = (s: number) => (s >= 3 ? "bg-mint" : s >= 2 ? "bg-signal" : "bg-coral");
const text = (s: number) => (s >= 3 ? "text-mint" : s >= 2 ? "text-signal" : "text-coral");

/** The ten dimensions as plain bars on a 1-4 scale, with the staff bar (3.0) marked across all of them. */
export function DimensionChart({ scores }: { scores: Record<string, { score: number }> }) {
  const rows = Object.entries(scores);
  const at = (v: number) => `${((v - 1) / 3) * 100}%`;
  return (
    <div role="list" className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[11rem] right-12 hidden sm:block">
        <div className="absolute inset-y-0 w-[2px] bg-mint/50" style={{ left: at(3) }} />
        <span className="absolute -top-6 -translate-x-1/2 text-[12px] font-medium text-mint" style={{ left: at(3) }}>staff</span>
      </div>
      {rows.map(([k, v], i) => (
        <div role="listitem" key={k} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-3 py-1.5 sm:grid-cols-[11rem_minmax(0,1fr)_3rem]">
          <span className="truncate text-[14px] first-letter:uppercase">{dimLabel(k)}</span>
          <div className="col-span-2 row-start-2 h-2.5 bg-muted sm:col-span-1 sm:row-start-auto">
            <div className={cn("ink-in h-full", tone(v.score))} style={{ width: at(Math.max(1, v.score)), minWidth: 4, "--i": i } as React.CSSProperties} />
          </div>
          <span className={cn("fig text-right text-[1.2rem] font-semibold", text(v.score))}>{v.score.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

/** Time per part: the budget as a tone step, the time used over it (red where it ran over). */
export function TimeChart({ rows }: { rows: { name: string; used: number; budget: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.used, r.budget]));
  return (
    <div role="list">
      {rows.map((r, i) => (
        <div role="listitem" key={r.name} className="py-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[14px]"><span className="truncate">{r.name}</span><span className="num shrink-0 text-muted-foreground"><span className={cn(r.used > r.budget ? "text-coral" : "text-foreground")}>{mmss(r.used)}</span> of {mmss(r.budget)}</span></div>
          <div className="relative mt-1 h-2.5">
            <div className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${(r.budget / max) * 100}%` }} />
            <div className={cn("ink-in absolute inset-y-0 left-0", r.used > r.budget ? "bg-coral" : "bg-foreground")} style={{ width: `${(r.used / max) * 100}%`, "--i": i } as React.CSSProperties} />
          </div>
        </div>
      ))}
    </div>
  );
}
