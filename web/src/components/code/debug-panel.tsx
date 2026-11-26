"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Loader2, Bug, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { CodeCaseInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---- the recording (app/code/java/Tracer.java) ---------------------------------------------------------------------------------

export type TVal = { t: "p"; v: string } | { t: "s"; v: string } | { t: "n" } | { t: "r"; id: number; type: string };
export type THeapObj = {
  type: string; k: "obj" | "list" | "set" | "heap" | "map" | "opaque"; size?: number;
  fields?: [string, TVal][]; items?: TVal[]; entries?: [TVal, TVal][];
};
export type TFrame = { method: string; line: number; vars: [string, TVal][] };
export type TStep = { kind: "line" | "return" | "exception"; line: number; method?: string; value?: TVal | string; frames: TFrame[]; heap: Record<string, THeapObj> };
export type Trace = {
  case_id: string; case_name: string; input: string; steps: TStep[]; truncated: boolean; error: string | null;
  compile: { ok: boolean; output: string; errors: { line: number; message: string }[] };
  result: { status: string; result?: unknown; error?: string; stdout?: string } | null;
  passed?: boolean; expected: string | null; actual: string | null;
};

const MAX_DEPTH = 6;

/** Stable short names for objects (#1, #2...) in order of first appearance, so the same node reads the same at every step. */
function useObjectNames(trace: Trace | null) {
  return useMemo(() => {
    const names = new Map<number, number>();
    const see = (v: TVal | string | undefined) => { if (v && typeof v !== "string" && v.t === "r" && !names.has(v.id)) names.set(v.id, names.size + 1); };
    for (const s of trace?.steps ?? []) {
      for (const f of s.frames) for (const [, v] of f.vars) see(v);
      for (const h of Object.values(s.heap)) {
        h.fields?.forEach(([, v]) => see(v)); h.items?.forEach(see); h.entries?.forEach(([k, v]) => { see(k); see(v); });
      }
    }
    return names;
  }, [trace]);
}

function Short({ v, names }: { v: TVal; names: Map<number, number> }) {
  if (v.t === "n") return <span className="text-muted-foreground">null</span>;
  if (v.t === "s") return <span className="text-mint">&quot;{v.v}&quot;</span>;
  if (v.t === "p") return <span className="text-code">{v.v}</span>;
  return <span><span className="text-foreground">{v.type}</span><span className="text-muted-foreground"> #{names.get(v.id) ?? "?"}</span></span>;
}

/** One-line summary of an object for its collapsed row. */
function Preview({ o, names }: { o: THeapObj; names: Map<number, number> }) {
  const n = 4;
  if (o.k === "map") return <>{"{"}{o.entries!.slice(0, n).map(([k, v], i) => <span key={i}>{i > 0 && ", "}<Short v={k} names={names} />=<Short v={v} names={names} /></span>)}{(o.size ?? 0) > n && ", …"}{"}"}</>;
  if (o.k === "list" || o.k === "set" || o.k === "heap") return <>{o.k === "set" ? "{" : "["}{o.items!.slice(0, n).map((v, i) => <span key={i}>{i > 0 && ", "}<Short v={v} names={names} /></span>)}{(o.size ?? 0) > n && ", …"}{o.k === "set" ? "}" : "]"}</>;
  if (o.k === "obj") return <>{"{"}{o.fields!.slice(0, n).map(([f, v], i) => <span key={f}>{i > 0 && ", "}<span className="text-muted-foreground">{f}:</span> <Short v={v} names={names} /></span>)}{o.fields!.length > n && ", …"}{"}"}</>;
  return null;
}

