"use client";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

/** Renders `children(open)` plus a confirm dialog that deletes the session (recordings, transcripts, grades, diagram). */
export function DeleteSession({ id, title, onDeleted, children }: {
  id: number; title: string; onDeleted: () => void; children: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await api(`/api/sessions/${id}`, { method: "DELETE" });
      toast.success("Session deleted");
      setOpen(false);
      onDeleted();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      {children(() => setOpen(true))}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              “{title}” (#{id}) will be removed with its recordings, transcripts, grades and diagram. Your progress stats will no longer
              include it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={confirm} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
