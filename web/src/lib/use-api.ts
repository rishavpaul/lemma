"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Fetch on mount; optionally poll while `refreshMs(data)` returns a number. Keeps stale data during refetch. */
export function useApi<T>(path: string | null, refreshMs?: (d: T) => number | false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const refreshRef = useRef(refreshMs);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { refreshRef.current = refreshMs; });

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (!alive.current) return;
      setData(d);
      setError(null);
      const next = refreshRef.current?.(d);
      if (timer.current) clearTimeout(timer.current);
      if (next) timer.current = setTimeout(() => loadRef.current(), next);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    alive.current = true;
    const start = setTimeout(() => void load(), 0); // deferred so React Strict Mode's double mount fetches once
    return () => {
      alive.current = false;
      clearTimeout(start);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
