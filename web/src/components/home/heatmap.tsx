"use client";
import { cn } from "@/lib/utils";
import { dayKey } from "@/lib/format";

/** 18 weeks of practice, one column per week (Mon-Sun), most recent on the right. */
export function Heatmap({ counts, weeks = 18 }: { counts: Map<string, number>; weeks?: number }) {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const start = new Date(today); start.setDate(start.getDate() - dow - (weeks - 1) * 7);
  const cols: { date: Date; key: string; n: number; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
      const key = dayKey(date.getTime() / 1000);
      col.push({ date, key, n: counts.get(key) ?? 0, future: date > today });
    }
    cols.push(col);
  }
  const todayKey = dayKey(today.getTime() / 1000);
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`Practice over the last ${weeks} weeks`}>
      {cols.map((col, i) => (
        <div key={i} className="flex flex-col gap-[3px]">
          {col.map((c) => (
            <div key={c.key} title={c.future ? "" : `${c.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${c.n} session${c.n === 1 ? "" : "s"}`}
              className={cn("size-[13px] rounded-[3px]", c.future ? "opacity-0" : c.n === 0 ? "bg-muted" : c.n === 1 ? "bg-signal/55" : "bg-signal", c.key === todayKey && "outline outline-1 outline-offset-1 outline-foreground/60")} />
          ))}
        </div>
      ))}
    </div>
  );
}
