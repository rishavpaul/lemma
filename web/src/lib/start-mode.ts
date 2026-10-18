"use client";
import { useSyncExternalStore } from "react";

/** How a new session is run. Remembered per device, but always shown and chosen on the screens that start a session. */
export type StartMode = "full" | "interactive";
const KEY = "sdc.mode";
let mode: StartMode = "full";
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { if (localStorage.getItem(KEY) === "interactive") mode = "interactive"; } catch { /* private mode */ }
}
export function setStartMode(m: StartMode) {
  mode = m;
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { load(); listeners.add(l); l(); return () => { listeners.delete(l); }; }
export function useStartMode(): StartMode { return useSyncExternalStore(subscribe, () => mode, () => "full" as StartMode); }
/** Body fields to merge into POST /api/sessions. */
export const modeBody = (m: StartMode) => ({ interactive: m === "interactive" });
