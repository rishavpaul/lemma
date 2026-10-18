"use client";
import { useState } from "react";
import Link from "next/link";
import { Bar, BarChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, PageHeader, Section } from "@/components/shell/page-header";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNum, fmtTok, fmtUsd } from "@/lib/format";
import type { PlanUsage, Usage, UsageRow } from "@/lib/types";

const tick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tip = { contentStyle: { background: "var(--popover)", border: "none", borderRadius: 3, fontSize: 13, color: "var(--foreground)", boxShadow: "0 12px 32px rgb(0 0 0 / .18)" }, cursor: { fill: "var(--muted)" } };
const KIND: Record<string, string> = { research: "Research (per question)", grade_section: "Section grades", grade_session: "Holistic grades", health: "Health checks", code_spec: "Coding: build a problem", code_review: "Coding: staff review", code_hint: "Coding: coach hints" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><div className="fig text-[3.2rem]">{value}</div><div className="mt-2 text-[15px]">{label}</div>{sub && <div className="text-[13px] text-muted-foreground">{sub}</div>}</div>;
}
function Bar2({ label, u, resets }: { label: string; u: number | null; resets: number | null }) {
  const pct = Math.round((u ?? 0) * 100);
  return (
    <div className="min-w-60 flex-1">
      <div className="flex items-baseline justify-between"><span className="text-[15px] font-semibold">{label}</span><span className={cn("fig text-[2.4rem]", pct >= 90 ? "text-coral" : pct >= 70 ? "text-signal" : "")}>{pct}%</span></div>
      <div className="mt-3 h-2.5 bg-muted"><div className={cn("ink-in h-full", pct >= 90 ? "bg-coral" : pct >= 70 ? "bg-signal" : "bg-foreground")} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="mt-1.5 text-[13px] text-muted-foreground">Resets {fmtDate(resets)}</div>
    </div>
  );
}
function UsageTable({ first, rows, label }: { first: string; rows: UsageRow[]; label: (r: never) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto"><table className="booktabs text-[14px]"><thead><tr>{[first, "Calls", "Input", "Cache read", "Output", "Total", "≈ Cost", "Time"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{label(r as never)}</td><td className="num">{fmtNum(r.calls)}</td><td className="num">{fmtTok(r.input_tokens + r.cache_creation_tokens)}</td><td className="num">{fmtTok(r.cache_read_tokens)}</td><td className="num">{fmtTok(r.output_tokens)}</td><td className="num">{fmtTok(r.total_tokens)}</td><td className="num">{fmtUsd(r.cost_usd)}</td><td className="num">{Math.round(r.duration_s)}s</td></tr>)}</tbody></table></div>
  );
}

