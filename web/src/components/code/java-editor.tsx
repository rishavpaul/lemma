"use client";
import CodeMirror from "@uiw/react-codemirror";
import { java } from "@codemirror/lang-java";
import { Decoration, EditorView, GutterMarker, gutter, keymap, type DecorationSet } from "@codemirror/view";
import { Prec, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { connectLsp, type LspConnection, type LspStatus } from "@/lib/lsp";
import { APPLIED_EVENT, revealComment, reviewField, reviewTheme, scrollToComment, setReview, type InlineReview } from "@/components/code/inline-review";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<LspStatus, string> = { off: "", starting: "Java language server starting...", ready: "Java language server ready", unavailable: "" };

/** Java editor. Cmd/Ctrl+Enter runs the examples, Cmd/Ctrl+Shift+Enter submits.
 *  With `attemptId` it starts the Java language server on demand (completion, auto-import, live errors, go to definition on Cmd+click or F12);
 *  without one, or when the server is not installed, it stays a plain editor. */
/** The editor sits on the page's own surface: the stock themes only supply syntax colors. */
const surface = EditorView.theme({
  // The text layer stays transparent: CodeMirror draws the selection in a layer *below* it, so painting .cm-content would hide
  // every selection (drag, double-click, Cmd+A).
  "&, .cm-scroller": { backgroundColor: "var(--card) !important", color: "var(--foreground)" },
  ".cm-content": { backgroundColor: "transparent !important" },
  // Completion list: the highlighted option is the one Enter accepts, so it is the bright one; the rest recede.
  ".cm-tooltip": { backgroundColor: "var(--popover) !important", color: "var(--popover-foreground)", border: "none !important", borderRadius: "3px" },
  ".cm-tooltip-autocomplete > ul > li": { color: "var(--muted-foreground)", opacity: "0.85" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--code) !important", color: "var(--code-foreground) !important", opacity: "1" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail, .cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon": { color: "inherit", opacity: "0.9" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "var(--card)", color: "var(--muted-foreground)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--foreground) 5%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklch, var(--code) 28%, transparent) !important" },
});

/**
 * Select All for the desktop app's Edit menu (app/desktop.py calls it on Cmd+A). In a focused editor it selects the whole
 * document, which the native command cannot do because CodeMirror keeps only the visible lines in the DOM. Elsewhere it
 * falls back to the browser's own select-all.
 */
function selectAll() {
  const host = document.activeElement?.closest(".cm-editor");
  const view = host instanceof HTMLElement ? EditorView.findFromDOM(host) : null;
  if (!view) { document.execCommand("selectAll"); return; }
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length }, userEvent: "select" });
  view.focus();
}
if (typeof window !== "undefined") (window as unknown as { __lemmaSelectAll?: () => void }).__lemmaSelectAll = selectAll;

// ---- breakpoints and the debugger's current line -----------------------------------------------------------------------------
// Both are owned by the page (line numbers) and pushed into the editor through effects; clicking the breakpoint gutter asks the
// page to toggle a line.

class BreakpointMarker extends GutterMarker {
  toDOM() { const s = document.createElement("span"); s.className = "cm-bp-dot"; s.setAttribute("aria-label", "Breakpoint"); return s; }
}
class ExecMarker extends GutterMarker {
  toDOM() { const s = document.createElement("span"); s.className = "cm-exec-arrow"; s.textContent = "▶"; s.setAttribute("aria-label", "Current line"); return s; }
}
const bpMarker = new BreakpointMarker(), execMarker = new ExecMarker();
const setBreakpoints = StateEffect.define<number[]>();
const setExecLine = StateEffect.define<number | null>();

function lineStart(doc: EditorView["state"]["doc"], n: number): number | null {
  return n >= 1 && n <= doc.lines ? doc.line(n).from : null;
}

const breakpointField = StateField.define<{ lines: number[]; exec: number | null }>({
  create: () => ({ lines: [], exec: null }),
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(setBreakpoints)) v = { ...v, lines: e.value };
      if (e.is(setExecLine)) v = { ...v, exec: e.value };
    }
    return v;
  },
});

const execDecorations = EditorView.decorations.compute([breakpointField], (state): DecorationSet => {
  const at = state.field(breakpointField).exec;
  const from = at == null ? null : lineStart(state.doc, at);
  return from == null ? Decoration.none : Decoration.set([Decoration.line({ class: "cm-exec-line" }).range(from)]);
});

/** Clicking the gutter raises this DOM event on the editor with the 1-based line; the component turns it into onToggleBreakpoint. */
const TOGGLE_EVENT = "lemma-toggle-breakpoint";

const breakpointGutter = gutter({
    class: "cm-bp-gutter",
    markers: (view) => {
      const { lines, exec } = view.state.field(breakpointField);
      const marks: { from: number; m: GutterMarker }[] = [];
      for (const n of lines) { const from = lineStart(view.state.doc, n); if (from != null && n !== exec) marks.push({ from, m: bpMarker }); }
      const ef = exec == null ? null : lineStart(view.state.doc, exec);
      if (ef != null) marks.push({ from: ef, m: execMarker });
      marks.sort((x, y) => x.from - y.from);
      return RangeSet.of(marks.map((x) => x.m.range(x.from)));
    },
    initialSpacer: () => bpMarker,
    domEventHandlers: {
      mousedown(view, line) {
        view.dom.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: view.state.doc.lineAt(line.from).number }));
        return true;
      },
    },
});

