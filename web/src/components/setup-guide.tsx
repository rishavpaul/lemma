"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Check, CircleDashed, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/shell/page-header";
import { removeKey, saveKey, splitModel, useProviders, type ProviderStatus, type Providers } from "@/components/model-picker";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { Health } from "@/lib/types";

type S = Record<string, string>;
const input = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

/** Key entry for one provider: save (verified with the provider first) and remove. */
export function KeyField({ name, p, onChange, onSaved }: { name: string; p: ProviderStatus; onChange: (d: Providers) => void; onSaved?: () => void }) {
  const [key, setKey] = useState(""), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { onChange(await saveKey(name, key)); setKey(""); toast.success(`${p.label} key saved`); onSaved?.(); }
    catch (e) { toast.error(`${p.label} key not saved`, { description: (e as Error).message }); }
    setBusy(false);
  }
  async function clear() {
    setBusy(true);
    try { onChange(await removeKey(name)); toast.success(`${p.label} key removed`); } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.configured && !key && (
        <>
          <span className="text-sm text-mint">{p.from_env ? "From environment" : `Saved ${p.hint}`}</span>
          {!p.from_env && <Button variant="outline" size="sm" disabled={busy} onClick={clear}>Remove</Button>}
        </>
      )}
      {!(p.configured && p.from_env) && (
        <>
          <input className={input + " min-w-48 flex-1"} type="password" autoComplete="off" spellCheck={false} value={key}
            placeholder={p.configured ? "Paste a new key to replace" : "Paste API key"} aria-label={`${p.label} API key`}
            onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && key && void save()} />
          <Button size="sm" disabled={busy || !key.trim()} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />}Save</Button>
        </>
      )}
    </div>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full " + (done ? "bg-mint/20 text-mint" : "border border-dashed text-muted-foreground")}>
        {done ? <Check className="size-3" /> : <CircleDashed className="size-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {children && <div className="mt-1.5 text-sm text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

/** Shown on the home screen until speech recognition and a grading model are both usable. */
export function SetupGuide() {
  const health = useApi<Health>("/api/health", (h) => (h.whisper_loading || h.claude_ok === null ? 3000 : false));
  const settings = useApi<S>("/api/settings");
  const prov = useProviders();
  const [busy, setBusy] = useState(false);
  const h = health.data, s = settings.data, p = prov.data;
  if (!h || !s || !p) return null;

  const usable = (model: string) => {
    const { provider } = splitModel(model);
    return provider === "claude" ? h.claude_ok !== false : !!p[provider]?.configured && model.length > provider.length + 1;
  };
  const gradingReady = usable(s.model_section) && usable(s.model_holistic);
  const speechReady = h.whisper_loaded;
  if (gradingReady && speechReady && h.ffmpeg_ok) return null;

  async function chooseProvider(name: string) {
    setBusy(true);
    try {
      const r = await api<{ model: string }>(`/api/providers/${name}/use`, { method: "POST" });
      toast.success("Grading set up", { description: `Using ${r.model}` });
      await settings.reload();
    } catch (e) { toast.error("Could not choose a model", { description: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <Panel className="mb-8 border-signal/40">
      <h2 className="text-base font-semibold">Finish setting up</h2>
      <p className="mt-1 text-sm text-muted-foreground">Two things have to be ready before your first session. It only takes a few minutes.</p>
      <ol className="mt-5 space-y-5">
        <Step done={speechReady} title="Speech recognition">
          {speechReady ? null : h.whisper_error ? (
            <span className="flex items-start gap-1.5 text-coral"><TriangleAlert className="mt-0.5 size-4 shrink-0" />The speech model could not load: {h.whisper_error}. Check your internet connection, then quit and reopen the app.</span>
          ) : (
            <span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" />Downloading the speech model (about 1.5 GB, one time only). You can set up grading meanwhile.</span>
          )}
        </Step>
        <Step done={gradingReady} title="Grading">
          {gradingReady ? null : (
            <div className="space-y-4">
              <p>Your answers are graded by an AI model. Pick one of these:</p>
              <div className="rounded-lg border p-3">
                <div className="text-sm font-medium text-foreground">Option A: a free model (no subscription)</div>
                <p className="mt-1 text-xs">Create a free account with either service, copy an API key, and paste it here.</p>
                <div className="mt-3 space-y-3">
                  {Object.entries(p).map(([name, st]) => (
                    <div key={name}>
                      <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-foreground">{st.label}</span>
                        <a className="text-signal hover:underline" href={st.keys_url} target="_blank" rel="noreferrer">Get a free key</a></div>
                      <KeyField name={name} p={st} onChange={(d) => prov.setData(d)} onSaved={() => void chooseProvider(name)} />
                    </div>
                  ))}
                </div>
                {busy && <p className="mt-3 flex items-center gap-2 text-xs"><Loader2 className="size-3 animate-spin" />Choosing a model…</p>}
                <p className="mt-3 text-xs">Free models are rate limited and may grade less strictly than Claude. You can change the model anytime in Settings.</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm font-medium text-foreground">Option B: Claude (Pro or Max subscription)</div>
                <p className="mt-1 text-xs">Install <a className="text-signal hover:underline" href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a>, open the Terminal app, run <code className="rounded bg-muted px-1">claude</code> and sign in with <code className="rounded bg-muted px-1">/login</code>. Then re-check.</p>
                <Button className="mt-2" size="sm" variant="outline" onClick={async () => { await api("/api/health/recheck", { method: "POST" }); await health.reload(); }}>Re-check Claude</Button>
                {h.claude_error && <p className="mt-2 text-xs text-coral">{h.claude_error}</p>}
              </div>
              <p className="text-xs">Without Claude, answers are graded without a web-researched answer key.</p>
            </div>
          )}
        </Step>
      </ol>
    </Panel>
  );
}
