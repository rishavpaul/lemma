"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, Page, PageHeader, Tomb } from "@/components/shell/page-header";
import { api } from "@/lib/api";
import { modeBody, useStartMode } from "@/lib/start-mode";
import { speech } from "@/lib/speech";
import { setMembership, useFocus, usePrograms, type Program, type ProgramDetailItem } from "@/lib/programs";
import { cn } from "@/lib/utils";

const DIFF: Record<string, string> = { Easy: "text-mint", Medium: "text-signal", Hard: "text-coral", Build: "text-muted-foreground" };
const field = "h-10 rounded-[3px] bg-card px-3 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring";

function Mark({ s, kind }: { s: ProgramDetailItem["status"]; kind: string }) {
  const tone = kind === "code" ? "text-code" : "text-signal";
  if (s === "done") return <Tomb className={cn("text-[1.05rem]", tone)} label="Done" />;
  if (s === "attempted") return <Tomb done={false} className={cn("text-[1.05rem]", tone)} label="In progress" />;
  return <span role="img" aria-label="Not started" className="inline-block size-[0.62em] bg-muted text-[1.05rem]" />;
}

function ProgramCard({ p, focus, onFocus, reload }: { p: Program; focus: boolean; onFocus: () => void; reload: () => void }) {
  const router = useRouter();
  const startMode = useStartMode();
  const [starting, setStarting] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  async function practice(ref: string) {
    speech.unlock();
    setStarting(ref);
    try { const s = await api<{ id: number }>("/api/sessions", { method: "POST", body: { question_id: Number(ref), ...modeBody(startMode) } }); router.push(`/session/?id=${s.id}`); }
    catch (e) { toast.error((e as Error).message); setStarting(null); }
  }
  async function run(fn: () => Promise<unknown>) { try { await fn(); reload(); } catch (e) { toast.error((e as Error).message); } }
  const pct = p.total ? (p.done / p.total) * 100 : 0;

  return (
    <section className="rounded-[3px] bg-card px-5 py-5 md:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="font-serif text-[1.55rem] font-medium leading-tight tracking-tight">{p.name}</h2>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant={focus ? "default" : "outline"} aria-pressed={focus} onClick={onFocus}>{focus ? "Focused" : "Focus on this"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setName(p.name)}>Rename</Button>
          <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Delete “${p.name}”? The problems and your progress stay.`)) void run(() => api(`/api/programs/${p.id}`, { method: "DELETE" })); }}>Delete</Button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span className="h-1.5 flex-1 bg-muted"><span className={cn("block h-full", p.total && p.done === p.total ? "bg-mint" : "bg-code")} style={{ width: `${pct}%` }} /></span>
        <span className="num text-[14px]"><span className={p.done ? "text-code" : "text-muted-foreground"}>{p.done}</span><span className="text-muted-foreground"> / {p.total}</span></span>
      </div>

      {p.items.length === 0 ? <p className="mt-4 text-[15px] text-muted-foreground">Empty. Use the bookmark on a problem on the <Link href="/code/" className="underline underline-offset-4">Code</Link> page or a question on the <Link href="/questions/" className="underline underline-offset-4">Questions</Link> page.</p> : (
        <ul className="mt-4">
          {p.items.map((it) => (
            <li key={`${it.kind}:${it.ref}`} className="group flex items-baseline gap-3 rounded-[3px] px-2 py-2 hover:bg-muted">
              <Mark s={it.status} kind={it.kind} />
              <span className="num w-10 shrink-0 text-[13px] text-muted-foreground">{it.kind === "code" ? it.num ?? "build" : "design"}</span>
              {it.kind === "code"
                ? <Link href={`/code/problem/?slug=${it.ref}&from=programs`} className={cn("min-w-0 flex-1 truncate font-serif text-[1.1rem] hover:underline hover:underline-offset-4", it.status === "done" && "text-muted-foreground")}>{it.title}</Link>
                : <button type="button" disabled={starting !== null} onClick={() => practice(it.ref)} className={cn("min-w-0 flex-1 truncate text-left font-serif text-[1.1rem] hover:underline hover:underline-offset-4", it.status === "done" && "text-muted-foreground")}>{starting === it.ref && <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />}{it.title}</button>}
              {it.difficulty && <span className={cn("text-[13px] font-medium", DIFF[it.difficulty])}>{it.difficulty}</span>}
              <button type="button" aria-label={`Remove ${it.title}`} title="Remove from this program" onClick={() => run(() => setMembership(p.id, it, false))}
                className="p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"><X className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {name !== null && (
        <Dialog open onOpenChange={(o) => { if (!o) setName(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Rename program</DialogTitle></DialogHeader>
            <input value={name} autoFocus aria-label="Program name" onChange={(e) => setName(e.target.value)} className={field}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { void run(() => api(`/api/programs/${p.id}`, { method: "PATCH", body: { name } })); setName(null); } }} />
            <Button disabled={!name.trim()} onClick={() => { void run(() => api(`/api/programs/${p.id}`, { method: "PATCH", body: { name } })); setName(null); }}>Save</Button>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

/** Finite sets of problems and questions you chose, each with its own progress. */
export default function ProgramsPage() {
  const all = usePrograms();
  const [focus, setFocus] = useFocus();
  const [open, setOpen] = useState(false), [name, setName] = useState("");
  const reload = all.reload;

  async function create() {
    try { await api("/api/programs", { method: "POST", body: { name } }); setName(""); setOpen(false); reload(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <Page>
      <PageHeader title="Programs" subtitle="A finite set of coding problems and design questions for one goal, such as a company's practical round. Progress is counted against the set, not all 160."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline"><Plus />New program</Button>} />
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>New program</DialogTitle></DialogHeader>
              <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void create(); }} placeholder="Name it, such as Stripe practical round" aria-label="Program name" className={field} />
              <Button disabled={!name.trim()} onClick={create}>Create</Button>
            </DialogContent>
          </Dialog>
        } />
      {!all.data ? <Skeleton className="h-64 w-full" /> : all.data.length === 0 ? (
        <Empty title="No programs yet">Create one here, or bookmark a problem on the Code page or a question on the Questions page to start one.</Empty>
      ) : (
        <div className="space-y-6">
          {all.data.map((p) => <ProgramCard key={p.id} p={p} focus={focus === p.id} onFocus={() => setFocus(focus === p.id ? null : p.id)} reload={reload} />)}
        </div>
      )}
    </Page>
  );
}
