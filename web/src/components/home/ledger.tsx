"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { dayKey } from "@/lib/format";

export interface DayWork { design: { title: string; score: number | null }[]; code: number }

/**
 * The ledger: one end-of-proof mark per day, one column per week (Monday at the top), the latest week on the right.
 * Ochre for a design session, blue for coding, split when both. Today's mark is hollow until something is done.
 * Point at a day (or move with the arrow keys) to read what was done on it.
 */
export function Ledger({ days, weeks = 20 }: { days: Map<string, DayWork>; weeks?: number }) {
  const cells = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7;
    const start = new Date(today); start.setDate(start.getDate() - dow - (weeks - 1) * 7);
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const date = new Date(start); date.setDate(start.getDate() + i);
      const key = dayKey(date.getTime() / 1000);
      return { i, date, key, w: days.get(key), future: date > today, today: key === dayKey(today.getTime() / 1000) };
    });
  }, [days, weeks]);
  const todayIdx = cells.findIndex((c) => c.today);
  const [sel, setSel] = useState(todayIdx);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const c = cells[sel] ?? cells[todayIdx];
  // On a narrow screen the ledger scrolls sideways; start at the latest week, where today is.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, []);

  function move(e: React.KeyboardEvent) {
    const d = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const n = Math.min(todayIdx, Math.max(0, sel + d));
    setSel(n); refs.current[n]?.focus();
  }

  const said = (x: (typeof cells)[number]) => {
    const parts = [
      ...(x.w?.design ?? []).map((d) => (d.score != null ? `${d.title}, ${d.score.toFixed(1)}` : d.title)),
      ...(x.w?.code ? [`${x.w.code} coding ${x.w.code === 1 ? "problem" : "problems"}`] : []),
    ];
    return parts.length ? parts.join(" · ") : x.today ? "Nothing yet today. The mark stays open until you practice." : "No practice.";
  };

  return (
    <div>
      <div ref={scroller} className="overflow-x-auto p-1">
      <div role="grid" aria-label={`Practice ledger, last ${weeks} weeks`} onKeyDown={move}
        className="grid w-max grid-flow-col grid-rows-7 gap-[5px]">
        {cells.map((x) => {
          const d = !!x.w?.design.length, k = !!x.w?.code;
          return (
            <button key={x.key} ref={(el) => { refs.current[x.i] = el; }} type="button" role="gridcell" disabled={x.future}
              tabIndex={x.i === sel ? 0 : -1} aria-label={`${x.date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}: ${said(x)}`}
              onMouseEnter={() => !x.future && setSel(x.i)} onFocus={() => setSel(x.i)} onClick={() => setSel(x.i)}
              className={cn("relative size-[15px] overflow-hidden transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-offset-1",
                x.future ? "invisible" : "hover:scale-125", x.i === sel && !x.future && "scale-125",
                !d && !k && !x.today && "bg-muted",
                x.today && !d && !k && "await border-[1.5px] border-foreground")}>
              {d && <span className={cn("absolute inset-y-0 left-0 bg-signal", k ? "w-1/2" : "w-full")} />}
              {k && <span className={cn("absolute inset-y-0 right-0 bg-code", d ? "w-1/2" : "w-full")} />}
            </button>
          );
        })}
      </div>
      </div>
      <p className="mt-3 min-h-[3em] max-w-[44ch] text-[14px] leading-snug" aria-live="polite">
        <span className="font-semibold">{c?.today ? "Today" : c?.date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.</span>{" "}
        <span className="text-muted-foreground">{c ? said(c) : ""}</span>
      </p>
    </div>
  );
}
