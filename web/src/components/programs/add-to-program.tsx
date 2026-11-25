"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { inProgram, setMembership, type Program, type ProgramItem } from "@/lib/programs";
import { cn } from "@/lib/utils";

/** A bookmark on a problem or question: which programs it belongs to, with a way to start a new one. */
export function AddToProgram({ item, programs, reload, className }: { item: ProgramItem; programs: Program[] | null; reload: () => void; className?: string }) {
  const [naming, setNaming] = useState(false), [name, setName] = useState("");
  const mine = (programs ?? []).filter((p) => inProgram(p, item.kind, item.ref));

  async function toggle(p: Program, member: boolean) {
    try { await setMembership(p.id, item, member); reload(); } catch (e) { toast.error((e as Error).message); }
  }
  async function create() {
    try {
      const { id } = await api<{ id: number }>("/api/programs", { method: "POST", body: { name } });
      await setMembership(id, item, true);
      setNaming(false); setName(""); reload();
      toast.success(`Added to ${name.trim()}`);
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button variant="ghost" size="icon-sm" className={className}
            aria-label={mine.length ? `In ${mine.map((p) => p.name).join(", ")}. Change programs` : "Add to a program"}
            title={mine.length ? `In ${mine.map((p) => p.name).join(", ")}` : "Add to a program"}>
            <Bookmark className={cn(mine.length && "fill-current")} />
          </Button>} />
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>Programs</DropdownMenuLabel>
          {(programs ?? []).map((p) => (
            <DropdownMenuCheckboxItem key={p.id} checked={inProgram(p, item.kind, item.ref)} onCheckedChange={(v) => toggle(p, Boolean(v))}>{p.name}</DropdownMenuCheckboxItem>
          ))}
          {programs?.length === 0 && <p className="px-1.5 py-1 text-[13px] text-muted-foreground">No programs yet.</p>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNaming(true)}>New program…</DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/programs/" />}>Manage programs</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {naming && (
        <Dialog open onOpenChange={(o) => { if (!o) setNaming(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>New program</DialogTitle></DialogHeader>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void create(); }} autoFocus
              placeholder="Name it, such as Stripe practical round" aria-label="Program name"
              className="h-10 rounded-[3px] bg-card px-3 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring" />
            <Button disabled={!name.trim()} onClick={create}>Create and add</Button>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A select that narrows a page to one program. Renders nothing until a program exists. */
export function FocusSelect({ programs, value, onChange, className }: { programs: Program[] | null; value: number | null; onChange: (id: number | null) => void; className?: string }) {
  if (!programs?.length) return null;
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label="Program" className={className}>
      <option value="">All, no program</option>
      {programs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.done} of {p.total})</option>)}
    </select>
  );
}
