"use client";
import { cn } from "@/lib/utils";
import { setStartMode, useStartMode, type StartMode } from "@/lib/start-mode";

const OPTIONS: { value: StartMode; title: string; hint: string }[] = [
  { value: "full", title: "Full interview", hint: "Answer every section, then read the whole report." },
  { value: "interactive", title: "Interactive coaching", hint: "Each answer is graded as you submit it, and the feedback is read aloud." },
];

/** The choice between a full mock interview and section-by-section coaching. Two tone-step tiles; the chosen one is inked. */
export function ModePicker({ className }: { className?: string }) {
  const mode = useStartMode();
  return (
    <div role="radiogroup" aria-label="Session mode" className={cn("grid gap-1.5 sm:grid-cols-2", className)}>
      {OPTIONS.map((o) => {
        const on = mode === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => setStartMode(o.value)}
            className={cn("flex gap-3 rounded-[3px] p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              on ? "bg-[color-mix(in_oklch,var(--signal)_16%,var(--background))]" : "bg-muted hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)]")}>
            <span aria-hidden className={cn("mt-1 size-3 shrink-0 transition-colors", on ? "bg-signal" : "bg-[color-mix(in_oklch,var(--muted),var(--foreground)_22%)]")} />
            <span>
              <span className="block text-[15px] font-semibold">{o.title}</span>
              <span className={cn("mt-0.5 block text-[13px] leading-snug", "text-muted-foreground")}>{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
