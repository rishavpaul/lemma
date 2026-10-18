"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Loader2, Search, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, PageHeader, Section, Tomb } from "@/components/shell/page-header";
import { Pill, ScoreChip } from "@/components/score-chip";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { dimLabel, fmtAgo, scoreTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CodePhase, CodeProblem, CodeProgress, CodeRoadmap, CodeStatus } from "@/lib/types";

const DIFF: Record<string, string> = { Easy: "text-mint", Medium: "text-signal", Hard: "text-coral", Build: "text-muted-foreground" };
const TRACK = { core: "Core patterns", practical: "Practical rounds" } as const;
const field = "h-9 rounded-[3px] bg-card px-3 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-ring";
const href = (slug: string) => `/code/problem/?slug=${slug}`;
const OPEN_KEY = "lemma.code.openChapters";

/** A headline figure with what it counts, small enough to sit four in a line. */
function Figure({ value, of, label, tone }: { value: React.ReactNode; of?: React.ReactNode; label: string; tone?: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-1"><span className={cn("fig text-[2.4rem]", tone)}>{value}</span>{of && <span className="text-[14px] text-muted-foreground">{of}</span>}</div>
      <div className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{label}</div>
    </div>
  );
}

/** The problem's mark: filled when solved (green if clean, ochre with help), hollow while open, a tone step before. */
function StatusIcon({ p }: { p: CodeProblem }) {
  if (p.status === "done") return <Tomb className={cn("text-[1.05rem]", p.rating === "clean" ? "text-mint" : "text-signal")} label={`Solved, ${p.rating}`} />;
  if (p.status === "attempted") return <Tomb done={false} className="text-[1.05rem] text-code" label="In progress" />;
  return <span role="img" aria-label="Not started" className="inline-block size-[0.62em] bg-muted text-[1.05rem]" />;
}

function SpecPill({ p }: { p: CodeProblem }) {
  if (p.spec === "generating") return <Pill tone="code"><Loader2 className="size-3 animate-spin" />building tests</Pill>;
  if (p.spec === "partial") return <Pill tone="signal">tests partial</Pill>;
  if (p.spec === "failed") return <span title={p.spec_error ?? ""}><Pill tone="coral">build failed</Pill></span>;
  return null;
}

/** One problem on one line. The note and topics are there to scan on wide screens, in full on hover. */
function Row({ p, topics }: { p: CodeProblem; topics: Record<string, string> }) {
  const tags = p.tags.map((t) => topics[t] ?? t).join(", ");
  const detail = [p.note, tags && `Topics: ${tags}.`].filter(Boolean).join(" ");
  return (
    <li>
      <Link href={href(p.slug)} title={detail}
        className="group grid grid-cols-[1.1rem_2.4rem_minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-[3px] px-3 py-2 transition-colors hover:bg-muted lg:grid-cols-[1.1rem_2.4rem_minmax(0,19rem)_minmax(0,1fr)_auto]">
        <StatusIcon p={p} />
        <span className="num text-[13px] text-muted-foreground">{p.num ?? "build"}</span>
        <span className={cn("truncate font-serif text-[1.1rem] group-hover:underline group-hover:underline-offset-4", p.status === "done" && "text-muted-foreground")}>{p.title}</span>
        <span className="hidden truncate text-[13px] text-muted-foreground lg:block">{p.note}</span>
        <span className="flex items-baseline justify-end gap-2">
          {p.premium && <Pill>premium</Pill>}
          {p.is_build && p.levels != null && <Pill tone={p.level_cleared ? "code" : "muted"}>{p.level_cleared ?? 0} of {p.levels} levels</Pill>}
          {p.rating && p.status === "done" && p.rating !== "clean" && <Pill tone="signal">{p.rating === "hints" ? "hints" : "solution"}</Pill>}
          {p.needs_review && <Pill tone="coral">redo</Pill>}
          <SpecPill p={p} />
          <span className={cn("w-14 text-right text-[13px] font-medium", DIFF[p.difficulty])}>{p.difficulty}</span>
        </span>
      </Link>
    </li>
  );
}

