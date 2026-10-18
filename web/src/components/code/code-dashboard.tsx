"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, CircleDot, History, Loader2, Play, Search, Sparkles, TriangleAlert, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Page, PageHeader, Panel, Section } from "@/components/shell/page-header";
import { Pill, ScoreChip } from "@/components/score-chip";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { dimLabel, fmtAgo, scoreTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CodePhase, CodeProblem, CodeProgress, CodeRoadmap, CodeStatus } from "@/lib/types";

const DIFF: Record<string, string> = { Easy: "text-mint", Medium: "text-signal", Hard: "text-coral", Build: "text-muted-foreground" };
const field = "h-9 rounded-lg border bg-card px-3 text-sm outline-none focus-visible:border-ring";
const href = (slug: string) => `/code/problem/?slug=${slug}`;

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return <Panel><div className="text-sm text-muted-foreground">{label}</div><div className="fig mt-1 text-3xl leading-none">{value}</div>{sub && <div className="num mt-1.5 text-xs text-muted-foreground">{sub}</div>}</Panel>;
}

function Bars({ items, onPick }: { items: { key: string; label: string; done: number; total: number }[]; onPick?: (k: string) => void }) {
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <button key={i.key} type="button" disabled={!onPick} onClick={() => onPick?.(i.key)} className="block w-full text-left">
          <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="truncate">{i.label}</span><span className="num text-xs text-muted-foreground">{i.done}/{i.total}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", i.done === i.total && i.total > 0 ? "bg-mint" : "bg-signal")} style={{ width: `${i.total ? (i.done / i.total) * 100 : 0}%` }} /></div>
        </button>
      ))}
    </div>
  );
}

function StatusIcon({ p }: { p: CodeProblem }) {
  if (p.status === "done") return <CheckCircle2 className={cn("size-[18px]", p.rating === "clean" ? "text-mint" : "text-signal")} aria-label={`Done, ${p.rating}`} />;
  if (p.status === "attempted") return <CircleDot className="size-[18px] text-signal" aria-label="In progress" />;
  return <Circle className="size-[18px] text-muted-foreground/60" aria-label="Not started" />;
}

function SpecPill({ p }: { p: CodeProblem }) {
  if (p.spec === "generating") return <Pill tone="signal"><Loader2 className="size-3 animate-spin" />building tests</Pill>;
  if (p.spec === "ready") return <Pill tone="mint">tests ready</Pill>;
  if (p.spec === "partial") return <Pill tone="signal" className="">tests partial</Pill>;
  if (p.spec === "failed") return <span title={p.spec_error ?? ""}><Pill tone="coral">build failed</Pill></span>;
  return null;
}

function Row({ p, topics }: { p: CodeProblem; topics: Record<string, string> }) {
  return (
    <li className={cn("grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t px-4 py-3 first:border-t-0", p.status === "done" && "bg-muted/20")}>
      <div className="pt-0.5"><StatusIcon p={p} /></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {p.num != null && <span className="num text-xs text-muted-foreground">{p.num}</span>}
          <Link href={href(p.slug)} className={cn("font-medium hover:underline", p.status === "done" && "text-muted-foreground")}>{p.title}</Link>
          <span className={cn("num text-[11px] font-medium", DIFF[p.difficulty])}>{p.difficulty}</span>
          {p.premium && <Pill>premium</Pill>}
          {p.is_build && p.levels != null && <Pill tone={p.level_cleared ? "signal" : "muted"}>{p.level_cleared ?? 0}/{p.levels} levels</Pill>}
          {p.rating && p.status === "done" && <Pill tone={p.rating === "clean" ? "mint" : "signal"}>{p.rating === "clean" ? "clean" : p.rating === "hints" ? "with hints" : "with solution"}</Pill>}
          {p.needs_review && <Pill tone="coral">review</Pill>}
          <SpecPill p={p} />
        </div>
        <p className="mt-1 max-w-[80ch] text-sm text-muted-foreground">{p.note}</p>
        {p.tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{p.tags.map((t) => <span key={t} className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{topics[t] ?? t}</span>)}</div>}
      </div>
    </li>
  );
}

