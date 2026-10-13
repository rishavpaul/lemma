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
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Article, ArticleSummary } from "@/lib/types";

export const EXPLAIN_MODELS = [["sonnet", "Sonnet"], ["opus", "Opus"], ["free", "Free (Nemotron)"]] as const;
export type ExplainModel = (typeof EXPLAIN_MODELS)[number][0];

function AskPanel({ a, onSave }: { a: Article; onSave: (q: string, ans: string, model: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<ExplainModel | null>(null);
  const [turns, setTurns] = useState<{ q: string; a: string; model: string }[]>([]);
  // Title and summary always go; everything else is the user's call.
  const [ctx, setCtx] = useState({ body: false, comments: false, history: true });
  async function ask(m: ExplainModel) {
    if (!q.trim()) return;
    setBusy(m);
    try {
      const r = await api<{ answer: string }>(`/api/articles/${a.id}/ask`, { method: "POST", body: { question: q, model: m, include_body: ctx.body, include_comments: ctx.comments, history: ctx.history ? turns.map(({ q, a }) => ({ q, a })) : [] } });
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
            <Button size="sm" variant="ghost" onClick={() => onSave(t.q, t.a, t.model)}>Save as comment</Button></div>
        </div>))}
      <textarea className="w-full rounded-lg border bg-background p-2 text-sm" rows={2} placeholder="Ask a question..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Send with the question (title and summary always go):</span>
        {([["body", "Article text"], ["comments", `Saved comments (${a.comments.length})`], ["history", `Earlier questions here (${turns.length})`]] as const).map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={ctx[k]} onChange={(e) => setCtx({ ...ctx, [k]: e.target.checked })} />{label}</label>))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Ask with</span>
        {EXPLAIN_MODELS.map(([m, label]) => <Button key={m} size="sm" variant="outline" disabled={busy !== null || !q.trim()} onClick={() => ask(m)}>{busy === m ? "Thinking..." : label}</Button>)}
      </div>
    </div>
  );
}

function StateControls({ id, status, rating, onChange }: { id: number; status: "pending" | "read"; rating: number | null; onChange: (a: Article) => void }) {
  async function patch(body: { status?: string; rating?: number }) {
    try { onChange(await api<Article>(`/api/articles/${id}`, { method: "PATCH", body })); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button size="sm" variant={status === "read" ? "default" : "outline"} onClick={() => patch({ status: status === "read" ? "pending" : "read" })}>{status === "read" ? "Read" : "Mark as read"}</Button>
      <span className="flex items-center gap-1 text-sm" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} aria-label={`${n} of 5`} className={cn("text-lg leading-none", (rating ?? 0) >= n ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500/70")} onClick={() => patch({ rating: rating === n ? 0 : n })}>★</button>))}
        <span className="ml-1 text-xs text-muted-foreground">{rating ? `${rating}/5` : "unrated"}</span>
      </span>
    </div>
  );
}

function Comments({ a, onChange }: { a: Article; onChange: (a: Article) => void }) {
  const [text, setText] = useState("");
  async function run(p: Promise<Article>) { try { onChange(await p); return true; } catch (e) { toast.error((e as Error).message); return false; } }
  return (
    <div className="mt-8 border-t pt-5">
      <h3 className="mb-2 text-sm font-semibold">Comments ({a.comments.length})</h3>
      {a.comments.map((c) => (
        <div key={c.id} className="mb-3 rounded-lg bg-muted/40 p-3 text-sm">
          {c.question && <p className="mb-1 font-medium">{c.question}</p>}
          <Markdown>{c.body}</Markdown>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{fmtDate(c.created_at)}{c.model && ` · ${c.model}`}
            <Button size="sm" variant="ghost" onClick={() => run(api<Article>(`/api/articles/${a.id}/comments/${c.id}`, { method: "DELETE" }))}>Delete</Button></div>
        </div>))}
      <textarea className="w-full rounded-lg border bg-background p-2 text-sm" rows={2} placeholder="Add a note. It stays separate from the article text." value={text} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" className="mt-2" disabled={!text.trim()} onClick={async () => { if (await run(api<Article>(`/api/articles/${a.id}/comments`, { method: "POST", body: { body: text } }))) setText(""); }}>Add comment</Button>
    </div>
  );
}

function Reader({ id, reload, onGone }: { id: number; reload: () => void; onGone: () => void }) {
  const { data: a, setData, error } = useApi<Article>(`/api/articles/${id}`);
  const [edit, setEdit] = useState<{ title: string; summary: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!a || a.id !== id) return <Skeleton className="h-64 w-full" />;
  async function save(next: { title: string; summary: string; body: string }) {
    try { setData(await api<Article>(`/api/articles/${id}`, { method: "PUT", body: next })); reload(); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
  }
  async function remove() {
    try { await api(`/api/articles/${id}`, { method: "DELETE" }); reload(); onGone(); }
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
            <div><h2 className="text-xl font-semibold">{a.title}</h2>{a.questions.length > 0 && <p className="mt-1 text-xs text-muted-foreground">From: {a.questions.map((q) => q.title).join(", ")}</p>}<p className="mt-1 text-sm text-muted-foreground">{a.summary}</p>
              <StateControls id={id} status={a.status} rating={a.rating} onChange={(n) => { setData(n); reload(); }} /></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEdit({ title: a.title, summary: a.summary, body: a.body })}>Edit</Button>
              {confirm ? <Button size="sm" variant="destructive" onClick={remove}>Confirm delete</Button>
                : <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Delete</Button>}
            </div>
          </div>
          <div className="mt-4"><Markdown>{a.body}</Markdown></div>
          <Comments a={a} onChange={setData} />
          <AskPanel a={a} onSave={async (q, ans, m) => {
            try { setData(await api<Article>(`/api/articles/${id}/comments`, { method: "POST", body: { body: ans, question: q, model: m } })); toast.success("Saved as comment"); }
            catch (e) { toast.error((e as Error).message); } }} />
        </>)}
    </div>
  );
}