/** A chapter folds to one line: name, what comes next in it, and how far along it is. Open, it lists every problem. */
function Chapter({ ph, shown, open, onToggle, topics, filtered, busy, onBuild }: {
  ph: CodePhase; shown: CodeProblem[]; open: boolean; onToggle: () => void; topics: Record<string, string>; filtered: boolean; busy: boolean; onBuild: () => void;
}) {
  const done = ph.problems.filter((x) => x.status === "done").length;
  const total = ph.problems.length;
  const next = ph.problems.find((x) => x.status === "attempted") ?? ph.problems.find((x) => x.status === "todo");
  const sub = filtered ? `${shown.length} of ${total} match` : done === total ? "Every problem solved" : next ? `Next: ${next.title}` : "";
  return (
    <section id={`phase-${ph.num}`} className={cn("scroll-mt-6 rounded-[3px] transition-colors", open ? "bg-card" : "hover:bg-card")}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3.5 text-left md:grid-cols-[1rem_minmax(0,1fr)_9rem_4.5rem]">
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0">
          <span className="block truncate font-serif text-[1.3rem] leading-tight">{ph.name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{sub}</span>
        </span>
        <span className="hidden h-1.5 bg-muted md:block"><span className={cn("block h-full", done === total ? "bg-mint" : "bg-code")} style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
        <span className="num text-right text-[14px]"><span className={done ? "text-code" : "text-muted-foreground"}>{done}</span><span className="text-muted-foreground"> / {total}</span></span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pl-8">
            <p className="max-w-[75ch] text-[14px] leading-relaxed text-muted-foreground">{ph.why}</p>
            <Button size="xs" variant="ghost" disabled={busy} onClick={onBuild}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}Build this chapter&apos;s tests</Button>
          </div>
          <ul className="pl-5">{shown.map((x) => <Row key={x.id} p={x} topics={topics} />)}</ul>
        </div>
      )}
    </section>
  );
}

function runText(p: CodeProblem): string {
  if (p.status === "done") return p.rating === "clean" ? "Solved clean" : p.rating === "hints" ? "Solved with hints" : "Solved with the solution";
  const r = p.last_run;
  if (p.last_attempt_status === "in_progress") return r ? (r.status === "compile_error" ? "Did not compile" : `${r.passed} of ${r.total} ${r.kind === "submit" ? "tests" : "examples"} passing`) : "Not run yet";
  return "Left unfinished";
}

