"use client";
import { useCallback, useState } from "react";
import { api } from "./api";
import { useApi } from "./use-api";

export type ProgramKind = "code" | "design" | "behavioral";
export type ProgramItem = { kind: ProgramKind; ref: string };
export type ProgramDetailItem = ProgramItem & {
  title: string; num: number | null; difficulty: string | null; status: "todo" | "attempted" | "done"; rating: string | null;
  /** Planned day, ISO date, or null when unscheduled. */
  day: string | null;
};
export type Program = {
  id: number; name: string; total: number; done: number; items: ProgramDetailItem[];
  /** Schedule: ISO dates, null when the program has no dates. `days` lists every date from start to end. */
  start_date: string | null; end_date: string | null; days: string[];
};

/** An ISO date as a local calendar day (new Date("2026-11-25") would be UTC midnight, the day before in the Americas). */
export function localDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const dayLabel = (iso: string) => localDay(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export const setItemDay = (programId: number, item: ProgramItem, day: string | null) =>
  api(`/api/programs/${programId}/items/day`, { method: "PUT", body: { kind: item.kind, ref: item.ref, day } });

const FOCUS_KEY = "lemma.focusProgram";

/** The programs list, fetched once per page and handed down to whatever needs it. */
export function usePrograms() {
  return useApi<Program[]>("/api/programs");
}

export function inProgram(p: Program, kind: ProgramKind, ref: string): boolean {
  return p.items.some((i) => i.kind === kind && i.ref === ref);
}

/** The program the Code and Questions pages are narrowed to, remembered across visits and shared by both pages. */
export function useFocus(): [number | null, (id: number | null) => void] {
  const [id, setId] = useState<number | null>(() => {
    try { const v = Number(localStorage.getItem(FOCUS_KEY)); return v > 0 ? v : null; } catch { return null; }
  });
  const set = useCallback((next: number | null) => {
    setId(next);
    try { if (next) localStorage.setItem(FOCUS_KEY, String(next)); else localStorage.removeItem(FOCUS_KEY); } catch { /* private window */ }
  }, []);
  return [id, set];
}

export const setMembership = (programId: number, item: ProgramItem, member: boolean) =>
  member
    ? api(`/api/programs/${programId}/items`, { method: "PUT", body: item })
    : api(`/api/programs/${programId}/items?kind=${item.kind}&ref=${encodeURIComponent(item.ref)}`, { method: "DELETE" });
