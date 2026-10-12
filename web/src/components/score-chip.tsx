import { cn } from "@/lib/utils";
import { LEVELS, type Level } from "@/lib/types";

export function ScoreChip({ score, level, className }: { score: number; level?: Level; className?: string }) {
  const tone = score >= 3 ? "border-mint/40 bg-mint/10 text-mint" : score >= 2 ? "border-signal/40 bg-signal/10 text-signal" : "border-coral/40 bg-coral/10 text-coral";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", tone, className)}>
      <span className="num font-semibold">{score.toFixed(1)}</span>
      {level && <span>{LEVELS[level]}</span>}
    </span>
  );
}

export function Pill({ children, tone = "muted", className }: { children: React.ReactNode; tone?: "muted" | "mint" | "signal" | "coral"; className?: string }) {
  const t = { muted: "border-border text-muted-foreground", mint: "border-mint/40 bg-mint/10 text-mint", signal: "border-signal/40 bg-signal/10 text-signal", coral: "border-coral/40 bg-coral/10 text-coral" }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", t, className)}>{children}</span>;
}
