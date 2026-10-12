import { cn } from "@/lib/utils";

export function Page({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-5 py-8 md:px-10", wide ? "max-w-[1280px]" : "max-w-[1040px]", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mb-8", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border bg-card p-4", className)}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[46ch] text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
