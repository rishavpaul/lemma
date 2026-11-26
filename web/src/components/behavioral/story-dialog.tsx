"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { Story } from "@/lib/behavioral";

const field = "w-full rounded-[3px] bg-card px-3 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** Create or edit one story: a short title you will recognise and your private prep notes (the judge sees them only as background). */
export function StoryDialog({ story, onClose, onSaved }: { story: Story | null; onClose: () => void; onSaved: (id: number) => void }) {
  const [title, setTitle] = useState(story?.title ?? "");
  const [notes, setNotes] = useState(story?.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      if (story) { await api(`/api/behavioral/stories/${story.id}`, { method: "PATCH", body: { title, notes } }); onSaved(story.id); }
      else { const r = await api<{ id: number }>("/api/behavioral/stories", { method: "POST", body: { title, notes } }); onSaved(r.id); }
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{story ? "Edit story" : "New story"}</DialogTitle></DialogHeader>
        <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} aria-label="Story title"
          placeholder="A name you will recognise, such as Payments database split" className={field + " h-10"} />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={10} aria-label="Story notes"
          placeholder={"Situation: the context in two lines\nTask: what you owned\nAction: the decisions you made and how you got others on board\nResult: the numbers (before and after)\nReflection: what you would do differently"}
          className={field + " py-2.5 font-serif text-[1.02rem] leading-relaxed"} />
        <p className="text-[13px] text-muted-foreground">One strong story can answer several questions. Aim for six to eight that together cover every competency.</p>
        <Button variant="lead" disabled={busy || !title.trim()} onClick={save}>{story ? "Save" : "Add story"}</Button>
      </DialogContent>
    </Dialog>
  );
}
