"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ModelPicker, useProviders } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/shell/page-header";
import { Pill } from "@/components/score-chip";
import { EXPLAIN_MODELS, type ExplainModel } from "@/components/articles/articles-view";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { fmtDate } from "@/lib/format";
import type { ImprovementConcept, ImprovementReport } from "@/lib/types";

export interface PickableSession { session_id: number; title: string; started_at: number; overall_score: number }
type Explained = { model: string; article?: { id: number; title: string; summary: string }; created?: boolean; loading?: boolean };

/** Find concepts to study across graded sessions and turn them into articles. Progress picks sessions; a report fixes one. */
export function ConceptsPanel({ recent, fixedSession }: { recent?: PickableSession[]; fixedSession?: number }) {
  const prov = useProviders();
  const [picked, setPicked] = useState<number[] | null>(null);  // null = the last 5 graded sessions
  const [model, setModel] = useState("default");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [explained, setExplained] = useState<Record<string, Explained>>({});
  const { data: imp, setData: setImp } = useApi<ImprovementReport | null>(
    `/api/improvements/latest${fixedSession ? `?session_id=${fixedSession}` : ""}`,
    (d) => (d && d.status !== "done" && d.job?.status !== "failed" ? 3000 : false));
  const chosen = fixedSession ? [fixedSession] : picked ?? (recent ?? []).slice(0, 5).map((x) => x.session_id);
  const toggle = (id: number) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const working = !!imp && imp.status !== "done" && imp.job?.status !== "failed";
  const failed = !!imp && imp.status !== "done" && imp.job?.status === "failed";
  const res = imp?.status === "done" ? imp.result : null;

  async function review(force = false) {
    setBusy(true);
    try { setImp(await api<ImprovementReport>("/api/improvements", { method: "POST", body: { session_ids: chosen, model, force } })); setExplained({}); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }
  async function clear() {
    if (!imp) return;
    try { await api(`/api/improvements/${imp.id}`, { method: "DELETE" }); setImp(null); setExplained({}); setConfirmClear(false); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function explain(c: ImprovementConcept, m: ExplainModel) {
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

  return (
    <Panel>
      {!fixedSession && (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sessions to analyze</span>
            {[3, 5, 10].map((n) => <Button key={n} size="sm" variant="outline" onClick={() => setPicked((recent ?? []).slice(0, n).map((x) => x.session_id))}>Last {n}</Button>)}
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>Clear</Button>
            <span className="ml-auto text-xs text-muted-foreground">{chosen.length} selected</span>
          </div>
          <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border">
            {!recent?.length ? <p className="p-3 text-sm text-muted-foreground">No graded sessions yet.</p> : recent.map((s) => (
              <label key={s.session_id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-accent/40">
                <input type="checkbox" checked={chosen.includes(s.session_id)} onChange={() => toggle(s.session_id)} />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(s.started_at)}</span>
                <span className="num w-8 text-right">{s.overall_score.toFixed(1)}</span>
              </label>))}
          </div>
        </>)}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Model</span>
        <ModelPicker value={model} onChange={setModel} providers={prov.data} allowDefault compact />
        <Button size="sm" disabled={busy || working || chosen.length === 0} onClick={() => review(false)}>{res ? "Analyze again" : "Find concepts to study"}</Button>
        {res && <Button size="sm" variant="outline" disabled={busy || working || chosen.length === 0} onClick={() => review(true)}>Re-run</Button>}
        {imp && !working && (confirmClear ? (
          <span className="ml-auto flex items-center gap-2 text-xs"><span className="text-muted-foreground">Remove these results?</span>
            <Button size="sm" variant="destructive" onClick={clear}>Yes, clear</Button><Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button></span>
        ) : <Button size="sm" variant="outline" className="ml-auto" onClick={() => setConfirmClear(true)}>Clear results</Button>)}
      </div>
      {working && <p className="mt-4 text-sm text-muted-foreground">Reviewing {imp!.k} session{imp!.k === 1 ? "" : "s"}. This takes about a minute.</p>}
      {failed && <p className="mt-4 text-sm text-destructive">The review failed: {imp!.job?.error ?? "unknown error"}</p>}
      {res && (
        <div className="mt-5 space-y-5">
          <p className="text-sm">{res.summary}</p>
          <div className="text-xs text-muted-foreground">Based on {imp!.session_ids.length} session(s) · {imp!.model ?? "default model"} · {fmtDate(imp!.created_at)}</div>
          {res.concepts.map((c, i) => (
            <div key={i} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="num text-sm text-muted-foreground">{i + 1}</span><b className="text-sm">{c.concept}</b><Pill>{c.area}</Pill>
                <span className="text-xs text-muted-foreground">in {c.sessions.length} of {imp!.session_ids.length} sessions</span></div>
              <p className="mt-2 text-sm">{c.why}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{c.key_ideas.map((x, j) => <li key={j}>{x}</li>)}</ul>
              <p className="mt-2 text-xs text-muted-foreground">Study: {c.study}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Explain with</span>
                {EXPLAIN_MODELS.map(([m, label]) => (
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
  );
}