const debugTheme = EditorView.theme({
  ".cm-bp-gutter": { width: "14px", cursor: "pointer" },
  ".cm-bp-gutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center" },
  ".cm-bp-dot": { display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--coral)" },
  ".cm-exec-arrow": { color: "var(--signal)", fontSize: "9px", lineHeight: "1" },
  ".cm-exec-line": { backgroundColor: "color-mix(in oklch, var(--signal) 20%, transparent) !important" },
});

export function JavaEditor({ value, onChange, onRun, onSubmit, readOnly, height = "100%", className, attemptId, breakpoints, onToggleBreakpoint, execLine, review, reveal, onReviewApplied }: {
  value: string; onChange?: (v: string) => void; onRun?: () => void; onSubmit?: () => void; readOnly?: boolean; height?: string; className?: string; attemptId?: number;
  /** Breakpoint line numbers (1-based). Passing `onToggleBreakpoint` shows the breakpoint gutter. */
  breakpoints?: number[]; onToggleBreakpoint?: (line: number) => void;
  /** The line the debugger is replaying, highlighted and scrolled into view; null for none. */
  execLine?: number | null;
  /** Staff review comments shown under the code they are about (null hides them); `reveal` expands and scrolls to one. */
  review?: InlineReview; reveal?: { key: string; n: number } | null; onReviewApplied?: (title: string, undo: boolean) => void;
}) {
  const { resolvedTheme } = useTheme();
  const viewRef = useRef<EditorView | null>(null);
  const toggleRef = useRef(onToggleBreakpoint);
  const appliedRef = useRef(onReviewApplied);
  useEffect(() => { toggleRef.current = onToggleBreakpoint; appliedRef.current = onReviewApplied; });
  useEffect(() => { viewRef.current?.dispatch({ effects: setReview.of(review ?? null) }); }, [review]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    view.dispatch({ effects: revealComment.of(reveal.key) });
    scrollToComment(view, reveal.key);
  }, [reveal]);
  const debuggable = !!onToggleBreakpoint;
  useEffect(() => { viewRef.current?.dispatch({ effects: setBreakpoints.of(breakpoints ?? []) }); }, [breakpoints]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const from = execLine == null ? null : lineStart(view.state.doc, execLine);
    view.dispatch({ effects: [setExecLine.of(execLine ?? null), ...(from == null ? [] : [EditorView.scrollIntoView(from, { y: "center" })])] });
  }, [execLine]);
  const [lsp, setLsp] = useState<LspConnection | null>(null);
  const [status, setStatus] = useState<{ s: LspStatus; reason?: string }>({ s: "off" });
  useEffect(() => {
    if (!attemptId || readOnly) return;
    let conn: LspConnection | null = null;
    let cancelled = false;
    connectLsp(attemptId, (s, reason) => { if (!cancelled) setStatus({ s, reason }); })
      .then((c) => { if (cancelled) c?.close(); else { conn = c; setLsp(c); } })
      .catch(() => { if (!cancelled) setStatus({ s: "unavailable" }); });
    return () => { cancelled = true; conn?.close(); setLsp(null); setStatus({ s: "off" }); };
  }, [attemptId, readOnly]);
  // Must be referentially stable: @uiw/react-codemirror reconfigures the whole editor whenever this changes, which closes the
  // Cmd+F panel. Keep this object stable: an inline object is a new value on every render and would close the panel.
  const basicSetup = useMemo(() => ({ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, indentOnInput: true, bracketMatching: true, closeBrackets: true, autocompletion: !!lsp }), [readOnly, lsp]);
  const extensions = useMemo(() => [
    java(),
    Prec.highest(surface),
    ...(debuggable ? [breakpointField, breakpointGutter, execDecorations, debugTheme] : []),
    reviewField, reviewTheme,
    EditorView.lineWrapping,
    ...(lsp ? [lsp.extension] : []),
    Prec.highest(keymap.of([
      { key: "Mod-Enter", run: () => { onRun?.(); return true; } },
      { key: "Mod-Shift-Enter", run: () => { onSubmit?.(); return true; } },
    ])),
  ], [onRun, onSubmit, lsp, debuggable]);
  return (
    <div className={cn("relative overflow-hidden rounded-[3px] bg-card text-[13px]", className)} style={{ height }}>
      <CodeMirror value={value} height="100%" theme={resolvedTheme === "dark" ? "dark" : "light"} extensions={extensions} readOnly={readOnly}
        onCreateEditor={(view) => {
          viewRef.current = view;
          view.dom.addEventListener(TOGGLE_EVENT, (e) => toggleRef.current?.((e as CustomEvent<number>).detail));
          view.dom.addEventListener(APPLIED_EVENT, (e) => { const d = (e as CustomEvent<{ title: string; undo: boolean }>).detail; appliedRef.current?.(d.title, d.undo); });
          view.dispatch({ effects: [setBreakpoints.of(breakpoints ?? []), setExecLine.of(execLine ?? null), setReview.of(review ?? null)] });
        }}
        onChange={onChange} basicSetup={basicSetup}
        style={{ height: "100%", fontFamily: "var(--font-code), ui-monospace, monospace" }} />
      {(STATUS_TEXT[status.s] || status.reason) && (
        <span className="pointer-events-none absolute bottom-1.5 right-2 bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground" title={status.reason}>
          {status.s === "unavailable" ? "Plain editor" : STATUS_TEXT[status.s]}
        </span>
      )}
    </div>
  );
}
