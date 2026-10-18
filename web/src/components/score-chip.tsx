import { cn } from "@/lib/utils";
import { LEVELS, type Level } from "@/lib/types";

const TONE = (s: number) => (s >= 3 ? "text-mint" : s >= 2 ? "text-signal" : "text-coral");

/** A score as a referee would pencil it: the figure in the text face, coloured against the staff bar, then the level. */
export function ScoreChip({ score, level, className }: { score: number; level?: Level; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap", className)}>
      <span className={cn("fig text-[1.2rem] font-semibold", TONE(score))}>{score.toFixed(1)}</span>
      {level && <span className="text-[13px] text-muted-foreground">{LEVELS[level]}</span>}
    </span>
  );
}

/** A short status label: a tinted tone step with square corners, never a pill. */
export function Pill({ children, tone = "muted", className }: { children: React.ReactNode; tone?: "muted" | "mint" | "signal" | "code" | "coral"; className?: string }) {
  const t = { muted: "bg-muted text-muted-foreground", mint: "bg-mint/12 text-mint", signal: "bg-signal/12 text-signal", code: "bg-code/12 text-code", coral: "bg-coral/12 text-coral" }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-[2px] px-1.5 py-px text-[12px] font-medium leading-5", t, className)}>{children}</span>;
}
