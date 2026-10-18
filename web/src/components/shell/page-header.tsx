import { cn } from "@/lib/utils";

export function Page({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-5 pb-24 pt-8 md:px-8 md:pt-12", wide ? "max-w-[1320px]" : "max-w-[1080px]", className)}>{children}</div>;
}

/** The page title, set large in the text face, with one line under it and the page's actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="rise mb-12 flex flex-wrap items-end justify-between gap-x-8 gap-y-5 md:mb-16">
      <div className="min-w-0">
        <h1 className="display text-[2.6rem] md:text-[3.75rem]">{title}</h1>
        {subtitle && <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A section of a page: a heading in the text face, an optional aside on the right, then its content. */
export function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mb-16", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[1.55rem] font-medium tracking-tight">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A surface one tone step off the page. No border, no shadow. */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[3px] bg-card p-5", className)}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[3px] bg-card px-6 py-10">
      <p className="font-serif text-xl">{title}</p>
      {children && <div className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * The theorem style of a mathematics paper: a bold run-in label ("Lemma 4", "Remark", "Problem 146"), an optional
 * name in parentheses, then the statement in italic.
 */
export function Statement({ label, name, children, className, tone }: {
  label: string; name?: React.ReactNode; children?: React.ReactNode; className?: string; tone?: "design" | "code";
}) {
  return (
    <p className={cn("statement", className)}>
      <span className={cn("runin", tone === "design" && "text-signal", tone === "code" && "text-code")}>{label}</span>
      {name && <span className="not-italic"> ({name})</span>}
      <span className="runin">. </span>
      {children}
    </p>
  );
}

/** The end-of-proof mark. Filled when the thing is done, hollow while it is open. */
export function Tomb({ done = true, className, label }: { done?: boolean; className?: string; label?: string }) {
  return (
    <span {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} className={cn("inline-block size-[0.62em] translate-y-[0.02em] align-baseline", done ? "bg-current" : "border-[1.5px] border-current", className)} />
  );
}
