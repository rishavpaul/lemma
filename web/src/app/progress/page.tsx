"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { ModelPicker, useProviders } from "@/components/model-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Panel, Section, Empty } from "@/components/shell/page-header";
import { Pill } from "@/components/score-chip";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { dimLabel, fmtDate, fmtDay } from "@/lib/format";
import type { ImprovementConcept, ImprovementReport, Progress, StudyItem } from "@/lib/types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#15aabf", "#fd7e14", "#82c91e", "#868e96", "#d6336c"];
const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" } };

export default function ProgressPage() {
  const router = useRouter();
  const { data: p } = useApi<Progress>("/api/progress");
  const [items, setItems] = useState<StudyItem[] | null>(null);
  const [picked, setPicked] = useState<number[] | null>(null);  // null = the last 5 graded sessions
  const [model, setModel] = useState("default");
  const prov = useProviders();
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [explained, setExplained] = useState<Record<string, { model: string; article?: { id: number; title: string; summary: string }; created?: boolean; loading?: boolean }>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const { data: imp, setData: setImp } = useApi<ImprovementReport | null>("/api/improvements/latest",
    (d) => (d && d.status !== "done" && d.job?.status !== "failed" ? 3000 : false));
  if (!p) return <Page><Skeleton className="h-96 w-full" /></Page>;
  const study = items ?? p.study_items;
  const T = p.timeline.map((t, i) => ({ ...t, label: `#${i + 1} ${fmtDay(t.started_at)}`, ...t.dimensions }));
  const done = study.filter((x) => x.status === "done").length;

  async function review(force = false) {
    setBusy(true);
    try { setImp(await api<ImprovementReport>("/api/improvements", { method: "POST", body: { session_ids: chosen, model, force } })); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  async function addToQueue(c: ImprovementConcept) {
    try {
      const r = await api<StudyItem>("/api/study_items", { method: "POST", body: { concept: c.concept, why: c.why, resource: c.study } });
      setItems([r, ...study.filter((x) => x.id !== r.id)]);
      setQueued(new Set(queued).add(c.concept.toLowerCase()));
    } catch (e) { toast.error((e as Error).message); }
  }
  async function explain(c: ImprovementConcept, m: "sonnet" | "opus" | "free") {
    const k = c.concept;
    setExplained((e) => ({ ...e, [k]: { model: m, loading: true } }));
    try {
      const r = await api<{ article: { id: number; title: string; summary: string }; created: boolean }>("/api/articles/explain",
        { method: "POST", body: { concept: c.concept, why: c.why, key_ideas: c.key_ideas, model: m, session_ids: c.sessions.map((n) => imp?.session_ids[n - 1]).filter((x): x is number => typeof x === "number") } });
      setExplained((e) => ({ ...e, [k]: { model: m, article: r.article, created: r.created } }));
    } catch (e) {
      toast.error((e as Error).message);
      setExplained((x) => Object.fromEntries(Object.entries(x).filter(([key]) => key !== k)));
    }
  }
  const recent = [...p.timeline].reverse().slice(0, 15);  // newest first
  const chosen = picked ?? recent.slice(0, 5).map((x) => x.session_id);
  const toggle = (id: number) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const working = !!imp && imp.status !== "done" && imp.job?.status !== "failed";
  const failed = !!imp && imp.status !== "done" && imp.job?.status === "failed";
  const res = imp?.status === "done" ? imp.result : null;

  async function clearQueue() {
    try { await api("/api/study_items", { method: "DELETE" }); setItems([]); setQueued(new Set()); setConfirmClear(false); toast.success("Study queue cleared"); }
    catch (e) { toast.error((e as Error).message); }
  }

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

      <Section title="Concepts to study">
        <Panel>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sessions to analyze</span>
            {[3, 5, 10].map((n) => <Button key={n} size="sm" variant="outline" onClick={() => setPicked(recent.slice(0, n).map((x) => x.session_id))}>Last {n}</Button>)}
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>Clear</Button>
            <span className="ml-auto text-xs text-muted-foreground">{chosen.length} selected</span>
          </div>
          <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border">
            {recent.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No graded sessions yet.</p> : recent.map((s) => (
              <label key={s.session_id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-accent/40">
                <input type="checkbox" checked={chosen.includes(s.session_id)} onChange={() => toggle(s.session_id)} />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(s.started_at)}</span>
                <span className="num w-8 text-right">{s.overall_score.toFixed(1)}</span>
              </label>))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">Model</span>
            <ModelPicker value={model} onChange={setModel} providers={prov.data} allowDefault compact />
            <Button size="sm" disabled={busy || working || chosen.length === 0} onClick={() => review(false)}>{res ? "Analyze again" : "Find concepts to study"}</Button>
            {res && <Button size="sm" variant="outline" disabled={busy || working || chosen.length === 0} onClick={() => review(true)}>Re-run</Button>}
          </div>
          {working && <p className="mt-4 text-sm text-muted-foreground">Reviewing your last {imp!.k} sessions. This takes about a minute.</p>}
          {failed && <p className="mt-4 text-sm text-destructive">The review failed: {imp!.job?.error ?? "unknown error"}</p>}
          {res && (
            <div className="mt-5 space-y-5">
              <p className="text-sm">{res.summary}</p>
              <div className="text-xs text-muted-foreground">Based on {imp!.session_ids.length} session(s) · {imp!.model ?? "default model"} · {fmtDate(imp!.created_at)}</div>
              {res.concepts.map((c, i) => (
                <div key={i} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center gap-2"><span className="num text-sm text-muted-foreground">{i + 1}</span><b className="text-sm">{c.concept}</b><Pill>{c.area}</Pill>
                    <span className="text-xs text-muted-foreground">in {c.sessions.length} of {imp!.session_ids.length} sessions</span>
                    <Button size="sm" variant="outline" className="ml-auto" disabled={queued.has(c.concept.toLowerCase()) || study.some((x) => x.concept.toLowerCase() === c.concept.toLowerCase())} onClick={() => addToQueue(c)}>
                      {queued.has(c.concept.toLowerCase()) || study.some((x) => x.concept.toLowerCase() === c.concept.toLowerCase()) ? "In study queue" : "Add to study queue"}</Button></div>
                  <p className="mt-2 text-sm">{c.why}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{c.key_ideas.map((x, j) => <li key={j}>{x}</li>)}</ul>
                  <p className="mt-2 text-xs text-muted-foreground">Study: {c.study}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Explain with</span>
                    {([["sonnet", "Sonnet"], ["opus", "Opus"], ["free", "Free (Nemotron)"]] as const).map(([m, label]) => (
                      <Button key={m} size="sm" variant="outline" disabled={explained[c.concept]?.loading} onClick={() => explain(c, m)}>{label}</Button>))}
                    {explained[c.concept]?.loading && <span className="text-xs text-muted-foreground">Thinking with {explained[c.concept].model}...</span>}
                  </div>
                  {explained[c.concept]?.article && (
                    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
                      <span className="text-xs text-muted-foreground">{explained[c.concept].created ? "New article written" : "Found in your articles"}: </span>
                      <Link className="font-medium underline underline-offset-4" href={`/articles/?id=${explained[c.concept].article!.id}`}>{explained[c.concept].article!.title}</Link>
                      <p className="mt-1 text-muted-foreground">{explained[c.concept].article!.summary}</p>
                    </div>)}
                </div>))}
            </div>)}
        </Panel>
      </Section>

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
        <Section title={`Study queue (${done}/${study.length} done)`} aside={study.length > 0 && (confirmClear ? (
          <span className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">Remove all {study.length}?</span>
            <Button size="sm" variant="destructive" onClick={clearQueue}>Yes, clear</Button><Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button></span>
        ) : <Button size="sm" variant="outline" onClick={() => setConfirmClear(true)}>Clear queue</Button>)}>
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
