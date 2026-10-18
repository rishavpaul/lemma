"use client";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ConceptsPanel } from "@/components/concepts-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section, Empty, Statement } from "@/components/shell/page-header";
import { Sparkline } from "@/components/home/sparkline";
import { TimeChart } from "@/components/report/charts";
import { api } from "@/lib/api";
import { ModePicker } from "@/components/mode-picker";
import { modeBody, useStartMode } from "@/lib/start-mode";
import { speech } from "@/lib/speech";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { dimLabel, fmtDate, fmtDay, scoreTone } from "@/lib/format";
import type { Progress } from "@/lib/types";

const tick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tip = { contentStyle: { background: "var(--popover)", border: "none", borderRadius: 3, fontSize: 13, color: "var(--foreground)", boxShadow: "0 12px 32px rgb(0 0 0 / .18)" } };

export default function ProgressPage() {
  const router = useRouter();
  const startMode = useStartMode();
  const { data: p } = useApi<Progress>("/api/progress");
  if (!p) return <Page><Skeleton className="h-96 w-full" /></Page>;
  const T = p.timeline.map((t, i) => ({ ...t, label: `${fmtDay(t.started_at)}`, n: i + 1, ...t.dimensions }));
  const recent = [...p.timeline].reverse().slice(0, 15);  // newest first
  const latest = p.timeline[p.timeline.length - 1];

  return (
    <Page wide>
      <PageHeader title="Progress" subtitle="Where you stand against the staff bar, and what to work on next." />

      <section className="rise mb-20 grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" style={{ "--i": 1 } as React.CSSProperties}>
        <div>
          <Statement label="Remark" className="text-[1.5rem] leading-snug">{p.focus.drill ?? "Complete a graded session and the referee leaves a drill here."}</Statement>
          <p className="mt-6 text-[15px]"><span className="text-muted-foreground">Next: </span><b className="font-serif text-[1.15rem] font-semibold">{p.focus.suggested.title}</b>. <span className="text-muted-foreground">{p.focus.suggested.reason}</span></p>
        </div>
        <div>
          <ModePicker />
          <Button variant="design" size="lg" className="mt-4 h-12 px-6 text-base" onClick={async () => { speech.unlock(); const s = await api<{ id: number }>("/api/sessions", { method: "POST", body: { question_id: p.focus.suggested.question_id, ...modeBody(startMode) } }); router.push(`/session/?id=${s.id}`); }}>Begin it<ArrowRight /></Button>
        </div>
      </section>

      {T.length === 0 ? <Empty title="The charts start after your first graded session">Finish one session and this page fills in with your score over time and each of the ten dimensions.</Empty> : (
        <>
          <Section title="Overall, session by session">
            <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={T} margin={{ left: 0, right: 16, top: 12, bottom: 0 }}>
                  <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                  <YAxis domain={[1, 4]} ticks={[1, 2, 3, 4]} tick={tick} axisLine={false} tickLine={false} width={24} />
                  <Tooltip {...tip} cursor={{ stroke: "var(--border)" }} />
                  <ReferenceLine y={3} stroke="var(--mint)" strokeWidth={2} strokeOpacity={0.55} label={{ value: "staff", fill: "var(--mint)", fontSize: 12, position: "insideTopLeft" }} />
                  <Line type="linear" dataKey="overall_score" name="Overall" stroke="var(--signal)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--signal)", strokeWidth: 0 }} activeDot={{ r: 6 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div>
                <div className={cn("fig text-[5rem]", scoreTone(latest.overall_score))}>{latest.overall_score.toFixed(1)}</div>
                <p className="mt-2 text-[15px] text-muted-foreground">in the latest of {T.length} graded {T.length === 1 ? "session" : "sessions"}. Staff is 3.0.</p>
              </div>
            </div>
          </Section>

          <Section title="Ten dimensions">
            <div className="grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
              {p.dimensions.map((d, i) => {
                const vals = T.map((t) => (t as unknown as Record<string, number | undefined>)[d]).filter((v): v is number => typeof v === "number");
                const last = vals[vals.length - 1];
                return (
                  <div key={d} className="rise" style={{ "--i": i } as React.CSSProperties}>
                    <div className="text-[14px] first-letter:uppercase">{dimLabel(d)}</div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <span className={cn("fig text-[2.2rem]", last != null ? scoreTone(last) : "text-muted-foreground")}>{last != null ? last.toFixed(1) : "–"}</span>
                      <Sparkline values={vals} w={110} h={36} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}

      {p.time_vs_budget.length > 0 && (
        <Section title="Time against budget, last five sessions">
          <div className="max-w-3xl"><TimeChart rows={p.time_vs_budget.map((r) => ({ name: r.title, used: Math.round(r.avg_used), budget: Math.round(r.budget) }))} /></div>
        </Section>
      )}

      <Section title="Recurring gaps">
        {p.gaps.length === 0 ? <p className="text-[15px] text-muted-foreground">No gaps recorded yet.</p> : (
          <div className="max-w-4xl overflow-x-auto">
            <table className="booktabs text-[15px]">
              <thead><tr><th>Gap</th><th className="text-right">All sessions</th><th className="text-right">Last five</th><th className="text-right">Last seen</th></tr></thead>
              <tbody>{p.gaps.map((g) => <tr key={g.tag}><td>{g.tag.replace(/[._]/g, " ")}</td><td className="num text-right">{g.count}</td><td className={cn("num text-right", g.last5 >= 2 && "font-semibold text-coral")}>{g.last5}</td><td className="text-right text-[14px] text-muted-foreground">{fmtDate(g.last_seen)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Concepts to study"><ConceptsPanel recent={recent} /></Section>
    </Page>
  );
}
