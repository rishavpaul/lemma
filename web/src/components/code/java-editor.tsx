"use client";
import CodeMirror from "@uiw/react-codemirror";
import { java } from "@codemirror/lang-java";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { connectLsp, type LspConnection, type LspStatus } from "@/lib/lsp";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<LspStatus, string> = { off: "", starting: "Java language server starting...", ready: "Java language server ready", unavailable: "" };

/** Java editor. Cmd/Ctrl+Enter runs the examples, Cmd/Ctrl+Shift+Enter submits.
 *  With `attemptId` it starts the Java language server on demand (completion, auto-import, live errors, go to definition on Cmd+click or F12);
 *  without one, or when the server is not installed, it stays a plain editor. */
export function JavaEditor({ value, onChange, onRun, onSubmit, readOnly, height = "100%", className, attemptId }: {
  value: string; onChange?: (v: string) => void; onRun?: () => void; onSubmit?: () => void; readOnly?: boolean; height?: string; className?: string; attemptId?: number;
}) {
  const { resolvedTheme } = useTheme();
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
  const extensions = useMemo(() => [
    java(),
    EditorView.lineWrapping,
    ...(lsp ? [lsp.extension] : []),
    Prec.highest(keymap.of([
      { key: "Mod-Enter", run: () => { onRun?.(); return true; } },
      { key: "Mod-Shift-Enter", run: () => { onSubmit?.(); return true; } },
    ])),
  ], [onRun, onSubmit, lsp]);
  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-card text-[13px]", className)} style={{ height }}>
      <CodeMirror value={value} height="100%" theme={resolvedTheme === "dark" ? "dark" : "light"} extensions={extensions} readOnly={readOnly}
        onChange={onChange} basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, indentOnInput: true, bracketMatching: true, closeBrackets: true, autocompletion: !!lsp }}
        style={{ height: "100%", fontFamily: "var(--font-num), ui-monospace, monospace" }} />
      {(STATUS_TEXT[status.s] || status.reason) && (
        <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-card/80 px-1.5 py-0.5 text-[11px] text-muted-foreground" title={status.reason}>
          {status.s === "unavailable" ? "Plain editor" : STATUS_TEXT[status.s]}
        </span>
      )}
    </div>
  );
}
