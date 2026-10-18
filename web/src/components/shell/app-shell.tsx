"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/use-api";
import type { Health, PlanUsage } from "@/lib/types";
import { fmtDate } from "@/lib/format";

/**
 * A running head, the way a paper has one: the name, then the pages, grouped by track. System design pages carry the
 * ochre rule when active, the coding page the blue one. Usage and Settings are shared. On a phone the same links sit
 * in a bar at the bottom, within reach of a thumb.
 */
type NavItem = { href: string; label: string; track: "design" | "code" | null };
const NAV: { group: string | null; track: "design" | "code" | null; items: NavItem[] }[] = [
  { group: null, track: null, items: [{ href: "/", label: "Today", track: null }] },
  { group: "Design", track: "design", items: [
    { href: "/questions", label: "Questions", track: "design" },
    { href: "/progress", label: "Progress", track: "design" },
    { href: "/articles", label: "Articles", track: "design" },
  ] },
  { group: "Code", track: "code", items: [{ href: "/code", label: "Problems", track: "code" }] },
];
const UTIL: NavItem[] = [{ href: "/usage", label: "Usage", track: null }, { href: "/settings", label: "Settings", track: null }];
const rule = (t: NavItem["track"]) => (t === "design" ? "bg-signal" : t === "code" ? "bg-code" : "bg-foreground");

function NavLink({ item, active, compact }: { item: NavItem; active: boolean; compact?: boolean }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined}
      className={cn("group relative flex shrink-0 items-center whitespace-nowrap font-medium transition-colors",
        compact ? "h-12 px-3 text-[13px]" : "h-14 px-2.5 text-[14px]",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {item.label}
      <span aria-hidden className={cn("absolute inset-x-2.5 h-[3px] origin-left transition-transform duration-300",
        compact ? "top-0" : "bottom-0", rule(item.track), active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100 group-hover:opacity-40")} />
    </Link>
  );
}

/** Claude plan use, as two plain figures. Turns ochre past 70% and red past 90%. */
function PlanMeter() {
  const { data } = useApi<PlanUsage>("/api/plan_usage", () => 120_000);
  const L = data?.latest;
  if (!L) return null;
  const part = (label: string, u: number | null, resets: number | null) => {
    const pct = Math.round((u ?? 0) * 100);
    return (
      <span key={label} title={`${label} plan window: ${pct}% used, resets ${fmtDate(resets)}`} className="whitespace-nowrap">
        <span className="text-muted-foreground">{label} </span>
        <span className={cn("num font-medium", pct >= 90 ? "text-coral" : pct >= 70 ? "text-signal" : "text-foreground")}>{pct}%</span>
      </span>
    );
  };
  return <Link href="/usage" className="hidden items-center gap-3 text-[13px] lg:flex" aria-label="Claude plan use">{part("5h", L.five_hour_util, L.five_hour_resets)}{part("7d", L.seven_day_util, L.seven_day_resets)}</Link>;
}

function HealthBanner() {
  const { data } = useApi<Health>("/api/health", (h) => (h.claude_ok === null || h.whisper_loading ? 3000 : 60_000));
  if (!data) return null;
  const msgs: string[] = [];
  if (data.claude_ok === false) msgs.push(`Claude CLI problem: ${data.claude_error ?? "not available"}. Research and any Claude-model grading are paused until this is fixed (run \`claude\`, then /login). Grading with OpenRouter or Groq models still works.`);
  if (!data.ffmpeg_ok) msgs.push("ffmpeg not found. Run: brew install ffmpeg");
  if (data.whisper_error) msgs.push(`Speech model error: ${data.whisper_error}`);
  const info = !msgs.length && data.whisper_loading ? "Loading the speech model. The first run downloads about 1.5 GB." : null;
  if (!msgs.length && !info) return null;
  return (
    <div className="flex flex-col">
      {msgs.map((m) => (
        <div key={m} className="bg-coral px-5 py-2.5 text-[13px] font-medium text-white md:px-8 dark:text-ink">{m}</div>
      ))}
      {info && <div className="bg-signal px-5 py-2.5 text-[13px] font-medium text-signal-foreground md:px-8">{info}</div>}
    </div>
  );
}

interface DesktopApi { open_external(url: string): Promise<void>; save_text(name: string, text: string): Promise<boolean> }

/** WKWebView has no browser chrome, so give the desktop app Cmd/Ctrl+R to refresh. */
function useReloadShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") { e.preventDefault(); window.location.reload(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** In the desktop app (WKWebView) target=_blank does nothing, so route those clicks to the native shell. */
function useDesktopLinks() {
  useEffect(() => {
    const onClick = async (e: MouseEvent) => {
      const desktop = (window as unknown as { pywebview?: { api?: DesktopApi } }).pywebview?.api;
      const a = (e.target as Element | null)?.closest?.("a[target=_blank]") as HTMLAnchorElement | null;
      if (!desktop || !a) return;
      e.preventDefault();
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) { void desktop.open_external(url.href); return; }
      try {
        const r = await fetch(url.pathname + url.search);
        const name = url.pathname.split("/").pop() || "download.txt";
        await desktop.save_text(name === "export.md" ? `session-${url.pathname.split("/")[3]}.md` : name, await r.text());
      } catch { /* the toast layer is not worth a dependency here */ }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  useDesktopLinks();
  useReloadShortcut();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/session") || path.startsWith("/report") : path.startsWith(href));
  const all = [...NAV.flatMap((g) => g.items), ...UTIL];
  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:bg-foreground focus:px-3 focus:py-2 focus:text-background">Skip to content</a>
      <header className="hidden shrink-0 items-center gap-6 px-8 md:flex">
        <Link href="/" aria-label="Lemma, today" className="mr-2 flex items-center gap-2">
          <Logo className="size-6" />
          <span className="font-serif text-[1.2rem] font-semibold tracking-tight">Lemma<span className="text-signal">.</span></span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-5">
          {NAV.map(({ group, track, items }) => (
            <div key={group ?? "home"} className="flex items-center">
              {group && <span className={cn("mr-1 text-[14px] font-semibold", track === "design" ? "text-signal" : "text-code")}>{group}</span>}
              {items.map((it) => <NavLink key={it.href} item={it} active={active(it.href)} />)}
            </div>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <PlanMeter />
          <nav aria-label="Utility" className="flex items-center">{UTIL.map((it) => <NavLink key={it.href} item={it} active={active(it.href)} />)}</nav>
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HealthBanner />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <nav aria-label="Primary" className="no-scrollbar flex shrink-0 overflow-x-auto bg-card px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        {all.map((it) => <NavLink key={it.href} item={it} active={active(it.href)} compact />)}
      </nav>
    </div>
  );
}
