"use client";
import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Tomb } from "@/components/shell/page-header";
import { Pill } from "@/components/score-chip";
import { cn } from "@/lib/utils";
import type { CaseVerdict, CodeRun, Verdict } from "@/lib/types";

const KIND: Record<string, string> = { example: "Example", edge: "Edge case", random: "Random", perf: "Stress" };

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[12px] font-medium text-muted-foreground">{label}</div>
      <pre className="font-mono max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[2px] bg-muted px-2 py-1.5 text-xs">{text}</pre>
    </div>
  );
}

function CaseRow({ c, defaultOpen }: { c: CaseVerdict; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const detail = c.input !== undefined || c.stdout || c.trace || c.message;
  return (
    <li>
      <button type="button" onClick={() => detail && setOpen((o) => !o)} aria-expanded={open}
        className={cn("flex w-full items-center gap-2.5 px-5 py-2.5 text-left text-[14px] transition-colors", detail && "hover:bg-muted")}>
        <Tomb done={c.passed} className={cn("shrink-0", c.passed ? "text-mint" : "text-coral")} label={c.passed ? "Passed" : "Failed"} />
        <span className="min-w-0 flex-1 truncate">{c.name || KIND[c.kind] || c.kind}</span>
        <Pill>{KIND[c.kind] ?? c.kind}</Pill>
        {c.level > 1 && <Pill tone="signal">L{c.level}</Pill>}
        <span className="num w-16 text-right text-[13px] text-muted-foreground">{c.ms} ms</span>
        {detail && <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />}
      </button>
      {open && (
        <div className="grid gap-3 px-5 pb-4 pl-11 sm:grid-cols-2">
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
    <div className="rounded-[3px] bg-coral/10 p-3">
      <div className="mb-3 font-serif text-[1.3rem] text-coral">Does not compile</div>
      {v.compile.errors.length > 0 ? (
        <ul className="space-y-2">
          {v.compile.errors.slice(0, 6).map((e, i) => (
            <li key={i} className="text-sm"><span className="num text-xs text-muted-foreground">line {e.line}</span> {e.message}
              {e.detail && <pre className="font-mono mt-1 overflow-x-auto rounded-[2px] bg-muted px-2 py-1 text-xs">{e.detail.trimEnd()}</pre>}</li>
          ))}
        </ul>
      ) : <pre className="font-mono overflow-x-auto text-xs">{v.compile.output}</pre>}
    </div>
  );
}

/** The judge's verdict for a run: summary line, compile errors, and the cases (failures first, opened). */
export function ResultsPanel({ run, running }: { run: Pick<CodeRun, "kind" | "verdict" | "duration_ms"> | null; running: "run" | "submit" | null }) {
  if (running) return <div className="flex items-center gap-2 p-5 text-[15px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />{running === "submit" ? "Running every test, including the stress cases..." : "Running the examples and edge cases..."}</div>;
  if (!run?.verdict) return <p className="p-5 text-[15px] leading-relaxed text-muted-foreground">Run the examples with <kbd className="rounded-[2px] bg-muted px-1 text-xs">Cmd</kbd>+<kbd className="rounded-[2px] bg-muted px-1 text-xs">Enter</kbd>. Submit runs every test, including random and stress cases, with <kbd className="rounded-[2px] bg-muted px-1 text-xs">Cmd</kbd>+<kbd className="rounded-[2px] bg-muted px-1 text-xs">Shift</kbd>+<kbd className="rounded-[2px] bg-muted px-1 text-xs">Enter</kbd>.</p>;
  const v = run.verdict;
  if (v.status === "compile_error") return <div className="p-4"><CompileErrors v={v} /></div>;
  const failed = v.cases.filter((c) => !c.passed);
  const ordered = [...failed, ...v.cases.filter((c) => c.passed)];
  const ok = v.status === "passed";
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 pb-3 pt-4">
        <span className={cn("fig text-[2.2rem] font-semibold", ok ? "text-mint" : "text-coral")}>{v.passed}<span className="text-[1.2rem] text-muted-foreground">/{v.total}</span></span>
        <span className="font-serif text-[1.3rem]">{ok ? (run.kind === "submit" ? "Every test passes." : "Examples and edge cases pass.") : `${failed.length} failing.`}</span>
        <span className="num ml-auto text-[13px] text-muted-foreground">{run.kind === "submit" ? "Submit" : "Run"} · {(run.duration_ms / 1000).toFixed(1)}s</span>
      </div>
      {ok && run.kind === "run" && <p className="px-5 pb-3 text-[13px] text-muted-foreground">Submit to run the random and stress cases too.</p>}
      <ul>{ordered.map((c, i) => <CaseRow key={c.id} c={c} defaultOpen={!c.passed && i === 0} />)}</ul>
    </div>
  );
}
