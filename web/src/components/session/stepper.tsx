import { cn } from "@/lib/utils";
import { Tomb } from "@/components/shell/page-header";
import type { Section } from "@/lib/types";

/** The proof's outline: each part a bar, inked ochre while it is being answered and closed with a tombstone when saved. */
export function Stepper({ sections, current }: { sections: Section[]; current: number }) {
  return (
    <ol className="flex w-full items-start gap-1.5" aria-label="Parts">
      {sections.map((s, i) => {
        const done = s.status === "saved", cur = i === current;
        return (
          <li key={s.key} className="min-w-0 flex-1" aria-current={cur ? "step" : undefined}>
            <div className="h-[3px] bg-muted"><div className={cn("h-full origin-left transition-transform duration-500", done ? "scale-x-100 bg-foreground" : cur ? "scale-x-100 bg-signal" : "scale-x-0")} /></div>
            <div className={cn("mt-2 hidden items-center gap-1.5 truncate text-[13px] sm:flex", cur ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground")}>
              <span className="truncate">{s.title}</span>
              {done && <Tomb className="shrink-0 text-[0.75em]" />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