/** The top of the page: what to do now. Recent work on the left, the next problem per track and the redo pile on the right. */
function PickUp({ p, onRedo }: { p: CodeProgress; onRedo: () => void }) {
  const recent = p.recent.slice(0, 3);
  return (
    <div className="mb-14 grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section>
        <h2 className="mb-2 font-serif text-[1.35rem] font-medium tracking-tight">Where you left off</h2>
        {recent.length === 0 ? <p className="py-2 text-[15px] text-muted-foreground">Nothing yet. Start with the first problem on the right.</p> : (
          <ul>
            {recent.map((x) => {
              const open = x.last_attempt_status === "in_progress" && x.last_attempt_id;
              const to = open ? `${href(x.slug)}&attempt=${x.last_attempt_id}` : href(x.slug);
              return (
                <li key={x.id}>
                  <Link href={to} className="group -mx-3 grid grid-cols-[1.1rem_minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-[3px] px-3 py-2.5 transition-colors hover:bg-card">
                    <StatusIcon p={x} />
                    <span className="min-w-0">
                      <span className="block truncate font-serif text-[1.15rem]">{x.title}</span>
                      <span className="block text-[13px] text-muted-foreground">{runText(x)}{x.last_worked ? `, ${fmtAgo(x.last_worked)}` : ""}</span>
                    </span>
                    <span className={cn("text-[14px] font-medium", open ? "text-code" : "text-muted-foreground")}>{open ? "Continue" : x.status === "done" ? "Redo" : "Open"} →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-serif text-[1.35rem] font-medium tracking-tight">Next up</h2>
        <ul>
          {(["core", "practical"] as const).map((t) => {
            const x = p.next[t][0];
            if (!x) return null;
            return (
              <li key={t}>
                <Link href={href(x.slug)} className="group -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-[3px] px-3 py-2.5 transition-colors hover:bg-card">
                  <span className="min-w-0">
                    <span className="block truncate font-serif text-[1.15rem]"><span className="num mr-2 font-sans text-[13px] text-muted-foreground">{x.num}</span>{x.title}</span>
                    <span className="block text-[13px] text-muted-foreground">{TRACK[t]}, <span className={DIFF[x.difficulty]}>{x.difficulty.toLowerCase()}</span></span>
                  </span>
                  <span className="text-[14px] font-medium text-code">{x.status === "attempted" ? "Continue" : "Start"} →</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {p.needs_review.length > 0 && (
          <button type="button" onClick={onRedo} className="mt-2 text-[14px] text-muted-foreground hover:text-foreground">
            <span className="font-medium text-signal">{p.needs_review.length} to redo</span> from a blank file, without help. <span className="underline underline-offset-4">Show them</span>
          </button>
        )}
      </section>
    </div>
  );
}

/** Reviews, gaps, pace and topic coverage: the reflective view, kept off the practice page. */
function ProgressView({ p, onTopic }: { p: CodeProgress; onTopic: (k: string) => void }) {
  const weekly = p.weekly ?? [];
  const wmax = Math.max(1, ...weekly);
  return (
    <>
      <div className="mb-16 grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-3">
        <section>
          <h2 className="mb-4 font-serif text-[1.55rem] font-medium tracking-tight">Staff reviews</h2>
          {p.timeline.length === 0 ? <p className="text-[15px] leading-relaxed text-muted-foreground">Solve a problem and ask for the staff review. Your scores and the average per dimension show up here. Staff is 3.0.</p> : (
            <>
              <ul className="mb-5">{p.timeline.slice(-5).reverse().map((t) => <li key={t.id} className="flex items-baseline gap-3 py-1"><Link className="min-w-0 flex-1 truncate text-[15px] hover:underline hover:underline-offset-4" href={href(t.slug)}>{t.title}</Link><ScoreChip score={t.score} /></li>)}</ul>
              <div className="space-y-1">{Object.entries(p.dimensions).map(([k, v]) => <div key={k} className="flex items-baseline justify-between text-[14px]"><span className="text-muted-foreground first-letter:uppercase">{dimLabel(k)}</span><span className={cn("fig text-[1.1rem]", scoreTone(v))}>{v.toFixed(1)}</span></div>)}</div>
            </>
          )}
        </section>
        <section>
          <h2 className="mb-4 font-serif text-[1.55rem] font-medium tracking-tight">Recurring gaps</h2>
          {p.gaps.length === 0 ? <p className="text-[15px] text-muted-foreground">No reviews yet.</p> : (
            <ul className="space-y-3">{p.gaps.slice(0, 6).map((g) => <li key={g.tag} className="text-[14px]"><div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{g.tag.replace(/[._]/g, " ")}</span><span className="num text-muted-foreground">{g.n} times</span></div><p className="text-muted-foreground">{g.example}</p></li>)}</ul>
          )}
        </section>
        <section>
          <h2 className="mb-4 font-serif text-[1.55rem] font-medium tracking-tight">Solved per week</h2>
          <div className="flex h-36 items-end gap-2" role="img" aria-label={`Problems solved per week, last 8 weeks: ${weekly.join(", ")}`}>
            {weekly.map((n, i) => <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1"><span className="num text-[12px] text-muted-foreground">{n || ""}</span><div className={cn("w-full", n ? "bg-code" : "bg-muted")} style={{ height: `${n ? (n / wmax) * 85 : 3}%` }} /></div>)}
          </div>
          <p className="mt-2 flex justify-between text-[12px] text-muted-foreground"><span>8 weeks ago</span><span>this week</span></p>
        </section>
      </div>
      <Section title="Topics" aside={<span className="text-[13px] text-muted-foreground">Pick one to see its problems</span>}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1.5">
          {p.topics.map((t) => (
            <button key={t.key} type="button" onClick={() => onTopic(t.key)} className="rounded-[3px] bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted">
              <div className="flex justify-between gap-2 text-[14px] font-medium"><span className="truncate">{t.label}</span><span className="num text-muted-foreground">{t.done}/{t.total}</span></div>
              <div className="mt-2 h-1 bg-muted"><div className={cn("h-full", t.done === t.total ? "bg-mint" : "bg-code")} style={{ width: `${t.total ? (t.done / t.total) * 100 : 0}%` }} /></div>
            </button>
          ))}
        </div>
      </Section>
    </>
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

function readOpen(): number[] | null {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null"); return Array.isArray(v) ? v : null; } catch { return null; }
}

export function CodeDashboard() {
  const road = useApi<CodeRoadmap>("/api/code/roadmap", (r) => (r.stats.generating ? 4000 : false));
  const prog = useApi<CodeProgress>("/api/code/progress", () => 20_000);
  const status = useApi<CodeStatus>("/api/code/status");
  const [q, setQ] = useState(""), [track, setTrack] = useState(""), [st, setSt] = useState(""), [topic, setTopic] = useState(""), [hidePrem, setHidePrem] = useState(false);
  const [tab, setTab] = useState<"practice" | "progress">("practice");
  const [picked, setPicked] = useState<number[] | null>(readOpen);  // chapters opened by hand, remembered across visits
  const [busy, setBusy] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const roadRef = useRef<HTMLDivElement>(null);
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

  // Until you open or fold one yourself, the chapter of the problem you are on is open.
  const cur = prog.data && (prog.data.recent.find((x) => x.last_attempt_status === "in_progress") ?? prog.data.next.core[0] ?? prog.data.next.practical[0]);
  const open = picked ?? (cur ? [cur.phase] : []);
  const setOpenSaved = (next: number[]) => { setPicked(next); try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private window */ } };
  const toggle = (n: number) => setOpenSaved(open.includes(n) ? open.filter((x) => x !== n) : [...open, n]);

  // Build ahead: the next problem in each track gets its tests built in the background, so it is usually ready when you open it.
  const prefetched = useRef(false);
  useEffect(() => {
    if (prefetched.current || !prog.data) return;
    prefetched.current = true;
    const slugs = (["core", "practical"] as const).map((t) => prog.data!.next[t][0]).filter((x) => x && x.spec === "none").map((x) => x.slug);
    if (slugs.length) api("/api/code/generate", { method: "POST", body: { slugs, only_missing: true } }).then(() => road.reload()).catch(() => {});
  }, [prog.data, road]);

  const filtered = Boolean(q.trim() || track || st || topic || hidePrem);
  const phases = useMemo(() => {
    if (!road.data) return [];
    const needle = q.trim().toLowerCase();
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
  const showRoadmap = () => { setTab("practice"); requestAnimationFrame(() => roadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const clearFilters = () => { setQ(""); setTrack(""); setSt(""); setTopic(""); setHidePrem(false); };

  const s = road.data?.stats, p = prog.data;
  const clean = s && s.done ? Math.round((s.clean / s.done) * 100) : 0;
  const toPrepare = s ? s.total + 5 - s.ready - s.generating : 0;
  const topics = road.data?.topics ?? {};
  const allOpen = phases.length > 0 && phases.every((ph) => open.includes(ph.num));

  return (
    <Page wide>
      <PageHeader title="Code" subtitle="160 problems and five multi-level builds on real Java. Every test is checked against brute force; a staff-level review reads your code."
        actions={<Button variant="outline" disabled={busy === "all" || toPrepare <= 0} onClick={() => prepare("all", { only_missing: true })}>{busy === "all" ? <Loader2 className="animate-spin" /> : <Wand2 />}Build all missing tests{toPrepare > 0 ? ` (${toPrepare})` : ""}</Button>} />

      {status.data && !status.data.java_ok && (
        <p className="mb-10 bg-coral px-5 py-3 text-[14px] font-medium text-white dark:text-ink">{status.data.java_error} Then reopen this page.</p>
      )}

      {s && (
        <div className="rise -mt-4 mb-12 grid grid-cols-2 gap-x-10 gap-y-6 md:grid-cols-4" style={{ "--i": 1 } as React.CSSProperties}>
          <Figure value={s.done} of={`/ ${s.total}`} tone="text-code" label={`Solved. Easy ${s.by_difficulty.Easy.done}/${s.by_difficulty.Easy.total}, medium ${s.by_difficulty.Medium.done}/${s.by_difficulty.Medium.total}.`} />
          <Figure value={clean} of="%" label={`Clean: ${s.clean} without hints or the solution.`} />
          <Figure value={s.by_difficulty.Hard.done} of={`/ ${s.by_difficulty.Hard.total}`} label="Hard, the ones that separate senior from staff." />
          <Figure value={s.builds_levels_cleared} of={`/ ${s.builds_total_levels}`} label={`Build levels. ${s.ready} of ${s.total + 5} have tests.`} />
        </div>
      )}

      <div className="rise relative mb-4" style={{ "--i": 2 } as React.CSSProperties}>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setTab("practice"); }} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); if (e.key === "Enter" && hits[0]) window.location.assign(href(hits[0].slug)); }}
          placeholder="Find a problem by name, number or topic" aria-label="Search problems"
          className="h-12 w-full rounded-[3px] bg-card pl-12 pr-20 font-serif text-[1.15rem] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-code" />
        {q ? <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
          : <kbd className="absolute right-4 top-1/2 -translate-y-1/2 rounded-[2px] bg-muted px-1.5 text-[13px] text-muted-foreground">/</kbd>}
      </div>

      {q.trim() && (
        <div className="mb-12">
          <p className="mb-2 flex justify-between text-[13px] text-muted-foreground"><span>{hits.length} {hits.length === 1 ? "match" : "matches"} for &ldquo;{q.trim()}&rdquo;</span><span>Enter opens the first</span></p>
          {hits.length === 0 ? <p className="py-4 text-[15px] text-muted-foreground">Nothing matches. Try a topic such as &ldquo;heap&rdquo; or a number such as &ldquo;146&rdquo;.</p> : (
            <ul className="max-h-[24rem] overflow-y-auto">
              {hits.slice(0, 8).map((x, i) => (
                <li key={x.id}>
                  <Link href={href(x.slug)} className={cn("flex items-baseline gap-3 rounded-[3px] px-3 py-2.5 transition-colors hover:bg-card", i === 0 && "bg-card")}>
                    <StatusIcon p={x} />
                    <span className="num w-10 shrink-0 text-[13px] text-muted-foreground">{x.num ?? "build"}</span>
                    <span className="min-w-0 flex-1 truncate font-serif text-[1.15rem]">{x.title}</span>
                    <span className={cn("text-[13px] font-medium", DIFF[x.difficulty])}>{x.difficulty}</span>
                    <SpecPill p={x} />
                  </Link>
                </li>
              ))}
              {hits.length > 8 && <li className="px-3 py-2 text-[13px] text-muted-foreground">Showing 8 of {hits.length}. The roadmap below is filtered to all of them.</li>}
            </ul>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "practice" | "progress")} className="mt-8 gap-8">
        <TabsList><TabsTrigger value="practice">Practice</TabsTrigger><TabsTrigger value="progress">Reviews and progress</TabsTrigger></TabsList>

        <TabsContent value="practice">
          {!p ? <Skeleton className="mb-14 h-40 w-full" /> : !q.trim() && <PickUp p={p} onRedo={() => { clearFilters(); setSt("review"); showRoadmap(); }} />}

          <div ref={roadRef} className="scroll-mt-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-serif text-[1.55rem] font-medium tracking-tight">The roadmap</h2>
              {phases.length > 0 && <button type="button" className="text-[14px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setOpenSaved(allOpen ? [] : phases.map((ph) => ph.num))}>{allOpen ? "Fold every chapter" : "Open every chapter"}</button>}
            </div>
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track" className={field}><option value="">Both tracks</option><option value="core">{TRACK.core}</option><option value="practical">{TRACK.practical}</option></select>
              <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status" className={field}><option value="">Any status</option><option value="todo">Not started</option><option value="done">Solved</option><option value="review">To redo</option></select>
              <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" className={field}><option value="">Any topic</option>{Object.entries(topics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <Button variant={hidePrem ? "default" : "outline"} size="sm" aria-pressed={hidePrem} onClick={() => setHidePrem((v) => !v)}>Hide premium</Button>
              {filtered && <button type="button" onClick={clearFilters} className="ml-1 text-[14px] text-muted-foreground underline underline-offset-4 hover:text-foreground">Clear filters</button>}
            </div>

            {!road.data ? <Skeleton className="h-96 w-full" /> : phases.length === 0 ? <p className="text-[15px] text-muted-foreground">No problem matches.</p> : (
              (["core", "practical"] as const).map((t) => {
                const list = phases.filter((ph) => ph.track === t);
                if (!list.length) return null;
                return (
                  <div key={t} className="mb-10">
                    <h3 className="mb-1 px-4 text-[14px] font-semibold">{TRACK[t]}</h3>
                    <div className="space-y-0.5">
                      {list.map((ph) => (
                        <Chapter key={ph.num} ph={ph} shown={ph.shown} topics={topics} filtered={filtered}
                          open={filtered || open.includes(ph.num)} onToggle={() => toggle(ph.num)}
                          busy={busy === `p${ph.num}`} onBuild={() => prepare(`p${ph.num}`, { phase: ph.num, only_missing: true })} />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            <p className="mt-4 text-[13px] text-muted-foreground">Opening a problem builds its tests on demand. Building a whole chapter ahead takes about a minute per problem and uses your Claude plan.</p>
          </div>
        </TabsContent>

        <TabsContent value="progress">
          {!p ? <Skeleton className="h-64 w-full" /> : <ProgressView p={p} onTopic={(k) => { clearFilters(); setTopic(k); showRoadmap(); }} />}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