function runText(p: CodeProblem): string {
  if (p.status === "done") return p.rating === "clean" ? "Solved clean" : p.rating === "hints" ? "Solved with hints" : "Solved with the solution";
  const r = p.last_run;
  if (p.last_attempt_status === "in_progress") return r ? (r.status === "compile_error" ? "Did not compile" : `${r.passed}/${r.total} ${r.kind === "submit" ? "tests" : "examples"} passing`) : "Not run yet";
  return "Left unfinished";
}

function RecentPanel({ items }: { items: CodeProblem[] }) {
  return (
    <Panel className="mb-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-signal" />Recently worked on</h2>
      <ul>
        {items.map((x) => {
          const open = x.last_attempt_status === "in_progress" && x.last_attempt_id;
          return (
            <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t py-2 first:border-t-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={open ? `${href(x.slug)}&attempt=${x.last_attempt_id}` : href(x.slug)} className="truncate font-medium hover:underline">{x.title}</Link>
                  <span className={cn("num text-[11px] font-medium", DIFF[x.difficulty])}>{x.difficulty}</span>
                  {x.needs_review && <Pill tone="coral">review</Pill>}
                </div>
                <div className="text-xs text-muted-foreground">{runText(x)}<span className="mx-1.5">·</span>{x.last_worked ? fmtAgo(x.last_worked) : ""}</div>
              </div>
              <Link href={open ? `${href(x.slug)}&attempt=${x.last_attempt_id}` : href(x.slug)}>
                <Button size="sm" variant={open ? "default" : "outline"} tabIndex={-1}>{open ? "Continue" : x.status === "done" ? "Redo" : "Open"}</Button>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Best matches first: exact number, title prefix, title word, then note and topics. */
function searchProblems(all: CodeProblem[], q: string, topics: Record<string, string>): CodeProblem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const score = (p: CodeProblem) => {
    const t = p.title.toLowerCase();
    if (String(p.num) === needle) return 0;
    if (t.startsWith(needle)) return 1;
    if (t.includes(needle)) return 2;
    if (p.tags.some((k) => (topics[k] ?? k).toLowerCase().includes(needle))) return 3;
    if (p.note.toLowerCase().includes(needle)) return 4;
    return 9;
  };
  return all.map((p) => [score(p), p] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].id - b[1].id).map(([, p]) => p);
}

export function CodeDashboard() {
  const road = useApi<CodeRoadmap>("/api/code/roadmap", (r) => (r.stats.generating ? 4000 : false));
  const prog = useApi<CodeProgress>("/api/code/progress", () => 20_000);
  const status = useApi<CodeStatus>("/api/code/status");
  const [q, setQ] = useState(""), [track, setTrack] = useState(""), [st, setSt] = useState(""), [topic, setTopic] = useState(""), [hidePrem, setHidePrem] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {  // "/" jumps to the search box, like most search UIs
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && el && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const all = useMemo(() => (road.data?.phases ?? []).flatMap((ph) => ph.problems), [road.data]);
  const hits = useMemo(() => searchProblems(all, q, road.data?.topics ?? {}), [all, q, road.data]);

  // Build ahead: the next problem in each track gets its tests built in the background, so it is usually ready when you open it.
  const prefetched = useRef(false);
  useEffect(() => {
    if (prefetched.current || !prog.data) return;
    prefetched.current = true;
    const slugs = (["core", "practical"] as const).map((t) => prog.data!.next[t][0]).filter((x) => x && x.spec === "none").map((x) => x.slug);
    if (slugs.length) api("/api/code/generate", { method: "POST", body: { slugs, only_missing: true } }).then(() => road.reload()).catch(() => {});
  }, [prog.data, road]);

  const phases = useMemo(() => {
    if (!road.data) return [];
    const needle = q.toLowerCase();
    const ok = (p: CodeProblem) =>
      (!track || p.track === track) && (!hidePrem || !p.premium) && (!topic || p.tags.includes(topic)) &&
      (!st || (st === "todo" ? p.status === "todo" : st === "done" ? p.status === "done" : p.needs_review)) &&
      (!needle || (p.title + " " + p.note + " " + p.tags.join(" ")).toLowerCase().includes(needle));
    return road.data.phases.map((ph) => ({ ...ph, shown: ph.problems.filter(ok) })).filter((ph) => ph.shown.length);
  }, [road.data, q, track, st, topic, hidePrem]);

  async function prepare(key: string, body: object) {
    setBusy(key);
    try { const r = await api<{ queued: number }>("/api/code/generate", { method: "POST", body }); toast.success(r.queued ? `Building tests for ${r.queued} problem${r.queued === 1 ? "" : "s"}` : "Everything here already has tests"); road.reload(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  }

  const s = road.data?.stats, p = prog.data;
  const clean = s && s.done ? Math.round((s.clean / s.done) * 100) : 0;
  const weekly = p?.weekly ?? [];
  const wmax = Math.max(1, ...weekly);
  const toPrepare = s ? s.total + 5 - s.ready - s.generating : 0;

  return (
    <Page wide>
      <PageHeader title="Code" subtitle="160 problems and 5 multi-level builds. Tests are built by Claude, checked against an independent brute-force solution, and run on real Java here. Then a staff-level review tells you how an interviewer would read your code."
        actions={<Button variant="outline" disabled={busy === "all" || toPrepare <= 0} onClick={() => prepare("all", { only_missing: true })}>{busy === "all" ? <Loader2 className="animate-spin" /> : <Wand2 />}Build all missing tests{toPrepare > 0 ? ` (${toPrepare})` : ""}</Button>} />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); if (e.key === "Enter" && hits[0]) window.location.assign(href(hits[0].slug)); }}
          placeholder="Search all 165 problems by name, number or topic" aria-label="Search problems"
          className="h-11 w-full rounded-xl border bg-card pl-10 pr-20 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" />
        {q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          : <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded border px-1.5 text-xs text-muted-foreground">/</kbd>}
      </div>

      {q.trim() && (
        <Panel className="mb-6 p-0">
          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground"><span>{hits.length} match{hits.length === 1 ? "" : "es"} for &ldquo;{q.trim()}&rdquo;</span><span>Enter opens the first</span></div>
          {hits.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">No problem matches. Try a topic such as &ldquo;heap&rdquo; or a number such as &ldquo;146&rdquo;.</p> : (
            <ul className="max-h-[22rem] overflow-y-auto">
              {hits.slice(0, 12).map((x) => (
                <li key={x.id} className="border-b last:border-0">
                  <Link href={href(x.slug)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <StatusIcon p={x} />
                    <span className="num w-10 shrink-0 text-xs text-muted-foreground">{x.num ?? "build"}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{x.title}</span>
                    <span className={cn("num text-[11px] font-medium", DIFF[x.difficulty])}>{x.difficulty}</span>
                    <SpecPill p={x} />
                  </Link>
                </li>
              ))}
              {hits.length > 12 && <li className="px-4 py-2 text-xs text-muted-foreground">Showing 12 of {hits.length}. The roadmap below is filtered to all of them.</li>}
            </ul>
          )}
        </Panel>
      )}

      {!q.trim() && prog.data && prog.data.recent.length > 0 && <RecentPanel items={prog.data.recent.slice(0, 5)} />}

      {status.data && !status.data.java_ok && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-coral/40 bg-coral/5 p-4 text-sm text-coral"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>{status.data.java_error} Then reopen this page.</span></div>
      )}

      {!s || !p ? <Skeleton className="h-64 w-full" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Problems done" value={<>{s.done}<span className="text-lg text-muted-foreground"> of {s.total}</span></>} sub={`Easy ${s.by_difficulty.Easy.done}/${s.by_difficulty.Easy.total} · Medium ${s.by_difficulty.Medium.done}/${s.by_difficulty.Medium.total}`} />
            <Kpi label="Solved clean" value={<>{clean}<span className="text-lg text-muted-foreground">%</span></>} sub={`${s.clean} without hints or the solution`} />
            <Kpi label="Hard problems" value={<>{s.by_difficulty.Hard.done}<span className="text-lg text-muted-foreground"> of {s.by_difficulty.Hard.total}</span></>} sub="The ones that separate senior from staff" />
            <Kpi label="Build levels" value={<>{s.builds_levels_cleared}<span className="text-lg text-muted-foreground"> of {s.builds_total_levels}</span></>} sub={`${s.ready} of ${s.total + 5} problems have tests`} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel>
              <h2 className="mb-1 text-sm font-semibold">Next up</h2>
              <p className="mb-2 text-xs text-muted-foreground">Alternate between the two tracks. Unfinished problems come first.</p>
              {(["core", "practical"] as const).map((t) => (
                <div key={t} className="mt-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t === "core" ? "Core patterns" : "Practical rounds"}</div>
                  <ul>{p.next[t].map((x) => <li key={x.id} className="flex items-baseline gap-2 border-t py-1.5 first:border-t-0 text-sm"><span className="num w-10 text-xs text-muted-foreground">{x.num}</span><Link className="flex-1 font-medium hover:underline" href={href(x.slug)}>{x.title}</Link><span className={cn("num text-[11px]", DIFF[x.difficulty])}>{x.difficulty}</span></li>)}</ul>
                </div>
              ))}
            </Panel>
            <Panel>
              <h2 className="mb-1 text-sm font-semibold">Needs review</h2>
              <p className="mb-2 text-xs text-muted-foreground">Finished with hints or the solution. Redo these from scratch, without the judge&apos;s help.</p>
              {p.needs_review.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to review yet.</p> : (
                <ul>{p.needs_review.slice(0, 8).map((x) => <li key={x.id} className="flex items-baseline gap-2 border-t py-1.5 first:border-t-0 text-sm"><Link className="flex-1 font-medium hover:underline" href={href(x.slug)}>{x.title}</Link><Pill tone="signal">{x.rating === "solution" ? "solution" : "hints"}</Pill></li>)}</ul>
              )}
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel>
              <h2 className="mb-1 text-sm font-semibold">Staff review scores</h2>
              {p.timeline.length === 0 ? <p className="text-sm text-muted-foreground">Finish a problem and ask for the staff review. Your scores and the average per dimension show up here. Staff is 3.0.</p> : (
                <>
                  <ul className="mb-3">{p.timeline.slice(-5).reverse().map((t) => <li key={t.id} className="flex items-center gap-2 border-t py-1.5 first:border-t-0 text-sm"><Link className="min-w-0 flex-1 truncate hover:underline" href={href(t.slug)}>{t.title}</Link><ScoreChip score={t.score} level={t.level} /></li>)}</ul>
                  <div className="space-y-1.5">{Object.entries(p.dimensions).map(([k, v]) => <div key={k} className="flex items-baseline justify-between text-xs"><span className="capitalize text-muted-foreground">{dimLabel(k)}</span><span className={cn("num font-medium", scoreTone(v))}>{v.toFixed(1)}</span></div>)}</div>
                </>
              )}
            </Panel>
            <Panel>
              <h2 className="mb-1 text-sm font-semibold">Recurring gaps</h2>
              <p className="mb-2 text-xs text-muted-foreground">What the staff reviews keep flagging.</p>
              {p.gaps.length === 0 ? <p className="text-sm text-muted-foreground">No reviews yet.</p> : (
                <ul className="space-y-2">{p.gaps.slice(0, 6).map((g) => <li key={g.tag} className="text-sm"><div className="flex items-baseline justify-between gap-2"><span className="font-medium">{g.tag.replace(/[._]/g, " ")}</span><span className="num text-xs text-muted-foreground">x{g.n}</span></div><p className="text-xs text-muted-foreground">{g.example}</p></li>)}</ul>
              )}
            </Panel>
            <Panel>
              <h2 className="mb-1 text-sm font-semibold">Problems done per week</h2>
              <p className="mb-3 text-xs text-muted-foreground">The last 8 weeks.</p>
              <div className="flex h-28 items-end gap-1.5" role="img" aria-label={`Problems done per week: ${weekly.join(", ")}`}>
                {weekly.map((n, i) => <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1"><span className="num text-[10px] text-muted-foreground">{n || ""}</span><div className="w-full rounded-t bg-signal" style={{ height: `${(n / wmax) * 80}%`, minHeight: n ? 3 : 1, opacity: n ? 1 : 0.25 }} /></div>)}
              </div>
            </Panel>
          </div>

          <Section title="By phase" className="mt-8" aside={<span className="text-xs text-muted-foreground">Tap one to jump to it</span>}>
            <Panel><Bars items={p.phases.map((x) => ({ key: String(x.num), label: `${String(x.num).padStart(2, "0")} ${x.name}`, done: x.done, total: x.total }))} onPick={(k) => document.getElementById(`phase-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} /></Panel>
          </Section>

          <Section title="Topic coverage" aside={topic ? <button className="text-xs text-signal underline underline-offset-4" onClick={() => setTopic("")}>Clear topic</button> : undefined}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
              {p.topics.map((t) => (
                <button key={t.key} aria-pressed={topic === t.key} onClick={() => setTopic(topic === t.key ? "" : t.key)} className={cn("rounded-lg border bg-card px-2.5 py-2 text-left", topic === t.key && "border-signal ring-1 ring-signal")}>
                  <div className="flex justify-between gap-2 text-[13px] font-medium"><span className="truncate">{t.label}</span><span className="num text-xs text-muted-foreground">{t.done}/{t.total}</span></div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full", t.done === t.total ? "bg-mint" : "bg-signal")} style={{ width: `${t.total ? (t.done / t.total) * 100 : 0}%` }} /></div>
                </button>
              ))}
            </div>
          </Section>
        </>
      )}

      <Section title="Roadmap" className="mt-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {q.trim() && <Button size="sm" variant="outline" onClick={() => setQ("")}>Search: &ldquo;{q.trim()}&rdquo;<X /></Button>}
          <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track" className={field}><option value="">Both tracks</option><option value="core">Core patterns</option><option value="practical">Practical rounds</option></select>
          <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status" className={field}><option value="">All statuses</option><option value="todo">Not started</option><option value="done">Done</option><option value="review">Needs review</option></select>
          <Button variant={hidePrem ? "default" : "outline"} size="sm" aria-pressed={hidePrem} onClick={() => setHidePrem((v) => !v)}>Hide premium</Button>
        </div>
        {!road.data ? <Skeleton className="h-96 w-full" /> : (
          <div className="space-y-8">
            {phases.map((ph: CodePhase & { shown: CodeProblem[] }) => {
              const done = ph.problems.filter((x) => x.status === "done").length;
              return (
                <section key={ph.num} id={`phase-${ph.num}`} className="scroll-mt-4">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                    <span className="num text-sm text-signal">{String(ph.num).padStart(2, "0")}</span>
                    <h3 className="text-lg font-semibold">{ph.name}</h3>
                    <span className="num text-sm text-muted-foreground">{done}/{ph.problems.length}</span>
                    <Button size="xs" variant="ghost" className="ml-auto" disabled={busy === `p${ph.num}`} onClick={() => prepare(`p${ph.num}`, { phase: ph.num, only_missing: true })}>{busy === `p${ph.num}` ? <Loader2 className="animate-spin" /> : <Sparkles />}Build tests for this phase</Button>
                  </div>
                  <p className="mb-3 max-w-[72ch] text-sm text-muted-foreground">{ph.why}</p>
                  <ul className="overflow-hidden rounded-xl border bg-card">{ph.shown.map((x) => <Row key={x.id} p={x} topics={road.data!.topics} />)}</ul>
                </section>
              );
            })}
            {phases.length === 0 && <p className="text-sm text-muted-foreground">No problems match.</p>}
          </div>
        )}
        <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground"><Play className="size-3" />Opening a problem builds its tests on demand. Building a whole phase ahead takes about a minute per problem and uses your Claude plan.</p>
      </Section>
    </Page>
  );
}
