import { cn } from "@/lib/utils";

/** The Lemma mark: code braces (blue, the coding track) around a small system diagram (amber, the design track). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-full", className)}>
      <path d="M19 10H17Q11 10 11 16V26Q11 32 5 32Q11 32 11 38V48Q11 54 17 54H19M45 10H47Q53 10 53 16V26Q53 32 59 32Q53 32 53 38V48Q53 54 47 54H45"
        fill="none" stroke="var(--code)" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 20L25 42M32 20L39 42" stroke="var(--signal)" strokeOpacity=".55" strokeWidth="2.6" strokeLinecap="round" />
      <g fill="var(--signal)"><circle cx="32" cy="20" r="4.6" /><circle cx="25" cy="42" r="4.6" /><circle cx="39" cy="42" r="4.6" /></g>
    </svg>
  );
}

/** The mark on its dark tile, as used in the sidebar and the sign-in screen. */
export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex size-10 items-center justify-center rounded-xl bg-ink p-1.5 ring-1 ring-white/10", className)}><LogoMark /></span>;
}

export const TAGLINE = "Design out loud. Code under pressure.";

/** Mark, name and tagline together: the masthead on Today and the sign-in screen. */
export function Wordmark({ className, tagline = true }: { className?: string; tagline?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Logo className="size-11" />
      <div className="leading-tight">
        <div className="text-[1.3rem] font-semibold leading-none tracking-tight">Lemma<span className="text-signal">.</span></div>
        {tagline && <div className="text-xs text-muted-foreground">{TAGLINE}</div>}
      </div>
    </div>
  );
}
