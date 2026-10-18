"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, Page, PageHeader, Tomb } from "@/components/shell/page-header";
import { Markdown } from "@/components/markdown";
import { ListenButton } from "@/components/listen-button";
import { mdToSpeech } from "@/lib/speech";
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
    <div className="mt-16">
      <h3 className="mb-4 font-serif text-[1.45rem] font-medium">Ask about this article</h3>
      {turns.map((t, i) => (
        <div key={i} className="mb-4">
          <p className="statement text-[1.1rem]">{t.q}</p>
          <div className="mt-2 rounded-[3px] bg-card p-4"><Markdown>{t.a}</Markdown></div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{t.model}
            <Button size="sm" variant="ghost" onClick={() => onSave(t.q, t.a, t.model)}>Save as comment</Button></div>
        </div>))}
      <textarea className="w-full rounded-[3px] bg-card p-3 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-ring" rows={2} placeholder="Ask a question…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span className="text-muted-foreground">Send with the question (title and summary always go):</span>
        {([["body", "Article text"], ["comments", `Saved comments (${a.comments.length})`], ["history", `Earlier questions here (${turns.length})`]] as const).map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={ctx[k]} onChange={(e) => setCtx({ ...ctx, [k]: e.target.checked })} />{label}</label>))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Ask with</span>
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
          <button key={n} aria-label={`${n} of 5`} className={cn("text-xl leading-none transition-transform hover:scale-125", (rating ?? 0) >= n ? "text-signal" : "text-muted-foreground/40 hover:text-signal/70")} onClick={() => patch({ rating: rating === n ? 0 : n })}>★</button>))}
        <span className="ml-1 text-[13px] text-muted-foreground">{rating ? `${rating} of 5` : "Not rated"}</span>
      </span>
    </div>
  );
}

function Comments({ a, onChange }: { a: Article; onChange: (a: Article) => void }) {
  const [text, setText] = useState("");
  async function run(p: Promise<Article>) { try { onChange(await p); return true; } catch (e) { toast.error((e as Error).message); return false; } }
  return (
    <div className="mt-16">
      <h3 className="mb-4 font-serif text-[1.45rem] font-medium">Notes in the margin <span className="font-sans text-[15px] text-muted-foreground">{a.comments.length}</span></h3>
      {a.comments.map((c) => (
        <div key={c.id} className="mb-4 rounded-[3px] bg-card p-4">
          {c.question && <p className="statement mb-2 text-[1.05rem]">{c.question}</p>}
          <Markdown>{c.body}</Markdown>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{fmtDate(c.created_at)}{c.model && ` · ${c.model}`}
            <Button size="sm" variant="ghost" onClick={() => run(api<Article>(`/api/articles/${a.id}/comments/${c.id}`, { method: "DELETE" }))}>Delete</Button></div>
        </div>))}
      <textarea className="w-full rounded-[3px] bg-card p-3 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-ring" rows={2} placeholder="Add a note. It stays separate from the article text." value={text} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" className="mt-2" disabled={!text.trim()} onClick={async () => { if (await run(api<Article>(`/api/articles/${a.id}/comments`, { method: "POST", body: { body: text } }))) setText(""); }}>Add the note</Button>
    </div>
  );
}

