/**
 * The staff review inside the editor: each comment is a card under the code it is about, with its suggested change one click
 * away. Comments follow the code as it is edited: a comment is placed by the text it is about (the suggested change's `find`,
 * or its `replace` once applied, or the reviewed lines), not by a fixed line number. Applying a change is an ordinary editor
 * transaction, so Cmd+Z undoes it.
 */
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import type { ReviewComment, ReviewEditCheck } from "@/lib/types";

export type InlineComment = ReviewComment & { key: string; anchorText: string };
export type InlineReview = { id: number; comments: InlineComment[] } | null;

export const setReview = StateEffect.define<InlineReview>();
/** Expand one comment and scroll to it (from the Review tab's list). */
export const revealComment = StateEffect.define<string>();
const toggleComment = StateEffect.define<string>();

/** Raised on the editor's DOM after a change is applied or undone from a card, so the page can offer to run the tests. */
export const APPLIED_EVENT = "lemma-review-applied";

const KIND: Record<string, string> = { bug: "Bug", performance: "Performance", staff_gap: "Staff bar", robustness: "Robustness", clarity: "Clarity" };

export function checkText(c?: ReviewEditCheck): { text: string; tone: "mint" | "coral" | "muted" } | null {
  if (!c) return null;
  if (c.status === "passes") {
    const fixes = c.baseline_passed != null && c.total != null && c.baseline_passed < c.total;
    return { text: fixes ? `Tested: fixes the failing cases (${c.total}/${c.total})` : `Tested: all ${c.total} examples pass`, tone: "mint" };
  }
  if (c.status === "fails") return { text: `Tested: ${c.passed}/${c.total} examples pass with it`, tone: "coral" };
  if (c.status === "compile_error") return { text: "Tested: does not compile as written", tone: "coral" };
  return { text: "Not tested", tone: "muted" };
}

/** Where a comment sits in the current document: [from, to] of the text it is about, and whether its change is applied. */
export function place(doc: string, c: InlineComment): { from: number; to: number; applied: boolean } | null {
  const once = (s: string) => { const i = s ? doc.indexOf(s) : -1; return i >= 0 && doc.indexOf(s, i + 1) < 0 ? i : -1; };
  if (c.edit) {
    const i = once(c.edit.find);
    if (i >= 0) return { from: i, to: i + c.edit.find.length, applied: false };
    const j = c.edit.replace ? once(c.edit.replace) : -1;
    if (j >= 0) return { from: j, to: j + c.edit.replace.length, applied: true };
  }
  const k = c.anchorText.trim() ? doc.indexOf(c.anchorText) : -1;
  if (k >= 0) return { from: k, to: k + c.anchorText.length, applied: false };
  return null;
}

type ReviewState = { review: InlineReview; open: Set<string>; deco: DecorationSet };

class CommentWidget extends WidgetType {
  constructor(readonly c: InlineComment, readonly open: boolean, readonly applied: boolean, readonly at: { from: number; to: number } | null) { super(); }

  eq(o: CommentWidget) { return o.c.key === this.c.key && o.open === this.open && o.applied === this.applied && o.at?.from === this.at?.from && o.at?.to === this.at?.to; }

  ignoreEvent() { return true; }

  toDOM(view: EditorView) {
    const c = this.c, e = c.edit;
    const card = el("div", `cm-rv-card cm-rv-${c.severity}`);
    card.dataset.key = c.key;
    const body = el("div", "cm-rv-body");
    card.append(el("span", "cm-rv-bar"), body);
    const head = el("div", "cm-rv-head");
    const toggle = el("button", "cm-rv-title") as HTMLButtonElement;
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(this.open));
    toggle.append(el("span", "cm-rv-caret", this.open ? "▾" : "▸"), el("span", "cm-rv-kind", KIND[c.kind] ?? c.kind), el("span", "cm-rv-name", c.title));
    toggle.onclick = () => view.dispatch({ effects: toggleComment.of(c.key) });
    head.append(toggle);
    const chk = e ? checkText(e.check) : null;
    if (this.applied) head.append(el("span", "cm-rv-applied", "Applied"));
    else if (chk) head.append(el("span", `cm-rv-check cm-rv-${chk.tone}`, chk.text));
    if (e && this.at) {
      const btn = el("button", this.applied ? "cm-rv-btn cm-rv-ghost" : "cm-rv-btn", this.applied ? "Undo" : "Apply") as HTMLButtonElement;
      btn.type = "button";
      btn.onclick = () => {
        const insert = this.applied ? e.find : e.replace;
        view.dispatch({ changes: { from: this.at!.from, to: this.at!.to, insert }, userEvent: "input.review" });
        view.dom.dispatchEvent(new CustomEvent(APPLIED_EVENT, { detail: { title: c.title, undo: this.applied } }));
      };
      head.append(btn);
    }
    body.append(head);
    if (this.open) {
      body.append(el("p", "cm-rv-text", c.comment));
      if (e && !this.applied) {
        const diff = el("pre", "cm-rv-diff");
        for (const l of e.find.split("\n")) diff.append(el("div", "cm-rv-del", l || " "));
        if (e.replace) for (const l of e.replace.split("\n")) diff.append(el("div", "cm-rv-add", l || " "));
        body.append(diff);
      }
      if (e?.check?.status === "compile_error" && e.check.message) body.append(el("pre", "cm-rv-note", e.check.message));
      if (c.edit_problem) body.append(el("p", "cm-rv-note", `No one-click change: ${c.edit_problem}.`));
      if (e && !this.at) body.append(el("p", "cm-rv-note", "Your code has changed here since the review, so this change cannot be applied automatically."));
    }
    return card;
  }
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function build(state: EditorState, review: InlineReview, open: Set<string>): DecorationSet {
  if (!review) return Decoration.none;
  const doc = state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  for (const c of review.comments) {
    const p = place(doc, c);
    let lineEnd: number;
    if (p) lineEnd = state.doc.lineAt(Math.max(p.from, p.to - 1)).to;
    else if (c.line_end != null && c.line_end <= state.doc.lines) lineEnd = state.doc.line(c.line_end).to;  // best guess
    else lineEnd = 0;  // whole-solution comments sit above the code
    const top = !p && c.line_end == null;
    ranges.push(Decoration.widget({ widget: new CommentWidget(c, open.has(c.key), !!p?.applied, p && c.edit ? { from: p.from, to: p.to } : null), block: true, side: top ? -1 : 1 })
      .range(top ? 0 : lineEnd));
    if (p && !p.applied) {
      const a = state.doc.lineAt(p.from).number, b = state.doc.lineAt(Math.max(p.from, p.to - 1)).number;
      for (let n = a; n <= b; n++) ranges.push(Decoration.line({ class: `cm-rv-line cm-rv-line-${c.severity}` }).range(state.doc.line(n).from));
    }
  }
  return Decoration.set(ranges, true);
}

