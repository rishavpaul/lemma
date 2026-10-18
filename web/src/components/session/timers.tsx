"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { mmss } from "@/lib/format";

function useNow(ms: number) {
  const [now, set] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Countdown for the current section. Counts recording time only; turns amber at 80% and coral when over. */
export function SectionTimer({ getUsedSec, budget }: { getUsedSec: (now: number) => number; budget: number }) {
  const now = useNow(250);
  const used = getUsedSec(now);
  const over = used > budget, warn = used > budget * 0.8;
  return (
    <div>
      <div className={cn("fig text-right text-[3rem]", over ? "text-coral" : warn ? "text-signal" : "text-foreground")} aria-live="off">{mmss(budget - used)}</div>
      <div className="mt-3 h-[3px] bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={Math.min(used, budget)} aria-label="Time used in this part">
        <div className={cn("h-full origin-left transition-transform duration-300", over ? "bg-coral" : warn ? "bg-signal" : "bg-foreground")} style={{ transform: `scaleX(${Math.min(1, used / budget)})` }} />
      </div>
    </div>
  );
}

export function TotalTimer({ getStart }: { getStart: () => number | null }) {
  const now = useNow(1000);
  const s = getStart();
  return <span className="num text-[14px] text-muted-foreground" title="Time since you first pressed record">{s ? mmss((now - s) / 1000) : "00:00"}</span>;
}
