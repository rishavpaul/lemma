import type { Diagram, LegacyDiagram, SceneDiagram } from "@/lib/types";

export const emptyDiagram = (): SceneDiagram => ({ format: "excalidraw", elements: [] });
export const isLegacy = (d: Diagram): d is LegacyDiagram => "nodes" in d && !("elements" in d);
export const diagramSize = (d: Diagram | null | undefined): number =>
  !d ? 0 : isLegacy(d) ? d.nodes.length : d.elements.filter((e) => !e.isDeleted).length;

const W = 180, H = 64;
const ROUND = new Set(["database", "cache", "object_store"]);
const LOOK = { roughness: 0, fontFamily: 6 }; // clean lines and the Nunito face, matching what the editor draws with

/** Where the line from a shape's centre toward (tx, ty) leaves the shape's outline. */
function edgePoint(cx: number, cy: number, w: number, h: number, round: boolean, tx: number, ty: number) {
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = round ? 1 / Math.hypot(dx / (w / 2), dy / (h / 2)) : Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Excalidraw element skeletons (the input of convertToExcalidrawElements) for a diagram from the earlier canvas. */
export function legacyToSkeletons(d: LegacyDiagram): Record<string, unknown>[] {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const abs = (id: string): { x: number; y: number } => {
    const n = byId.get(id);
    if (!n) return { x: 0, y: 0 };
    const p = n.parentId && byId.has(n.parentId) ? abs(n.parentId) : { x: 0, y: 0 };
    return { x: n.position.x + p.x, y: n.position.y + p.y };
  };
  const size = (id: string) => {
    const n = byId.get(id)!;
    return { w: n.width ?? (n.type === "boundary" ? 360 : W), h: n.height ?? (n.type === "boundary" ? 240 : H) };
  };
  const out: Record<string, unknown>[] = [];
  const ordered = [...d.nodes].sort((a, b) => Number(b.type === "boundary") - Number(a.type === "boundary"));
  for (const n of ordered) {
    const { x, y } = abs(n.id);
    const { w, h } = size(n.id);
    if (n.type === "note") {
      if (n.data.label) out.push({ type: "text", id: n.id, x, y, text: n.data.label, fontSize: 16, ...LOOK });
    } else if (n.type === "boundary") {
      out.push({ type: "rectangle", id: n.id, x, y, width: w, height: h, strokeStyle: "dashed", backgroundColor: "transparent", ...LOOK });
      if (n.data.label) out.push({ type: "text", id: `${n.id}_label`, x: x + 12, y: y + 8, text: n.data.label, fontSize: 18, ...LOOK });
    } else {
      out.push({
        type: ROUND.has(n.data.kind) ? "ellipse" : "rectangle", id: n.id, x, y, width: w, height: h, ...LOOK,
        ...(n.data.label ? { label: { text: n.data.label, fontSize: 18, fontFamily: 6 } } : {}),
      });
    }
  }
  for (const e of d.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const a = abs(e.source), b = abs(e.target), sa = size(e.source), sb = size(e.target);
    const ca = { x: a.x + sa.w / 2, y: a.y + sa.h / 2 }, cb = { x: b.x + sb.w / 2, y: b.y + sb.h / 2 };
    const p1 = edgePoint(ca.x, ca.y, sa.w, sa.h, ROUND.has(byId.get(e.source)!.data.kind), cb.x, cb.y);
    const p2 = edgePoint(cb.x, cb.y, sb.w, sb.h, ROUND.has(byId.get(e.target)!.data.kind), ca.x, ca.y);
    out.push({
      type: "arrow", id: e.id, x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y, ...LOOK,
      start: { id: e.source }, end: { id: e.target },
      ...(e.data.mode === "async" ? { strokeStyle: "dashed" } : {}),
      ...(e.data.label ? { label: { text: e.data.label, fontSize: 14, fontFamily: 6 } } : {}),
    });
  }
  return out;
}