export function ArticlesView() {
  const router = useRouter();
  const sp = useSearchParams();
  const id = Number(sp.get("id")) || null;
  const { data: list, loading, error, reload } = useApi<ArticleSummary[]>("/api/articles");
  const [f, setF] = useState({ problem: "all", status: "all", rating: "all", text: "" });
  if (loading) return <Page wide><Skeleton className="h-96 w-full" /></Page>;
  if (error || !list) return <Page wide><p className="text-sm text-destructive">{error}</p></Page>;
  const problems = [...new Set(list.flatMap((n) => n.questions.map((q) => q.title)))].sort();
  const needle = f.text.trim().toLowerCase();
  const shown = list.filter((n) =>
    (f.problem === "all" || (f.problem === "General" ? n.questions.length === 0 : n.questions.some((q) => q.title === f.problem))) &&
    (f.status === "all" || n.status === f.status) &&
    (f.rating === "all" || (f.rating === "unrated" ? !n.rating : (n.rating ?? 0) >= Number(f.rating))) &&
    (!needle || `${n.title} ${n.summary}`.toLowerCase().includes(needle)));
  // An article appears under every design problem it was studied for; the rest go under "General".
  const byProblem = new Map<string, ArticleSummary[]>();
  for (const n of shown) for (const q of n.questions.length ? n.questions : [{ id: 0, title: "General" }]) byProblem.set(q.title, [...(byProblem.get(q.title) ?? []), n]);
  const groups = [...byProblem.entries()].sort(([a], [b]) => (a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b)));
  const go = (x: number | null) => router.push(x ? `/articles/?id=${x}` : "/articles/");
  return (
    <Page wide>
      <PageHeader title="Articles" subtitle="Articles on the concepts you have studied, grouped by design problem. Generate more from Progress or any session report." />
      {list.length === 0 ? <Panel><p className="text-sm text-muted-foreground">No articles yet. Click Explain with on a concept in Progress or a session report and its article lands here.</p></Panel> : (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" placeholder="Search articles" aria-label="Search articles" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
              <select className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Design problem" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })}>
                <option value="all">All design problems</option>{problems.map((t) => <option key={t}>{t}</option>)}<option value="General">General</option></select>
              <select className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="all">Any status</option><option value="pending">Pending</option><option value="read">Read</option></select>
              <select className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Rating" value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })}>
                <option value="all">Any rating</option><option value="unrated">Unrated</option>{[5, 4, 3, 2].map((n) => <option key={n} value={n}>{n}+ stars</option>)}</select>
            </div>
            {groups.length === 0 && <p className="text-sm text-muted-foreground">No articles match these filters.</p>}
            {groups.map(([title, nodes]) => (
              <Panel key={title} className="p-0">
                <h3 className="border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
                <ul className="divide-y">
                  {nodes.map((n) => (
                    <li key={n.id}><button className={cn("block w-full px-4 py-2 text-left text-sm hover:bg-accent/40", n.id === id && "bg-accent/60")} onClick={() => go(n.id)}>
                      <b>{n.title}</b>{n.status === "read" && <span className="ml-2 text-xs text-muted-foreground">read</span>}{n.rating ? <span className="ml-2 text-xs text-amber-500">{"★".repeat(n.rating)}</span> : null}<span className="block truncate text-xs text-muted-foreground">{n.summary}</span></button></li>))}
                </ul>
              </Panel>))}
          </div>
          <Panel>{id ? <Reader key={id} id={id} reload={reload} onGone={() => go(null)} /> : <p className="text-sm text-muted-foreground">Pick an article from the graph or the list.</p>}</Panel>
        </div>)}
    </Page>
  );
}
