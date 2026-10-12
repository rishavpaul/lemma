import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Section } from "@/lib/types";

export function Stepper({ sections, current }: { sections: Section[]; current: number }) {
  return (
    <ol className="flex w-full items-center gap-1" aria-label="Sections">
      {sections.map((s, i) => {
        const done = s.status === "saved", cur = i === current;
        return (
          <li key={s.key} className="min-w-0 flex-1" aria-current={cur ? "step" : undefined}>
            <div className={cn("h-1 rounded-full", done ? "bg-mint" : cur ? "bg-signal" : "bg-border")} />
            <div className={cn("mt-1.5 flex items-center gap-1 truncate text-[11px]", cur ? "font-medium text-foreground" : "text-muted-foreground")}>
              {done && <Check className="size-3 shrink-0 text-mint" />}
              <span className="truncate">{s.title}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
