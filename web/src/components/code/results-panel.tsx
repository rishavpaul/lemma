"use client";
import { useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, XCircle } from "lucide-react";
import { Pill } from "@/components/score-chip";
import { cn } from "@/lib/utils";
import type { CaseVerdict, CodeRun, Verdict } from "@/lib/types";

const KIND: Record<string, string> = { example: "Example", edge: "Edge case", random: "Random", perf: "Stress" };

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="num max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1.5 text-xs">{text}</pre>
    </div>
  );
}

function CaseRow({ c, defaultOpen }: { c: CaseVerdict; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const detail = c.input !== undefined || c.stdout || c.trace || c.message;
  return (
    <li className="border-b last:border-0">
      <button type="button" onClick={() => detail && setOpen((o) => !o)} aria-expanded={open}
        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", detail && "hover:bg-muted/40")}>
        {c.passed ? <CheckCircle2 className="size-4 shrink-0 text-mint" /> : <XCircle className="size-4 shrink-0 text-coral" />}
        <span className="min-w-0 flex-1 truncate">{c.name || KIND[c.kind] || c.kind}</span>
        <Pill>{KIND[c.kind] ?? c.kind}</Pill>
        {c.level > 1 && <Pill tone="signal">L{c.level}</Pill>}
        <span className="num w-14 text-right text-xs text-muted-foreground">{c.ms} ms</span>
        {detail && <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />}
      </button>
      {open && (
        <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
          {!c.passed && <p className="text-sm font-medium text-coral sm:col-span-2">{c.message}</p>}
          {c.input !== undefined && <Block label="Input" text={c.input} />}
          {c.expected !== undefined && <Block label="Expected" text={c.expected} />}
          {c.actual !== undefined && <Block label={c.passed ? "Output" : "Your output"} text={c.actual} />}
          {c.trace && <div className="sm:col-span-2"><Block label="Where it failed" text={c.trace} /></div>}
          {c.stdout && <div className="sm:col-span-2"><Block label="Printed by your code" text={c.stdout} /></div>}
          {!c.passed && c.input === undefined && <p className="text-xs text-muted-foreground sm:col-span-2">Hidden case: only the first few failures are shown in full.</p>}
        </div>
      )}
    </li>
  );
}

export function CompileErrors({ v }: { v: Verdict }) {
  return (
    <div className="rounded-lg border border-coral/40 bg-coral/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-coral"><XCircle className="size-4" />Does not compile</div>
      {v.compile.errors.length > 0 ? (
        <ul className="space-y-2">
          {v.compile.errors.slice(0, 6).map((e, i) => (
            <li key={i} className="text-sm"><span className="num text-xs text-muted-foreground">line {e.line}</span> {e.message}
              {e.detail && <pre className="num mt-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{e.detail.trimEnd()}</pre>}</li>
          ))}
        </ul>
      ) : <pre className="num overflow-x-auto text-xs">{v.compile.output}</pre>}
    </div>
  );
}

/** The judge's verdict for a run: summary line, compile errors, and the cases (failures first, opened). */
export function ResultsPanel({ run, running }: { run: Pick<CodeRun, "kind" | "verdict" | "duration_ms"> | null; running: "run" | "submit" | null }) {
  if (running) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{running === "submit" ? "Running every test, including the stress cases..." : "Running the examples and edge cases..."}</div>;
  if (!run?.verdict) return <p className="p-4 text-sm text-muted-foreground">Run the examples with <kbd className="rounded border px-1 text-xs">Cmd</kbd>+<kbd className="rounded border px-1 text-xs">Enter</kbd>. Submit runs every test, including random and stress cases, with <kbd className="rounded border px-1 text-xs">Cmd</kbd>+<kbd className="rounded border px-1 text-xs">Shift</kbd>+<kbd className="rounded border px-1 text-xs">Enter</kbd>.</p>;
  const v = run.verdict;
  if (v.status === "compile_error") return <div className="p-3"><CompileErrors v={v} /></div>;
  const failed = v.cases.filter((c) => !c.passed);
  const ordered = [...failed, ...v.cases.filter((c) => c.passed)];
  const ok = v.status === "passed";
  return (
    <div>
      <div className={cn("flex flex-wrap items-center gap-3 border-b px-3 py-2.5", ok ? "bg-mint/10" : "bg-coral/10")}>
        {ok ? <CheckCircle2 className="size-5 text-mint" /> : <XCircle className="size-5 text-coral" />}
        <span className="font-medium">{ok ? (run.kind === "submit" ? "All tests passed" : "Examples and edge cases passed") : `${failed.length} failing`}</span>
        <span className="num text-sm text-muted-foreground">{v.passed}/{v.total}</span>
        <span className="num ml-auto text-xs text-muted-foreground">{run.kind === "submit" ? "Submit" : "Run"} · {(run.duration_ms / 1000).toFixed(1)}s</span>
      </div>
      {ok && run.kind === "run" && <p className="border-b px-3 py-2 text-xs text-muted-foreground">Submit to run the random and stress cases too.</p>}
      <ul>{ordered.map((c, i) => <CaseRow key={c.id} c={c} defaultOpen={!c.passed && i === 0} />)}</ul>
    </div>
  );
}
