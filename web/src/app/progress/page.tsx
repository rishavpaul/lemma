"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Panel, Section, Empty } from "@/components/shell/page-header";
import { Pill } from "@/components/score-chip";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { dimLabel, fmtDate, fmtDay } from "@/lib/format";
import type { Progress, StudyItem } from "@/lib/types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#15aabf", "#fd7e14", "#82c91e", "#868e96", "#d6336c"];
const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" } };

export default function ProgressPage() {
  const router = useRouter();
  const { data: p } = useApi<Progress>("/api/progress");
  const [items, setItems] = useState<StudyItem[] | null>(null);
  if (!p) return <Page><Skeleton className="h-96 w-full" /></Page>;
  const study = items ?? p.study_items;
  const T = p.timeline.map((t, i) => ({ ...t, label: `#${i + 1} ${fmtDay(t.started_at)}`, ...t.dimensions }));
  const done = study.filter((x) => x.status === "done").length;

  async function setStatus(it: StudyItem, status: string) {
    try { const r = await api<StudyItem>(`/api/study_items/${it.id}`, { method: "PATCH", body: { status } }); setItems(study.map((x) => (x.id === it.id ? r : x))); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <Page wide>
      <PageHeader title="Progress" subtitle="Where you are against the staff bar, and what to work on next." />
      <Panel className="mb-8 flex flex-wrap items-center gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Next session</div>
          <p className="mt-1 text-sm text-muted-foreground">{p.focus.drill ?? "Complete a graded session to get a drill."}</p>
          <p className="mt-2 text-sm">Suggested: <b>{p.focus.suggested.title}</b> <span className="text-muted-foreground">{p.focus.suggested.reason}</span></p>
        </div>
        <Button size="lg" onClick={async () => { const s = await api<{ id: number }>("/api/sessions", { method: "POST", body: { question_id: p.focus.suggested.question_id } }); router.push(`/session/?id=${s.id}`); }}>Start it</Button>
      </Panel>

      {T.length === 0 ? <Empty title="Charts appear after your first graded session">Finish one session and this page fills in with your score trend and the ten dimensions.</Empty> : (
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <Panel><h2 className="mb-3 text-sm font-semibold">Overall score per session</h2>
            <ResponsiveContainer width="100%" height={280}><LineChart data={T} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={tick} stroke="var(--border)" /><YAxis domain={[1, 4]} ticks={[1, 2, 3, 4]} tick={tick} stroke="var(--border)" width={28} />
              <Tooltip {...tip} /><ReferenceLine y={3} stroke="var(--mint)" strokeDasharray="4 4" label={{ value: "staff", fill: "var(--mint)", fontSize: 11, position: "insideTopLeft" }} />
              <Line type="monotone" dataKey="overall_score" name="Overall" stroke="var(--signal)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--signal)" }} /></LineChart></ResponsiveContainer></Panel>
          <Panel><h2 className="mb-3 text-sm font-semibold">Dimensions over time</h2>
            <ResponsiveContainer width="100%" height={280}><LineChart data={T} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={tick} stroke="var(--border)" /><YAxis domain={[1, 4]} ticks={[1, 2, 3, 4]} tick={tick} stroke="var(--border)" width={28} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
              {p.dimensions.map((d, i) => <Line key={d} type="monotone" dataKey={d} name={dimLabel(d)} stroke={COLORS[i % 10]} strokeWidth={1.6} dot={false} connectNulls />)}</LineChart></ResponsiveContainer></Panel>
        </div>
      )}

      {p.time_vs_budget.length > 0 && (
        <Section title="Average time against budget, last 5 sessions"><Panel>
          <ResponsiveContainer width="100%" height={260}><BarChart data={p.time_vs_budget.map((r) => ({ name: r.title, used: Math.round(r.avg_used), budget: Math.round(r.budget) }))} margin={{ right: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="name" tick={tick} stroke="var(--border)" interval={0} angle={-30} textAnchor="end" height={96} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + "…" : v)} /><YAxis tick={tick} stroke="var(--border)" width={40} /><Tooltip {...tip} />
            <Bar dataKey="budget" fill="var(--border)" radius={[4, 4, 0, 0]} /><Bar dataKey="used" fill="var(--signal)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Panel></Section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Recurring gaps">
          {p.gaps.length === 0 ? <Empty title="No gaps recorded yet" /> : (
            <div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">Gap</th><th className="px-2 py-2 font-medium">All</th><th className="px-2 py-2 font-medium">Last 5</th><th className="px-4 py-2 font-medium">Last seen</th></tr></thead>
              <tbody>{p.gaps.map((g) => <tr key={g.tag} className="border-b last:border-0"><td className="px-4 py-2"><Pill>{g.tag}</Pill></td><td className="num px-2 py-2">{g.count}</td><td className="num px-2 py-2">{g.last5}</td><td className="px-4 py-2 text-muted-foreground">{fmtDate(g.last_seen)}</td></tr>)}</tbody></table></div>
          )}
        </Section>
        <Section title={`Study queue (${done}/${study.length} done)`}>
          {study.length === 0 ? <Empty title="Nothing queued">Add concepts from a report&apos;s study plan.</Empty> : (
            <div className="overflow-hidden rounded-xl border">{study.map((it) => (
              <div key={it.id} className="flex items-start gap-3 border-b px-4 py-3 text-sm last:border-0">
                <select value={it.status} onChange={(e) => setStatus(it, e.target.value)} className="h-7 rounded-md border bg-background px-1.5 text-xs" aria-label={`Status of ${it.concept}`}>{["todo", "doing", "done"].map((s) => <option key={s}>{s}</option>)}</select>
                <div className={it.status === "done" ? "opacity-50" : ""}><b>{it.concept}</b><div className="text-muted-foreground">{it.why}</div><div className="text-xs text-muted-foreground">{it.resource}</div></div>
              </div>))}</div>
          )}
        </Section>
      </div>
    </Page>
  );
}
