"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, PageHeader, Panel } from "@/components/shell/page-header";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { KgArticle, KgGraph } from "@/lib/types";

export const EXPLAIN_MODELS = [["sonnet", "Sonnet"], ["opus", "Opus"], ["free", "Free (Nemotron)"]] as const;
export type ExplainModel = (typeof EXPLAIN_MODELS)[number][0];

function AskPanel({ a, onAppend }: { a: KgArticle; onAppend: (q: string, ans: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<ExplainModel | null>(null);
  const [turns, setTurns] = useState<{ q: string; a: string; model: string }[]>([]);
  async function ask(m: ExplainModel) {
    if (!q.trim()) return;
    setBusy(m);
    try {
      const r = await api<{ answer: string }>(`/api/kg/articles/${a.id}/ask`, { method: "POST", body: { question: q, model: m } });
      setTurns((t) => [...t, { q, a: r.answer, model: m }]);
      setQ("");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  }
  return (
    <div className="mt-8 border-t pt-5">
      <h3 className="mb-2 text-sm font-semibold">Ask about this article</h3>
      {turns.map((t, i) => (
        <div key={i} className="mb-4">
          <p className="text-sm font-medium">{t.q}</p>
          <div className="mt-1 rounded-lg bg-muted/40 p-3 text-sm"><Markdown>{t.a}</Markdown></div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{t.model}
            <Button size="sm" variant="ghost" onClick={() => onAppend(t.q, t.a)}>Add to article</Button></div>
        </div>))}
      <textarea className="w-full rounded-lg border bg-background p-2 text-sm" rows={2} placeholder="Ask a question..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Ask with</span>
        {EXPLAIN_MODELS.map(([m, label]) => <Button key={m} size="sm" variant="outline" disabled={busy !== null || !q.trim()} onClick={() => ask(m)}>{busy === m ? "Thinking..." : label}</Button>)}
      </div>
    </div>
  );
}

function Reader({ id, titles, reload, onGone }: { id: number; titles: Map<number, string>; reload: () => void; onGone: () => void }) {
  const router = useRouter();
  const { data: a, setData, error } = useApi<KgArticle>(`/api/kg/articles/${id}`);
  const [edit, setEdit] = useState<{ title: string; summary: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!a || a.id !== id) return <Skeleton className="h-64 w-full" />;
  async function save(next: { title: string; summary: string; body: string }) {
    try { setData(await api<KgArticle>(`/api/kg/articles/${id}`, { method: "PUT", body: next })); reload(); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
  }
  async function remove() {
    try { await api(`/api/kg/articles/${id}`, { method: "DELETE" }); reload(); onGone(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div>
      {edit ? (
        <div className="space-y-2">
          <input className="w-full rounded-lg border bg-background p-2 text-lg font-semibold" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <input className="w-full rounded-lg border bg-background p-2 text-sm" placeholder="One-line summary" value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} />
          <textarea className="h-96 w-full rounded-lg border bg-background p-2 font-mono text-sm" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <div className="flex gap-2"><Button size="sm" onClick={async () => { if (await save(edit)) setEdit(null); }}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEdit(null)}>Cancel</Button></div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-semibold">{a.title}</h2>{a.questions.length > 0 && <p className="mt-1 text-xs text-muted-foreground">From: {a.questions.map((q) => q.title).join(", ")}</p>}<p className="mt-1 text-sm text-muted-foreground">{a.summary}</p></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEdit({ title: a.title, summary: a.summary, body: a.body })}>Edit</Button>
              {confirm ? <Button size="sm" variant="destructive" onClick={remove}>Confirm delete</Button>
                : <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Delete</Button>}
            </div>
          </div>
          {a.links.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs">Related: {a.links.map((l) => (
            <button key={l} className="rounded-full border px-2 py-0.5 hover:bg-accent" onClick={() => router.push(`/knowledge/?id=${l}`)}>{titles.get(l) ?? l}</button>))}</div>}
          <div className="mt-4"><Markdown>{a.body}</Markdown></div>
          <AskPanel a={a} onAppend={async (q, ans) => { if (await save({ title: a.title, summary: a.summary, body: `${a.body}\n\n## Q: ${q}\n\n${ans}` })) toast.success("Added to article"); }} />
        </>)}
    </div>
  );
}

export function KnowledgeView() {
  const router = useRouter();
  const sp = useSearchParams();
  const id = Number(sp.get("id")) || null;
  const { data: g, loading, error, reload } = useApi<KgGraph>("/api/kg");
  if (loading) return <Page wide><Skeleton className="h-96 w-full" /></Page>;
  if (error || !g) return <Page wide><p className="text-sm text-destructive">{error}</p></Page>;
  const titles = new Map(g.nodes.map((n) => [n.id, n.title]));
  // An article appears under every design problem it was studied for; the rest go under "General".
  const byProblem = new Map<string, KgGraph["nodes"]>();
  for (const n of g.nodes) for (const q of n.questions.length ? n.questions : [{ id: 0, title: "General" }]) byProblem.set(q.title, [...(byProblem.get(q.title) ?? []), n]);
  const groups = [...byProblem.entries()].sort(([a], [b]) => (a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b)));
  const go = (x: number | null) => router.push(x ? `/knowledge/?id=${x}` : "/knowledge/");
  return (
    <Page wide>
      <PageHeader title="Knowledge" subtitle="Articles on the concepts you have studied, grouped by design problem. Use Explain with on the Progress page to add more." />
      {g.nodes.length === 0 ? <Panel><p className="text-sm text-muted-foreground">Nothing here yet. Click Explain with on a concept in Progress and its article lands here.</p></Panel> : (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            {groups.map(([title, nodes]) => (
              <Panel key={title} className="p-0">
                <h3 className="border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
                <ul className="divide-y">
                  {nodes.map((n) => (
                    <li key={n.id}><button className={cn("block w-full px-4 py-2 text-left text-sm hover:bg-accent/40", n.id === id && "bg-accent/60")} onClick={() => go(n.id)}>
                      <b>{n.title}</b><span className="block truncate text-xs text-muted-foreground">{n.summary}</span></button></li>))}
                </ul>
              </Panel>))}
          </div>
          <Panel>{id ? <Reader key={id} id={id} titles={titles} reload={reload} onGone={() => go(null)} /> : <p className="text-sm text-muted-foreground">Pick an article from the graph or the list.</p>}</Panel>
        </div>)}
    </Page>
  );
}
