"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Page, PageHeader, Statement } from "@/components/shell/page-header";
import { ScoreChip } from "@/components/score-chip";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { ModePicker } from "@/components/mode-picker";
import { modeBody, useStartMode } from "@/lib/start-mode";
import { speech } from "@/lib/speech";
import { useApi } from "@/lib/use-api";
import { dimLabel } from "@/lib/format";
import type { Question } from "@/lib/types";

const field = "h-10 rounded-[3px] bg-card px-3 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** Every design question, set as the statement it is, with its answer key one click away. */
export default function Library() {
  const router = useRouter();
  const [hints, setHints] = useState(false);
  const startMode = useStartMode();
  const [q, setQ] = useState("");
  const { data, reload } = useApi<Question[]>(`/api/questions?include_hints=${hints}`);
  const [brief, setBrief] = useState<{ title: string; md: string | null; state: string } | null>(null);
  const [title, setTitle] = useState(""), [prompt, setPrompt] = useState(""), [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<number | null>(null);

  async function start(id: number) {
    speech.unlock();
    setStarting(id);
    try { const s = await api<{ id: number }>("/api/sessions", { method: "POST", body: { question_id: id, ...modeBody(startMode) } }); router.push(`/session/?id=${s.id}`); }
    catch (e) { toast.error((e as Error).message); setStarting(null); }
  }
  async function add() {
    try { await api("/api/questions", { method: "POST", body: { title, prompt } }); setTitle(""); setPrompt(""); setOpen(false); reload(); toast.success("Question added"); }
    catch (e) { toast.error((e as Error).message); }
  }
  const list = (data ?? []).filter((x) => (x.title + x.prompt).toLowerCase().includes(q.toLowerCase()));

  return (
    <Page>
      <PageHeader title="Questions" subtitle="Every design question, with its answer key. Add the prompts you were given in real interviews."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline"><Plus />Add a question</Button>} />
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>Add a question</DialogTitle></DialogHeader>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, such as Design a rate limiter" className={field} />
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="The prompt, as the interviewer said it" rows={5} className={field + " h-auto py-2.5 leading-relaxed"} />
              <Button variant="design" disabled={!title.trim() || !prompt.trim()} onClick={add}>Add question</Button>
            </DialogContent>
          </Dialog>
        } />

      <div className="rise mb-14 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-end" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="space-y-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter questions" aria-label="Filter questions" className={field + " w-full"} />
          <label className="flex items-center gap-2.5 text-[14px] text-muted-foreground"><Switch checked={hints} onCheckedChange={setHints} />Show the grader&apos;s hints (spoilers)</label>
        </div>
        <ModePicker />
      </div>

      {!data ? <Skeleton className="h-96 w-full" /> : (
        <ol className="space-y-14">
          {list.map((x, i) => (
            <li key={x.id} className="rise grid gap-x-10 gap-y-5 md:grid-cols-[minmax(0,1fr)_auto]" style={{ "--i": Math.min(i, 8) + 2 } as React.CSSProperties}>
              <div className="min-w-0">
                <h2 className="font-serif text-[1.75rem] font-medium leading-tight tracking-tight">{x.title}</h2>
                <Statement label={`Lemma ${x.id}`} tone="design" className="mt-2.5 max-w-[66ch] text-[1.1rem]">{x.prompt}</Statement>
                <p className="mt-3 text-[14px] text-muted-foreground">
                  Stresses {x.stresses.map(dimLabel).join(", ")}.{" "}
                  {x.attempts ? `${x.attempts} attempt${x.attempts === 1 ? "" : "s"}.` : "Not attempted."}{" "}
                  {x.has_research ? "Answer key ready." : "The answer key is built on the first attempt."}
                  {x.is_custom ? " Your own question." : ""}
                </p>
                {hints && x.crux_hints && <Statement label="Hint" className="mt-4 max-w-[66ch] bg-card px-4 py-3 text-[1rem]">{x.crux_hints}</Statement>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-col md:items-end md:pt-2">
                {x.last_score != null && <ScoreChip score={x.last_score} className="md:mb-1" />}
                <Button variant="design" disabled={starting !== null} onClick={() => start(x.id)}>{starting === x.id ? <Loader2 className="animate-spin" /> : null}Practice<ArrowRight /></Button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={async () => { const r = await api<{ brief_md: string | null; state: string }>(`/api/questions/${x.id}/research`); setBrief({ title: x.title, md: r.brief_md, state: r.state }); }}>Answer key</Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Rebuild the answer key" title="Re-run the web research for this question (about 5 minutes)" onClick={async () => { await api(`/api/questions/${x.id}/research/refresh`, { method: "POST" }); toast.success("Research queued"); }}><RefreshCw /></Button>
                </div>
              </div>
            </li>
          ))}
          {list.length === 0 && <p className="text-[15px] text-muted-foreground">No question matches &ldquo;{q}&rdquo;.</p>}
        </ol>
      )}

      <Sheet open={!!brief} onOpenChange={(o) => !o && setBrief(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="px-8 pt-8"><SheetTitle>{brief?.title}</SheetTitle><p className="text-[14px] text-muted-foreground">The answer key the grader reads.</p></SheetHeader>
          <div className="px-8 pb-12">{brief?.md ? <Markdown>{brief.md}</Markdown> : <p className="text-[15px] text-muted-foreground">No answer key yet ({brief?.state}). It is built the first time you practice this question.</p>}</div>
        </SheetContent>
      </Sheet>
    </Page>
  );
}
