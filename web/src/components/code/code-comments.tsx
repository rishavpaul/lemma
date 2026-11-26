"use client";
import type { ReviewComment } from "@/lib/types";
import { checkText } from "@/components/code/inline-review";
import { cn } from "@/lib/utils";

const SEV_BAR: Record<ReviewComment["severity"], string> = { high: "bg-coral", medium: "bg-signal", low: "bg-muted-foreground/50" };
const KIND: Record<ReviewComment["kind"], string> = { bug: "Bug", performance: "Performance", staff_gap: "Staff bar", robustness: "Robustness", clarity: "Clarity" };
const TONE = { mint: "text-mint", coral: "text-coral", muted: "text-muted-foreground" } as const;

/** The review's comments as an index: the comments themselves are shown in the editor, under the code they are about. */
export function CommentIndex({ comments, onReveal }: { comments: ReviewComment[]; onReveal: (i: number) => void }) {
  const edits = comments.filter((c) => c.edit).length;
  return (
    <div>
      <p className="mb-3 text-[14px] text-muted-foreground">
        {comments.length} comment{comments.length === 1 ? "" : "s"} in your code{edits ? `, ${edits} with a change you can apply and then Run` : ""}. Click one to jump to it.
      </p>
      <ol className="space-y-1">
        {comments.map((c, i) => {
          const chk = c.edit ? checkText(c.edit.check) : null;
          return (
            <li key={i}>
              <button type="button" onClick={() => onReveal(i)} className="flex w-full items-baseline gap-3 rounded-[3px] px-2 py-1.5 text-left hover:bg-muted">
                <span aria-hidden className={cn("w-[3px] shrink-0 self-stretch rounded-[2px]", SEV_BAR[c.severity])} />
                <span className="w-24 shrink-0 text-[12px] font-semibold text-muted-foreground">{KIND[c.kind] ?? c.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.title}</span>
                  {c.line_start != null && <span className="num ml-2 text-[12px] text-muted-foreground">line {c.line_start}</span>}
                </span>
                {chk && <span className={cn("shrink-0 text-[12px]", TONE[chk.tone])}>{chk.text.replace("Tested: ", "")}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