function Value({ label, v, heap, names, path, changed }: {
  label: React.ReactNode; v: TVal; heap: Record<string, THeapObj>; names: Map<number, number>; path: number[]; changed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const obj = v.t === "r" ? heap[String(v.id)] : undefined;
  const cycle = v.t === "r" && path.includes(v.id);
  const canOpen = !!obj && obj.k !== "opaque" && !cycle && path.length < MAX_DEPTH;
  const children: [React.ReactNode, TVal][] = !obj ? [] :
    obj.k === "obj" ? obj.fields!.map(([f, x]) => [f, x]) :
    obj.k === "map" ? obj.entries!.map(([k, x]) => [<Short key="k" v={k} names={names} />, x]) :
    (obj.items ?? []).map((x, i) => [obj.k === "set" ? "·" : String(i), x]);
  return (
    <li>
      <div className={cn("flex min-w-0 items-baseline gap-1.5 rounded-[2px] px-1 py-0.5", changed && "bg-signal/15")}>
        <button type="button" disabled={!canOpen} onClick={() => setOpen((o) => !o)} aria-expanded={canOpen ? open : undefined}
          className={cn("w-3 shrink-0 text-[10px] text-muted-foreground", !canOpen && "invisible")}>{open ? "▼" : "▶"}</button>
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <span className="shrink-0 text-muted-foreground">=</span>
        <span className="min-w-0 truncate">
          <Short v={v} names={names} />
          {obj && obj.size !== undefined && <span className="text-muted-foreground"> ({obj.size})</span>}
          {cycle && <span className="text-muted-foreground"> (shown above)</span>}
          {obj && !open && !cycle && <span className="ml-1.5 text-muted-foreground"><Preview o={obj} names={names} /></span>}
          {v.t === "r" && !obj && <span className="text-muted-foreground"> (not captured)</span>}
        </span>
      </div>
      {open && obj && (
        <ul className="ml-4">
          {children.map(([k, x], i) => <Value key={i} label={k} v={x} heap={heap} names={names} path={[...path, (v as { id: number }).id]} />)}
          {(obj.size ?? 0) > children.length && <li className="px-5 text-muted-foreground">… {(obj.size ?? 0) - children.length} more</li>}
        </ul>
      )}
    </li>
  );
}

/** What a variable looked like, deep enough to notice a change in the object it points at. */
function fingerprint(v: TVal | undefined, heap: Record<string, THeapObj>): string {
  if (!v) return "";
  return v.t === "r" ? `${v.id}:${JSON.stringify(heap[String(v.id)] ?? null)}` : JSON.stringify(v);
}

export function DebugPanel({ attemptId, code, cases, breakpoints, onExecLine }: {
  attemptId: number; code: string; cases: CodeCaseInfo[]; breakpoints: number[]; onExecLine: (line: number | null) => void;
}) {
  const [caseId, setCaseId] = useState(cases[0]?.id ?? "");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [tracedCode, setTracedCode] = useState("");
  const [i, setI] = useState(0);
  const [frameIx, setFrameIx] = useState(0);
  const [busy, setBusy] = useState(false);
  const names = useObjectNames(trace);
  const steps = trace?.steps ?? [];
  const step = steps[i];

  useEffect(() => { onExecLine(step ? step.line : null); }, [step, onExecLine]);
  useEffect(() => () => onExecLine(null), [onExecLine]);

  async function record() {
    setBusy(true);
    try {
      const t = await api<Trace>(`/api/code/attempts/${attemptId}/trace`, { method: "POST", body: { code, case_id: caseId } });
      setTrace(t); setTracedCode(code); setFrameIx(0);
      const bp = new Set(breakpoints);
      const first = t.steps.findIndex((s) => s.kind === "line" && bp.has(s.line));
      setI(first >= 0 ? first : 0);
    } catch (e) { toast.error("Could not record", { description: (e as Error).message }); }
    setBusy(false);
  }

  const go = (n: number) => { setI(Math.max(0, Math.min(steps.length - 1, n))); setFrameIx(0); };
  const bp = new Set(breakpoints);
  const nextBp = () => { const k = steps.findIndex((s, j) => j > i && s.kind === "line" && bp.has(s.line)); go(k >= 0 ? k : steps.length - 1); };
  const prevBp = () => { let k = -1; for (let j = i - 1; j >= 0; j--) if (steps[j].kind === "line" && bp.has(steps[j].line)) { k = j; break; } go(k >= 0 ? k : 0); };

  function onKey(e: React.KeyboardEvent) {
    if (!trace || (e.target as HTMLElement).tagName === "SELECT") return;
    const keys: Record<string, () => void> = { ArrowRight: () => go(i + 1), ArrowLeft: () => go(i - 1), ArrowDown: nextBp, ArrowUp: prevBp, Home: () => go(0), End: () => go(steps.length - 1) };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  }

  // Variables that changed since the previous step of the same frame.
  const frame = step?.frames[frameIx];
  let prev: { f: TFrame; heap: Record<string, THeapObj> } | null = null;
  if (step && frameIx === 0) {
    for (let j = i - 1; j >= 0; j--) {
      const f = steps[j].frames[0];
      if (steps[j].frames.length === step.frames.length && f.method === step.frames[0].method) { prev = { f, heap: steps[j].heap }; break; }
    }
  }
  const changed = (name: string, v: TVal) => {
    if (!prev || !step) return false;
    const before = prev.f.vars.find(([n]) => n === name)?.[1];
    return fingerprint(before, prev.heap) !== fingerprint(v, step.heap);
  };

  return (
    <div className="px-5 pb-5 pt-4 text-[14px] outline-none" tabIndex={-1} onKeyDown={onKey}>
      <div className="flex flex-wrap items-center gap-2">
        <select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Case to debug"
          className="h-8 min-w-0 max-w-full flex-1 rounded-[3px] bg-muted px-2 text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-ring">
          {cases.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === "example" ? "example" : "edge case"})</option>)}
        </select>
        <Button size="sm" variant="code" disabled={busy || !caseId} onClick={record}>{busy ? <Loader2 className="animate-spin" /> : <Bug />}{trace ? "Record again" : "Record"}</Button>
      </div>
      {!trace && (
        <p className="mt-3 text-muted-foreground">
          Click in the narrow gutter left of the line numbers to set breakpoints, pick a case, then Record. The case runs once and every line is
          recorded, so you can step forwards and backwards. Practice aid only: it does not count as a run or change your rating.
        </p>
      )}

      {trace && !trace.compile.ok && <pre className="mt-3 whitespace-pre-wrap font-mono text-[12px] text-coral">{trace.compile.output}</pre>}
      {trace?.error && <p className="mt-3 text-coral">{trace.error}</p>}

      {trace && step && (
        <>
          {code !== tracedCode && <p className="mt-3 text-[13px] text-signal">Your code changed since this recording, so lines may not match. Record again.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="First step" title="First step (Home)" onClick={() => go(0)}><ChevronFirst /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Previous breakpoint" title="Back to the previous breakpoint (↑)" onClick={prevBp}><SkipBack /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Step back" title="Step back (←)" onClick={() => go(i - 1)}><ChevronLeft /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Step" title="Step (→)" onClick={() => go(i + 1)}><ChevronRight /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Continue to the next breakpoint" title="Continue to the next breakpoint (↓)" onClick={nextBp}><SkipForward /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Last step" title="Last step (End)" onClick={() => go(steps.length - 1)}><ChevronLast /></Button>
            <input type="range" min={0} max={steps.length - 1} value={i} onChange={(e) => go(Number(e.target.value))} aria-label="Step"
              className="mx-2 min-w-24 flex-1 accent-[var(--code)]" />
            <span className="num text-[13px] text-muted-foreground">{i + 1} / {steps.length}{trace.truncated && "+"}</span>
          </div>

          <p className="mt-2">
            <span className="text-muted-foreground">Line </span><span className="num font-medium">{step.line}</span>
            <span className="text-muted-foreground"> in </span><span className="font-medium">{step.frames[0].method}</span>
            {step.kind === "return" && step.value && typeof step.value !== "string" && <> <span className="text-muted-foreground">returns</span> <Short v={step.value} names={names} /></>}
            {step.kind === "exception" && <span className="ml-1 text-coral">throws {String(step.value)}</span>}
          </p>

          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <div>
              <h4 className="mb-1 text-[13px] font-semibold">Call stack</h4>
              <ol>
                {step.frames.map((f, k) => (
                  <li key={k}>
                    <button type="button" onClick={() => setFrameIx(k)} disabled={k > 2}
                      className={cn("w-full truncate rounded-[2px] px-1.5 py-0.5 text-left font-mono text-[12px]", k === frameIx ? "bg-code/15 text-foreground" : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground")}
                      title={k > 2 ? "Variables are recorded for the three innermost calls" : undefined}>
                      {f.method}:{f.line}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <div className="min-w-0">
              <h4 className="mb-1 text-[13px] font-semibold">Variables</h4>
              {frame && frame.vars.length > 0 ? (
                <ul className="font-mono text-[12.5px] leading-relaxed">
                  {frame.vars.map(([n, v]) => <Value key={`${i}:${frameIx}:${n}`} label={n} v={v} heap={step.heap} names={names} path={[]} changed={changed(n, v)} />)}
                </ul>
              ) : <p className="text-muted-foreground">No variables in scope.</p>}
            </div>
          </div>

          <div className="mt-4 rounded-[3px] bg-background px-3 py-2 text-[13px]">
            <span className="text-muted-foreground">Case </span>{trace.case_name}<span className="text-muted-foreground">: </span>
            {trace.truncated ? <span className="text-signal">Stopped recording after {steps.length} steps. A loop that never ends looks like this; otherwise pick a smaller case.</span>
              : !trace.result ? <span className="text-coral">The program did not finish.</span>
              : trace.result.status === "error" ? <span className="text-coral">{trace.result.error}</span>
              : trace.passed === false ? <span className="text-coral">Wrong answer. Expected {trace.expected}, got {trace.actual}.</span>
              : trace.passed ? <span className="text-mint">Correct ({trace.actual}).</span>
              : <span>Returned {trace.actual}.</span>}
            {trace.result?.stdout && <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[12px] text-muted-foreground">{trace.result.stdout}</pre>}
          </div>
        </>
      )}
    </div>
  );
}
