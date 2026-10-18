"use client";
import { useEffect } from "react";

/** Keeps the phone screen on while `active` (recording on a walk). A no-op where the Wake Lock API is missing, e.g. the desktop webview. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request("screen"); if (cancelled) void lock.release(); } catch { /* denied or low battery: recording still works */ }
    };
    // iOS drops the lock whenever the page is hidden, so take it again on return.
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); void lock?.release(); };
  }, [active]);
}
