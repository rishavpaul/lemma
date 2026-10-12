export const mmss = (s: number) => {
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  return (neg ? "-" : "") + String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};
export const fmtDate = (t?: number | null) =>
  t ? new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
export const fmtDay = (t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
export const fmtNum = (n: number) => Math.round(n || 0).toLocaleString();
export const fmtTok = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n || 0));
export const fmtUsd = (n: number) => "$" + (n || 0).toFixed(2);
export const dimLabel = (k: string) => k.replace(/_/g, " ");
export const scoreTone = (s: number) => (s >= 3 ? "text-mint" : s >= 2 ? "text-signal" : "text-coral");

/** Local-day key, so streaks follow the user's calendar rather than UTC. */
export const dayKey = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function streakStats(startedAts: number[]) {
  const days = new Set(startedAts.map(dayKey));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const key = (d: Date) => dayKey(d.getTime() / 1000);
  const cursor = new Date(today);
  if (!days.has(key(cursor))) cursor.setDate(cursor.getDate() - 1); // today not done yet: streak still alive until midnight
  let current = 0;
  while (days.has(key(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const sorted = [...days].sort();
  let best = 0, run = 0, prev: Date | null = null;
  for (const k of sorted) {
    const d = new Date(k + "T12:00:00");
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, doneToday: days.has(key(today)), days };
}
