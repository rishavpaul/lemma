"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Page, PageHeader } from "@/components/shell/page-header";
import { Pill, ScoreChip } from "@/components/score-chip";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { ModePicker } from "@/components/mode-picker";
import { modeBody, useStartMode } from "@/lib/start-mode";
import { speech } from "@/lib/speech";
import { useApi } from "@/lib/use-api";
import { dimLabel } from "@/lib/format";
import type { Question } from "@/lib/types";

export default function Library() {
  const router = useRouter();
  const [hints, setHints] = useState(false);
  const startMode = useStartMode();
  const [q, setQ] = useState("");
  const { data, reload } = useApi<Question[]>(`/api/questions?include_hints=${hints}`);
  const [brief, setBrief] = useState<{ title: string; md: string | null; state: string } | null>(null);
  const [title, setTitle] = useState(""), [prompt, setPrompt] = useState(""), [open, setOpen] = useState(false);

  async function start(id: number) {
    speech.unlock();
    try { const s = await api<{ id: number }>("/api/sessions", { method: "POST", body: { question_id: id, ...modeBody(startMode) } }); router.push(`/session/?id=${s.id}`); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function add() {
    try { await api("/api/questions", { method: "POST", body: { title, prompt } }); setTitle(""); setPrompt(""); setOpen(false); reload(); toast.success("Question added"); }
    catch (e) { toast.error((e as Error).message); }
  }
  const list = (data ?? []).filter((x) => (x.title + x.prompt).toLowerCase().includes(q.toLowerCase()));

  return (
    <Page>
      <PageHeader title="Library" subtitle="Every question, with its answer key. Add your own prompts from interviews you have had."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button><Plus />Add question</Button>} />
            <DialogContent>
              <DialogHeader><DialogTitle>Add a custom question</DialogTitle></DialogHeader>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Design a rate limiter" className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring" />
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="The prompt, as an interviewer would say it" rows={5} className="rounded-lg border bg-background p-3 text-sm outline-none focus-visible:border-ring" />
              <Button disabled={!title.trim() || !prompt.trim()} onClick={add}>Add question</Button>
            </DialogContent>
          </Dialog>
        } />
      <ModePicker className="mb-4 max-w-xl" />
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter questions" aria-label="Filter questions" className="h-9 w-full max-w-xs rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={hints} onCheckedChange={setHints} />Show grader hints (spoilers)</label>
      </div>
      {!data ? <Skeleton className="h-96 w-full" /> : (
        <div className="space-y-3">
          {list.map((x) => (
            <article key={x.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <h2 className="font-semibold">{x.title}</h2>
                  <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">{x.prompt}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {x.is_custom ? <Pill>custom</Pill> : null}
                    {x.has_research ? <Pill tone="mint">answer key ready</Pill> : <Pill>no answer key yet</Pill>}
                    <Pill>{x.attempts} attempt{x.attempts === 1 ? "" : "s"}</Pill>
                    {x.last_score != null && <ScoreChip score={x.last_score} />}
                    <span className="text-xs text-muted-foreground">Stresses {x.stresses.map(dimLabel).join(", ")}</span>
                  </div>
                  {hints && x.crux_hints && <p className="mt-3 rounded-md bg-accent/60 p-2 text-sm"><b>Grader hints: </b>{x.crux_hints}</p>}
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button variant="outline" size="sm" onClick={async () => { const r = await api<{ brief_md: string | null; state: string }>(`/api/questions/${x.id}/research`); setBrief({ title: x.title, md: r.brief_md, state: r.state }); }}>Answer key</Button>
                  <Button variant="outline" size="sm" title="Re-run the web research for this question (about 5 minutes)" onClick={async () => { await api(`/api/questions/${x.id}/research/refresh`, { method: "POST" }); toast.success("Research queued"); }}><RefreshCw />Refresh</Button>
                  <Button size="sm" onClick={() => start(x.id)}><Play />Practice</Button>
                </div>
              </div>
            </article>
          ))}
          {list.length === 0 && <p className="text-sm text-muted-foreground">No questions match.</p>}
        </div>
      )}
      <Dialog open={!!brief} onOpenChange={(o) => !o && setBrief(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{brief?.title}</DialogTitle></DialogHeader>
          {brief?.md ? <Markdown>{brief.md}</Markdown> : <p className="text-sm text-muted-foreground">No reference brief yet ({brief?.state}). It is built the first time you practice this question.</p>}
        </DialogContent>
      </Dialog>
      {!data && <Loader2 className="hidden" />}
    </Page>
  );
}
