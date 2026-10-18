"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

export interface ProviderStatus { label: string; configured: boolean; hint: string; keys_url: string; from_env: boolean }
export type Providers = Record<string, ProviderStatus>;
interface ModelInfo { id: string; name: string; free: boolean; context: number | null; price: number | null }

export const CLAUDE_MODELS = ["opus", "sonnet", "fable", "haiku"];
const CUSTOM = "__custom__";
const field = "h-9 rounded-[3px] bg-card px-3 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-ring";

export function splitModel(v: string): { provider: string; model: string } {
  const i = v.indexOf(":");
  const p = i > 0 ? v.slice(0, i) : "";
  return p === "openrouter" || p === "groq" ? { provider: p, model: v.slice(i + 1) } : { provider: "claude", model: v };
}

const fmtModel = (m: ModelInfo) =>
  `${m.id}${m.free ? " (free)" : m.price != null ? ` ($${m.price.toFixed(2)}/M)` : ""}`;

/** Provider + model chooser. `value` is "opus" | "openrouter:vendor/model" | "groq:model" (| "default" when allowDefault). */
export function ModelPicker({ value, onChange, providers, claudeOnly, allowDefault, compact }: {
  value: string; onChange: (v: string) => void; providers: Providers | null; claudeOnly?: boolean; allowDefault?: boolean; compact?: boolean;
}) {
  const isDefault = allowDefault && value === "default";
  const { provider, model } = isDefault ? { provider: "default", model: "" } : splitModel(value);
  const hosted = provider === "openrouter" || provider === "groq";
  const list = useApi<ModelInfo[]>(hosted ? `/api/providers/${provider}/models` : null);
  const [custom, setCustom] = useState(false);
  const cls = compact ? "h-8 rounded-[3px] bg-muted px-2 text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-ring" : field;

  const known = list.data?.some((m) => m.id === model);
  const showCustom = hosted && (custom || (!!list.data && !!model && !known) || (!!list.error && !list.data));

  function pickProvider(p: string) {
    setCustom(false);
    if (p === "default") onChange("default");
    else if (p === "claude") onChange("sonnet");
    else onChange(`${p}:`);
  }
  const unconfigured = hosted && providers && !providers[provider]?.configured;

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "space-y-2"}>
      <div className={compact ? "contents" : "flex gap-2"}>
        <select className={cls + (compact ? "" : " w-36 shrink-0")} value={provider} onChange={(e) => pickProvider(e.target.value)} aria-label="Provider">
          {allowDefault && <option value="default">Default models</option>}
          <option value="claude">Claude</option>
          {!claudeOnly && Object.entries(providers ?? { openrouter: { label: "OpenRouter" }, groq: { label: "Groq" } }).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        {provider === "claude" && (
          <select className={cls + (compact ? "" : " min-w-0 flex-1")} value={model} onChange={(e) => onChange(e.target.value)} aria-label="Model">
            {CLAUDE_MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>
        )}
        {hosted && !showCustom && (
          <select className={cls + (compact ? " max-w-64" : " min-w-0 flex-1")} value={known ? model : ""} aria-label="Model" disabled={!list.data}
            onChange={(e) => e.target.value === CUSTOM ? setCustom(true) : onChange(`${provider}:${e.target.value}`)}>
            {!list.data && <option value="">Loading models…</option>}
            {list.data && !known && <option value="">Choose a model…</option>}
            {list.data?.map((m) => <option key={m.id} value={m.id}>{fmtModel(m)}</option>)}
            {list.data && <option value={CUSTOM}>Other (type an id)…</option>}
          </select>
        )}
        {showCustom && (
          <input className={cls + (compact ? " w-56" : " min-w-0 flex-1")} value={model} placeholder="model id" aria-label="Model id"
            onChange={(e) => onChange(`${provider}:${e.target.value.trim()}`)} />
        )}
      </div>
      {unconfigured && <p className="text-xs text-signal">No {providers![provider].label} key yet. Add one in Settings, or grading with this model will fail.</p>}
      {hosted && list.error && !list.data && <p className="text-xs text-muted-foreground">Could not load the model list ({list.error}). Type a model id instead.</p>}
    </div>
  );
}

export function useProviders() {
  return useApi<Providers>("/api/providers");
}

export async function saveKey(name: string, key: string): Promise<Providers> {
  return api<Providers>(`/api/providers/${name}/key`, { method: "PUT", body: { key } });
}
export async function removeKey(name: string): Promise<Providers> {
  return api<Providers>(`/api/providers/${name}/key`, { method: "DELETE" });
}