export default function UsagePage() {
  const u = useApi<Usage>("/api/usage");
  const plan = useApi<PlanUsage>("/api/plan_usage");
  const [busy, setBusy] = useState(false);
  if (!u.data || !plan.data) return <Page><Skeleton className="h-96 w-full" /></Page>;
  const t = u.data.total, L = plan.data.latest;
  return (
    <Page wide>
      <PageHeader title="Usage" subtitle={`Every claude -p call made through your subscription${u.data.tracking_since ? `, tracked since ${fmtDate(u.data.tracking_since)}` : ""}. Cost is API-equivalent value, a relative measure of plan use; you are not billed per token.`} />
      <section className="mb-20">
        <div className="mb-6 flex items-center justify-between"><h2 className="font-serif text-[1.55rem] font-medium tracking-tight">Claude plan limits</h2>
          <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await api("/api/plan_usage/refresh", { method: "POST" }); await plan.reload(); } finally { setBusy(false); } }}><RefreshCw className={cn(busy && "animate-spin")} />Refresh</Button></div>
        {L ? <div className="flex flex-wrap gap-8"><Bar2 label="5-hour window" u={L.five_hour_util} resets={L.five_hour_resets} /><Bar2 label="7-day window" u={L.seven_day_util} resets={L.seven_day_resets} /></div> : <p className="text-sm text-muted-foreground">No plan data yet. It appears after the next Claude call.</p>}
        {plan.data.history.length > 2 && <div className="mt-4"><ResponsiveContainer width="100%" height={160}><LineChart data={plan.data.history.map((x) => ({ t: new Date(x.created_at * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric" }), five: Math.round((x.five_hour_util ?? 0) * 100), seven: Math.round((x.seven_day_util ?? 0) * 100) }))}>
          <XAxis dataKey="t" tick={tick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={60} /><YAxis domain={[0, 100]} tick={tick} axisLine={false} tickLine={false} width={30} /><Tooltip {...tip} />
          <Line dataKey="five" name="5h %" stroke="var(--signal)" dot={false} strokeWidth={2} /><Line dataKey="seven" name="7d %" stroke="var(--chart-3)" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div>}
      </section>
      <div className="mb-20 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Calls" value={fmtNum(t.calls)} sub={t.calls - t.ok_calls ? `${t.calls - t.ok_calls} failed` : "all succeeded"} />
        <Stat label="Total tokens" value={fmtTok(t.total_tokens)} sub={`${fmtTok(t.output_tokens)} output`} />
        <Stat label="≈ API-equivalent cost" value={fmtUsd(t.cost_usd)} />
        <Stat label="Time in Claude" value={`${Math.round(t.duration_s / 60)} min`} sub={`${t.web_searches} searches, ${t.web_fetches} fetches`} />
      </div>
      {u.data.by_day.length > 0 && <section className="mb-20"><h2 className="mb-6 font-serif text-[1.55rem] font-medium tracking-tight">Tokens per day</h2><ResponsiveContainer width="100%" height={260}><BarChart data={u.data.by_day.map((d) => ({ day: d.day, input: d.input_tokens + d.cache_creation_tokens, cache: d.cache_read_tokens, output: d.output_tokens }))}>
        <XAxis dataKey="day" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} width={46} tickFormatter={fmtTok} /><Tooltip {...tip} formatter={(v) => fmtTok(Number(v))} /><Legend wrapperStyle={{ fontSize: 13 }} iconType="square" />
        <Bar dataKey="input" name="Input (new)" stackId="a" fill="var(--chart-1)" /><Bar dataKey="cache" name="Cache read" stackId="a" fill="var(--chart-3)" /><Bar dataKey="output" name="Output" stackId="a" fill="var(--chart-2)" /></BarChart></ResponsiveContainer></section>}
      <Section title="By call type"><UsageTable first="Type" rows={u.data.by_kind} label={(r: { kind: string }) => KIND[r.kind] ?? r.kind} /></Section>
      <Section title="By model"><UsageTable first="Model" rows={u.data.by_model} label={(r: { model: string }) => r.model} /></Section>
      <Section title="By session">{u.data.by_session.length ? <UsageTable first="Session" rows={u.data.by_session} label={(r: { session_id: number; title: string }) => <Link className="hover:underline" href={`/report/?id=${r.session_id}`}>#{r.session_id} {r.title}</Link>} /> : <p className="text-sm text-muted-foreground">No sessions yet.</p>}</Section>
      <Section title="Recent calls"><div className="overflow-x-auto"><table className="booktabs text-[14px]"><thead><tr>{["When", "Type", "Model", "Session", "Result", "In / out", "≈ Cost", "Time"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{u.data.recent.map((c, i) => <tr key={i}><td className="whitespace-nowrap">{fmtDate(c.created_at)}</td><td>{c.kind}</td><td>{c.model}</td><td>{c.session_id ? <Link className="hover:underline" href={`/report/?id=${c.session_id}`}>#{c.session_id}</Link> : c.title ?? "-"}</td><td>{c.ok ? <span className="text-mint">ok</span> : <span className="text-coral">{c.error_kind ?? "failed"}</span>}</td><td className="num">{fmtTok(c.input_tokens + c.cache_creation_tokens)} / {fmtTok(c.output_tokens)}</td><td className="num">{fmtUsd(c.cost_usd)}</td><td className="num">{Math.round(c.duration_s ?? 0)}s</td></tr>)}</tbody></table></div></Section>
    </Page>
  );
}
