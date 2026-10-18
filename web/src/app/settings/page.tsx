"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Page, PageHeader, Section } from "@/components/shell/page-header";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { ModelPicker, useProviders, type Providers } from "@/components/model-picker";
import { KeyField } from "@/components/setup-guide";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { Health } from "@/lib/types";

type S = Record<string, string>;
const field = "h-9 w-full rounded-[3px] bg-card px-3 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-ring";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="grid gap-2 py-4 md:grid-cols-[300px_1fr] md:gap-10"><div><div className="text-[15px] font-semibold">{label}</div>{hint && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>}</div><div className="max-w-md">{children}</div></div>;
}

/** Paper (light), slate (dark), or whatever the Mac is set to. */
function Appearance() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const opts = [["light", "Paper", "#f5f5f1", "#1b1b18"], ["dark", "Slate", "#151513", "#ecebe4"], ["system", "Follow the Mac", "", ""]] as const;
  return (
    <Section title="Appearance">
      <div role="radiogroup" aria-label="Appearance" className="grid max-w-2xl gap-2 sm:grid-cols-3">
        {opts.map(([v, label, bg, fg]) => {
          const on = mounted && theme === v;
          return (
            <button key={v} type="button" role="radio" aria-checked={on} onClick={() => setTheme(v)}
              className={cn("rounded-[3px] p-3 text-left transition-colors", on ? "bg-[color-mix(in_oklch,var(--signal)_16%,var(--background))]" : "bg-card hover:bg-muted")}>
              <span aria-hidden className="mb-3 flex h-14 items-end overflow-hidden rounded-[2px] p-2 font-serif text-[1.5rem] leading-none" style={bg ? { background: bg, color: fg } : { background: "linear-gradient(90deg, #f5f5f1 50%, #151513 50%)", color: "#a35f00" }}>Aa</span>
              <span className="text-[14px] font-semibold">{label}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function KeyRow({ name, p, onChange }: { name: string; p: Providers[string]; onChange: (d: Providers) => void }) {
  return (
    <Row label={p.label} hint={p.configured ? undefined : "Free keys are available."}>
      <KeyField name={name} p={p} onChange={onChange} />
      {!p.configured && <a className="mt-1.5 inline-block text-[13px] underline underline-offset-4" href={p.keys_url} target="_blank" rel="noreferrer">Get a {p.label} key</a>}
    </Row>
  );
}

export default function SettingsPage() {
  const s = useApi<S>("/api/settings");
  const h = useApi<Health>("/api/health");
  const prov = useProviders();
  const [edited, setF] = useState<S | null>(null);
  const f = edited ?? s.data;
  const [saving, setSaving] = useState(false), [checking, setChecking] = useState(false);
  if (!f || !h.data) return <Page><Skeleton className="h-96 w-full" /></Page>;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const model = (k: string, claudeOnly = false, allowDefault = false) => <ModelPicker value={f[k]} onChange={(v) => set(k, v)} providers={prov.data} claudeOnly={claudeOnly} allowDefault={allowDefault} />;
  const hl = h.data;
  const ok = (v: boolean) => (v ? <span className="font-medium text-mint">Working</span> : <span className="font-medium text-coral">Not working</span>);

  async function save() {
    setSaving(true);
    try {
      const { model_research, model_section, model_holistic, model_improvement, model_code_gen, model_code_review, model_code_hint, claude_concurrency, show_feedback_live, claude_path, whisper_model, vocabulary } = f!;
      await api("/api/settings", { method: "PUT", body: { model_research, model_section, model_holistic, model_improvement, model_code_gen, model_code_review, model_code_hint, claude_concurrency, show_feedback_live, claude_path: claude_path.trim(), whisper_model: whisper_model.trim(), vocabulary } });
      toast.success("Settings saved");
    } catch (e) { toast.error("Could not save", { description: (e as Error).message }); }
    setSaving(false);
  }
  return (
    <Page>
      <PageHeader title="Settings" subtitle="Which model does which job, the speech model, and how Lemma looks. Everything is stored on this Mac." actions={<Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />}Save settings</Button>} />
      <Appearance />
      <Section title="Health">
        <dl className="grid gap-x-10 gap-y-3 text-[15px] sm:grid-cols-[300px_1fr]">
          <dt className="text-muted-foreground">Claude CLI</dt><dd>{ok(hl.claude_ok === true)} <span className="text-muted-foreground">{hl.claude_version} {hl.claude_path}</span>{hl.claude_error && <div className="mt-1 text-xs text-coral">{hl.claude_error}</div>}</dd>
          <dt className="text-muted-foreground">ffmpeg</dt><dd>{ok(hl.ffmpeg_ok)}</dd>
          <dt className="text-muted-foreground">Speech model</dt><dd>{hl.whisper_loaded ? <span className="font-medium text-mint">Loaded</span> : hl.whisper_loading ? <span className="font-medium text-signal">Loading</span> : <span className="font-medium text-coral">Not loaded</span>} {hl.whisper_error}</dd>
          <dt className="text-muted-foreground">Data directory</dt><dd className="break-all font-mono text-[13px]">{hl.data_dir}</dd>
        </dl>
        <Button className="mt-5" variant="outline" size="sm" disabled={checking} onClick={async () => { setChecking(true); try { await api("/api/health/recheck", { method: "POST" }); await h.reload(); } finally { setChecking(false); } }}>{checking && <Loader2 className="animate-spin" />}Re-check Claude</Button>
      </Section>
      <Section title="API keys">
        <p className="mb-2 max-w-[62ch] text-[14px] leading-relaxed text-muted-foreground">Keys are stored in the macOS Keychain on this Mac and only sent to the provider. They are never shown again after saving.</p>
        {prov.data && Object.entries(prov.data).map(([name, p]) => <KeyRow key={name} name={name} p={p} onChange={(d) => prov.setData(d)} />)}
      </Section>
      <Section title="Models and speech">
        <Row label="Research model" hint="Runs once per question and becomes the answer key. Needs live web search, so it runs on Claude only."><div>{model("model_research", true)}</div></Row>
        <Row label="Section grading model" hint="7 calls per session. Pick Claude, or a model from OpenRouter or Groq (free models work)."><div>{model("model_section")}</div></Row>
        <Row label="Overall grade model" hint="1 call per session: level, study plan and drill. Hardest judgment call, so test an open model before relying on it."><div>{model("model_holistic")}</div></Row>
        <Row label="Concepts review model" hint="1 call each time you press Find concepts to study on the Progress page. &quot;Default models&quot; uses the Overall grade model. You can also pick a model per run there."><div>{model("model_improvement", false, true)}</div></Row>
        <Row label="Coding: problem builder model" hint="Writes each coding problem, its reference and brute-force solutions and the test generator. Once per problem, and the app checks everything it writes by running it."><div>{model("model_code_gen")}</div></Row>
        <Row label="Coding: staff review model" hint="1 call each time you ask for the staff review of your code. This is the judgment call, so Opus is the default."><div>{model("model_code_review")}</div></Row>
        <Row label="Coding: coach hint model" hint="Short hints about your code while you are stuck."><div>{model("model_code_hint")}</div></Row>
        <Row label="Concurrent grading calls" hint="1 is safest for Claude plan limits and free-tier rate limits."><select className={field} value={f.claude_concurrency} onChange={(e) => set("claude_concurrency", e.target.value)}><option>1</option><option>2</option></select></Row>
        <Row label="Show feedback after each section" hint="Default for new sessions."><Switch checked={f.show_feedback_live === "1"} onCheckedChange={(v) => set("show_feedback_live", v ? "1" : "0")} /></Row>
        <Row label="Path to the claude CLI" hint="Leave empty to auto-detect."><input className={field} value={f.claude_path} placeholder="auto-detect" onChange={(e) => set("claude_path", e.target.value)} /></Row>
        <Row label="Whisper model" hint="A Hugging Face repo. Applies to the next transcription."><input className={field} value={f.whisper_model} onChange={(e) => set("whisper_model", e.target.value)} /></Row>
        <Row label="Speech vocabulary" hint="Comma-separated technical terms. Only the first 800 characters are used."><textarea className={field + " h-32 py-2"} value={f.vocabulary} onChange={(e) => set("vocabulary", e.target.value)} /></Row>
      </Section>
    </Page>
  );
}
