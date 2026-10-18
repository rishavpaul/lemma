"use client";
import { cn } from "@/lib/utils";
import { setStartMode, useStartMode, type StartMode } from "@/lib/start-mode";

const OPTIONS: { value: StartMode; title: string; hint: string }[] = [
  { value: "full", title: "Full interview", hint: "Answer every section, then see all results at the end." },
  { value: "interactive", title: "Interactive coaching", hint: "Each answer is graded as you submit it and the feedback is read aloud." },
];

/** The deliberate choice between a full mock interview and section-by-section coaching with spoken feedback. */
export function ModePicker({ className }: { className?: string }) {
  const mode = useStartMode();
  return (
    <div role="radiogroup" aria-label="Session mode" className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={mode === o.value} onClick={() => setStartMode(o.value)}
          className={cn("rounded-xl border p-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            mode === o.value ? "border-signal bg-signal/10" : "hover:bg-accent/40")}>
          <span className="block font-medium">{o.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}
