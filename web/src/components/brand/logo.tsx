import { cn } from "@/lib/utils";

/** The Lemma mark: code braces (blue, the coding track) around a small system diagram (ochre, the design track). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-full", className)}>
      <path d="M19 10H17Q11 10 11 16V26Q11 32 5 32Q11 32 11 38V48Q11 54 17 54H19M45 10H47Q53 10 53 16V26Q53 32 59 32Q53 32 53 38V48Q53 54 47 54H45"
        fill="none" stroke="var(--code)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 20L25 42M32 20L39 42" stroke="var(--signal)" strokeOpacity=".6" strokeWidth="2.8" strokeLinecap="round" />
      <g fill="var(--signal)"><circle cx="32" cy="20" r="4.8" /><circle cx="25" cy="42" r="4.8" /><circle cx="39" cy="42" r="4.8" /></g>
    </svg>
  );
}

/** The mark alone, sized by the caller. */
export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex size-8 shrink-0", className)}><LogoMark /></span>;
}

export const TAGLINE = "Design out loud. Code under pressure.";

/** "Lemma." set the way a theorem label is set: the name, then a full stop (in the design track's ochre). */
export function Wordmark({ className, tagline = true, size = "md" }: { className?: string; tagline?: boolean; size?: "md" | "lg" }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo className={size === "lg" ? "size-12" : "size-7"} />
      <div className="leading-none">
        <div className={cn("font-serif font-semibold tracking-tight", size === "lg" ? "text-[2.4rem]" : "text-[1.35rem]")}>Lemma<span className="text-signal">.</span></div>
        {tagline && <div className="mt-1.5 text-[13px] text-muted-foreground">{TAGLINE}</div>}
      </div>
    </div>
  );
}