function Reader({ id, reload, onGone, onBack }: { id: number; reload: () => void; onGone: () => void; onBack: () => void }) {
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
    <div className="min-w-0">
      <Button size="sm" variant="ghost" className="-ml-2 mb-2 lg:hidden" onClick={onBack}><ArrowLeft className="size-4" />All articles</Button>
      {edit ? (
        <div className="space-y-2">
          <input className="w-full rounded-[3px] bg-card p-2 text-lg font-semibold" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <input className="w-full rounded-[3px] bg-card p-2 text-sm" placeholder="One-line summary" value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} />
          <textarea className="h-96 w-full rounded-[3px] bg-card p-2 font-mono text-sm" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <div className="flex gap-2"><Button size="sm" onClick={async () => { if (await save(edit)) setEdit(null); }}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEdit(null)}>Cancel</Button></div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="display text-[2.4rem] md:text-[3rem]">{a.title}</h2><p className="mt-4 max-w-[60ch] font-serif text-[1.25rem] italic leading-snug">{a.summary}</p>{a.questions.length > 0 && <p className="mt-3 text-[13px] text-muted-foreground">Studied for {a.questions.map((q) => q.title).join(", ")}.</p>}
              <StateControls id={id} status={a.status} rating={a.rating} onChange={(n) => { setData(n); reload(); }} /></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEdit({ title: a.title, summary: a.summary, body: a.body })}>Edit</Button>
              {confirm ? <Button size="sm" variant="destructive" onClick={remove}>Confirm delete</Button>
                : <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Delete</Button>}
            </div>
          </div>
          <ListenButton id={`article:${id}`} className="mt-8" label="Listen to this article" controls text={`${a.title}. ${a.summary}\n${mdToSpeech(a.body)}`} />
          <div className="mt-10"><Markdown>{a.body}</Markdown></div>
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
  // On a wide screen the reader is never empty: with nothing chosen it shows the first article in the list.
  const open = id ?? groups[0]?.[1][0]?.id ?? null;
  const go = (x: number | null) => router.push(x ? `/articles/?id=${x}` : "/articles/");
  return (
    <Page wide>
      <PageHeader title="Articles" subtitle="Articles on the concepts you have studied, grouped by design problem. Generate more from Progress or any session report." />
      {list.length === 0 ? <Empty title="No articles yet">Press Explain with on a concept in Progress or in a session report, and its article lands here.</Empty> : (
        <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className={cn("min-w-0 space-y-8 lg:sticky lg:top-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:pb-10", id && "hidden lg:block")}>
            <div className="flex flex-wrap items-center gap-2">
              <input className="h-9 w-full rounded-[3px] bg-card px-3 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-ring" placeholder="Search articles" aria-label="Search articles" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
              <select className="h-8 rounded-[3px] bg-card px-2 text-[13px]" aria-label="Design problem" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })}>
                <option value="all">All design problems</option>{problems.map((t) => <option key={t}>{t}</option>)}<option value="General">General</option></select>
              <select className="h-8 rounded-[3px] bg-card px-2 text-[13px]" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="all">Any status</option><option value="pending">Pending</option><option value="read">Read</option></select>
              <select className="h-8 rounded-[3px] bg-card px-2 text-[13px]" aria-label="Rating" value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })}>
                <option value="all">Any rating</option><option value="unrated">Unrated</option>{[5, 4, 3, 2].map((n) => <option key={n} value={n}>{n}+ stars</option>)}</select>
            </div>
            {groups.length === 0 && <p className="text-sm text-muted-foreground">No articles match these filters.</p>}
            {groups.map(([title, nodes]) => (
              <section key={title}>
                <h3 className="mb-1 text-[13px] font-semibold text-signal">{title}</h3>
                <ul>
                  {nodes.map((n) => (
                    <li key={n.id}><button className={cn("-mx-3 block w-[calc(100%+1.5rem)] px-3 py-2 text-left transition-colors hover:bg-card", n.id === open && "bg-card")} onClick={() => go(n.id)}>
                      <span className="font-serif text-[1.1rem] leading-snug">{n.title}</span>{n.status === "read" && <Tomb className="ml-2 text-[0.7rem] text-muted-foreground" />}{n.rating ? <span className="ml-2 text-[12px] text-signal">{"★".repeat(n.rating)}</span> : null}<span className="block truncate text-[13px] text-muted-foreground">{n.summary}</span></button></li>))}
                </ul>
              </section>))}
          </div>
          <article className={cn("min-w-0 max-w-[46rem]", !id && "hidden lg:block")}>{open ? <Reader key={open} id={open} reload={reload} onGone={() => go(null)} onBack={() => go(null)} /> : <p className="font-serif text-[1.3rem] text-muted-foreground">Pick an article from the list.</p>}</article>
        </div>)}
    </Page>
  );
}