export const reviewField = StateField.define<ReviewState>({
  create: () => ({ review: null, open: new Set(), deco: Decoration.none }),
  update(v, tr) {
    let { review, open } = v;
    let dirty = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setReview)) { review = e.value; open = new Set(); dirty = true; }
      if (e.is(toggleComment) || e.is(revealComment)) {
        open = new Set(open);
        if (e.is(toggleComment) && open.has(e.value)) open.delete(e.value); else open.add(e.value);
        dirty = true;
      }
    }
    return dirty ? { review, open, deco: build(tr.state, review, open) } : v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** Scroll a comment's card into view after revealComment. */
export function scrollToComment(view: EditorView, key: string) {
  requestAnimationFrame(() => {
    const card = view.dom.querySelector<HTMLElement>(`.cm-rv-card[data-key="${CSS.escape(key)}"]`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

export const reviewTheme = EditorView.theme({
  ".cm-rv-card": {
    margin: "4px 8px 6px 4px", padding: "6px 10px", borderRadius: "3px", backgroundColor: "var(--background)",
    fontFamily: "var(--font-ui), system-ui, sans-serif", fontSize: "13px", lineHeight: "1.45", whiteSpace: "normal",
    display: "flex", gap: "10px",
  },
  ".cm-rv-bar": { width: "3px", flexShrink: "0", borderRadius: "2px", backgroundColor: "var(--rv-bar)" },
  ".cm-rv-body": { minWidth: "0", flex: "1 1 auto" },
  ".cm-rv-high": { "--rv-bar": "var(--coral)" },
  ".cm-rv-medium": { "--rv-bar": "var(--signal)" },
  ".cm-rv-low": { "--rv-bar": "color-mix(in oklch, var(--muted-foreground) 60%, transparent)" },
  ".cm-rv-head": { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
  ".cm-rv-title": { display: "flex", alignItems: "baseline", gap: "6px", minWidth: "0", flex: "1 1 auto", textAlign: "left", cursor: "pointer", color: "var(--foreground)", background: "none", border: "none", padding: "0" },
  ".cm-rv-caret": { color: "var(--muted-foreground)", width: "10px" },
  ".cm-rv-kind": { fontSize: "12px", fontWeight: "600", color: "var(--rv-bar)" },
  ".cm-rv-low .cm-rv-kind": { color: "var(--muted-foreground)" },
  ".cm-rv-name": { fontWeight: "600" },
  ".cm-rv-check": { fontSize: "12px" },
  ".cm-rv-mint": { color: "var(--mint)" }, ".cm-rv-coral": { color: "var(--coral)" }, ".cm-rv-muted": { color: "var(--muted-foreground)" },
  ".cm-rv-applied": { fontSize: "12px", color: "var(--mint)" },
  ".cm-rv-btn": { fontSize: "12px", fontWeight: "500", padding: "2px 10px", borderRadius: "3px", border: "none", cursor: "pointer", backgroundColor: "var(--code)", color: "var(--code-foreground)" },
  ".cm-rv-btn.cm-rv-ghost": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-rv-text": { margin: "6px 0 0 16px", color: "var(--muted-foreground)", whiteSpace: "pre-wrap", maxWidth: "75ch" },
  ".cm-rv-diff": { margin: "6px 0 2px 16px", padding: "4px 0", borderRadius: "2px", backgroundColor: "var(--card)", fontFamily: "var(--font-code), ui-monospace, monospace", fontSize: "12px", overflowX: "auto" },
  ".cm-rv-del": { padding: "0 8px", backgroundColor: "color-mix(in oklch, var(--coral) 14%, transparent)", whiteSpace: "pre" },
  ".cm-rv-add": { padding: "0 8px", backgroundColor: "color-mix(in oklch, var(--mint) 16%, transparent)", whiteSpace: "pre" },
  ".cm-rv-note": { margin: "6px 0 0 16px", fontSize: "12px", color: "var(--muted-foreground)", whiteSpace: "pre-wrap" },
  ".cm-rv-line-high": { backgroundColor: "color-mix(in oklch, var(--coral) 9%, transparent)" },
  ".cm-rv-line-medium": { backgroundColor: "color-mix(in oklch, var(--signal) 10%, transparent)" },
  ".cm-rv-line-low": { backgroundColor: "color-mix(in oklch, var(--muted-foreground) 8%, transparent)" },
});
