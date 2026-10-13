"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useSyncExternalStore } from "react";
import { BarChart3, BookOpenCheck, Gauge, Home, Library, Newspaper, Moon, Settings, Sun, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/use-api";
import type { Health, PlanUsage } from "@/lib/types";
import { fmtDate } from "@/lib/format";

const NAV = [
  { href: "/", label: "Today", icon: Home },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/questions", label: "Library", icon: Library },
  { href: "/articles", label: "Articles", icon: Newspaper },
  { href: "/usage", label: "Usage", icon: Gauge },
  { href: "/settings", label: "Settings", icon: Settings },
];

function PlanMeter() {
  const { data } = useApi<PlanUsage>("/api/plan_usage", () => 120_000);
  const L = data?.latest;
  if (!L) return null;
  const part = (label: string, u: number | null, resets: number | null) => {
    const pct = Math.round((u ?? 0) * 100);
    return (
      <div key={label} className="flex flex-col items-center gap-1" title={`${label} plan window: ${pct}% used, resets ${fmtDate(resets)}`}>
        <div className="h-9 w-1.5 overflow-hidden rounded-full bg-border">
          <div className={cn("w-full rounded-full", pct >= 90 ? "bg-coral" : pct >= 70 ? "bg-signal" : "bg-mint")} style={{ height: `${Math.min(pct, 100)}%`, marginTop: `${100 - Math.min(pct, 100)}%` }} />
        </div>
        <span className="num text-[10px] text-muted-foreground">{label}</span>
      </div>
    );
  };
  return <div className="hidden gap-3 md:flex">{part("5h", L.five_hour_util, L.five_hour_resets)}{part("7d", L.seven_day_util, L.seven_day_resets)}</div>;
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
        <div key={m} className="flex items-center gap-2 border-b border-coral/30 bg-coral/10 px-4 py-2 text-sm text-coral"><TriangleAlert className="size-4 shrink-0" />{m}</div>
      ))}
      {info && <div className="border-b border-signal/30 bg-signal/10 px-4 py-2 text-sm text-signal">{info}</div>}
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
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/session") || path.startsWith("/report") : path.startsWith(href));
  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav aria-label="Primary" className="order-last flex shrink-0 items-center justify-around border-t border-sidebar-border bg-sidebar px-2 py-1 md:order-first md:w-[68px] md:flex-col md:justify-start md:gap-1 md:border-r md:border-t-0 md:py-4">
        <Link href="/" className="mb-0 hidden size-10 items-center justify-center rounded-xl bg-signal text-signal-foreground md:mb-5 md:flex" title="Design Coach" aria-label="Design Coach home">
          <BookOpenCheck className="size-5" />
        </Link>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} title={label}
            className={cn("group flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              active(href) && "bg-sidebar-accent text-foreground")}>
            <Icon className={cn("size-[18px]", active(href) && "text-signal")} />
            {label}
          </Link>
        ))}
        <div className="mt-auto hidden flex-col items-center gap-4 md:flex">
          <PlanMeter />
          <button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle theme" title="Toggle theme"
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            {mounted && resolvedTheme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </button>
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HealthBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
