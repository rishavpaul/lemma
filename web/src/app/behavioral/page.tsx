"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, PageHeader, Section, Tomb } from "@/components/shell/page-header";
import { ScoreChip } from "@/components/score-chip";
import { AddToProgram, FocusSelect } from "@/components/programs/add-to-program";
import { StoryDialog } from "@/components/behavioral/story-dialog";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { inProgram, useFocus, usePrograms } from "@/lib/programs";
import type { BStatus, Overview, Story } from "@/lib/behavioral";
import { cn } from "@/lib/utils";

const field = "h-10 rounded-[3px] bg-card px-3 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring";

function Mark({ s }: { s: BStatus }) {
  if (s === "done") return <Tomb className="text-[1.05rem] text-lead" label="Answered and graded" />;
  if (s === "attempted") return <Tomb done={false} className="text-[1.05rem] text-lead" label="Drafted" />;
  return <span role="img" aria-label="Not started" className="inline-block size-[0.62em] bg-muted text-[1.05rem]" />;
}

/** The behavioral bank: stories you reuse, then every question grouped by the competency it tests. */
export default function BehavioralPage() {
  const { data, reload } = useApi<Overview>("/api/behavioral");
  const programs = usePrograms();
  const [focus, setFocus] = useFocus();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Story | "new" | null>(null);
  const focusProgram = programs.data?.find((p) => p.id === focus) ?? null;

  const byId = useMemo(() => new Map((data?.stories ?? []).map((s) => [s.id, s])), [data]);
  const covered = useMemo(() => {
    const out = new Map<number, Set<string>>();
    for (const x of data?.questions ?? []) if (x.story_id) out.set(x.story_id, (out.get(x.story_id) ?? new Set()).add(x.competency));
    return out;
  }, [data]);
  const compName = useMemo(() => new Map((data?.competencies ?? []).map((c) => [c.key, c.name])), [data]);

  if (!data) return <Page><Skeleton className="h-96 w-full" /></Page>;
  const needle = q.trim().toLowerCase();
  const visible = data.questions.filter((x) =>
    (!needle || `${x.title} ${x.prompt}`.toLowerCase().includes(needle)) && (!focusProgram || inProgram(focusProgram, "behavioral", String(x.id))));
  const done = data.questions.filter((x) => x.status === "done").length;
  const compsWithStory = new Set(data.questions.filter((x) => x.story_id).map((x) => x.competency));

  async function removeStory(s: Story) {
    if (!window.confirm(`Delete the story “${s.title}”? Your answers stay; they just lose the link.`)) return;
    try { await api(`/api/behavioral/stories/${s.id}`, { method: "DELETE" }); reload(); } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <Page>
      <PageHeader title="Behavioral" subtitle="Leadership and behavioral rounds, judged at the staff bar. Build a handful of strong stories, map each question to one, answer out loud, and see how a staff hiring committee would read it." />

      <p className="rise -mt-6 mb-12 text-[15px] text-muted-foreground">
        <span className="num text-lead">{done}</span> of {data.questions.length} questions graded. {data.stories.length} {data.stories.length === 1 ? "story" : "stories"},
        covering {compsWithStory.size} of {data.competencies.length} competencies.
      </p>

      <Section title="Your stories" aside={<Button variant="outline" size="sm" onClick={() => setEditing("new")}><Plus />New story</Button>}>
        {data.stories.length === 0 ? (
          <p className="max-w-[62ch] text-[15px] text-muted-foreground">
            Most staff loops can be answered from six to eight well-prepared stories: your biggest project, a hard technical call, a conflict, a failure,
            someone you grew, a time you influenced other teams. Write each one down once, then pick it on every question it fits.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {data.stories.map((s) => (
              <li key={s.id} className="group rounded-[3px] bg-card px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <button type="button" onClick={() => setEditing(s)} className="min-w-0 flex-1 truncate text-left font-serif text-[1.15rem] font-medium hover:underline hover:underline-offset-4">{s.title}</button>
                  <Button variant="ghost" size="xs" className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => removeStory(s)}>Delete</Button>
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {s.question_ids?.length ? `Used for ${s.question_ids.length} question${s.question_ids.length === 1 ? "" : "s"}: ${[...(covered.get(s.id) ?? [])].map((k) => compName.get(k) ?? k).join(", ")}.` : "Not used yet."}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mb-10 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter questions" aria-label="Filter questions" className={field + " min-w-0 flex-1"} />
        <FocusSelect programs={programs.data} value={focusProgram?.id ?? null} onChange={setFocus} className={field} />
      </div>

      {data.competencies.map((c) => {
        const qs = visible.filter((x) => x.competency === c.key);
        if (!qs.length) return null;
        const all = data.questions.filter((x) => x.competency === c.key);
        return (
          <Section key={c.key} title={c.name} aside={<span className="num text-[14px] text-muted-foreground">{all.filter((x) => x.status === "done").length} / {all.length}</span>} className="mb-12">
            <p className="-mt-2 mb-3 max-w-[66ch] text-[14px] leading-relaxed text-muted-foreground">{c.why}</p>
            <ul>
              {qs.map((x) => (
                <li key={x.id} className="flex items-baseline gap-3 rounded-[3px] px-2 py-2 hover:bg-muted">
                  <Mark s={x.status} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/behavioral/question/?id=${x.id}`} className={cn("font-serif text-[1.1rem] hover:underline hover:underline-offset-4", x.status === "done" && "text-muted-foreground")}>{x.title}</Link>
                    {x.story_id && byId.get(x.story_id) && <span className="ml-2 text-[13px] text-muted-foreground">with {byId.get(x.story_id)!.title}</span>}
                  </div>
                  {x.last_score != null && <ScoreChip score={x.last_score} />}
                  <AddToProgram item={{ kind: "behavioral", ref: String(x.id) }} programs={programs.data} reload={programs.reload} />
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
      {visible.length === 0 && <p className="text-[15px] text-muted-foreground">{focusProgram ? "No behavioral questions in this program match." : <>No question matches &ldquo;{q}&rdquo;.</>}</p>}

      {editing && <StoryDialog story={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => reload()} />}
    </Page>
  );
}
