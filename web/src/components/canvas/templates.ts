import type { LegacyDiagram, DiagramEdge, DiagramNode, NodeKind } from "@/lib/types";

const n = (id: string, kind: NodeKind, label: string, x: number, y: number, notes = ""): DiagramNode => ({
  id, type: "component", position: { x, y }, data: { kind, label, notes },
});
const e = (s: string, t: string, label = "", mode: "sync" | "async" = "sync", sh = "r", th = "l"): DiagramEdge => ({
  id: `${s}-${t}`, source: s, target: t, sourceHandle: sh, targetHandle: th, type: "labeled", data: { label, mode },
});

export interface Template { id: string; title: string; blurb: string; build: () => LegacyDiagram }

export const TEMPLATES: Template[] = [
  {
    id: "request-path",
    title: "Request path",
    blurb: "Client, load balancer, service, cache, database",
    build: () => ({
      nodes: [
        n("c", "client", "Client", 0, 120), n("lb", "load_balancer", "Load balancer", 250, 120),
        n("svc", "service", "API service", 500, 120), n("cache", "cache", "Cache", 750, 20), n("db", "database", "Primary DB", 750, 220),
      ],
      edges: [e("c", "lb", "HTTPS"), e("lb", "svc"), e("svc", "cache", "read-through"), e("svc", "db", "writes")],
    }),
  },
  {
    id: "async-pipeline",
    title: "Async pipeline",
    blurb: "Gateway, service, queue, workers, store",
    build: () => ({
      nodes: [
        n("c", "client", "Client", 0, 0), n("gw", "gateway", "API gateway", 250, 0), n("svc", "service", "Ingest service", 500, 0),
        n("q", "queue", "Work queue", 750, 0), n("w", "worker", "Worker pool", 750, 170), n("db", "database", "Store", 500, 170),
      ],
      edges: [e("c", "gw"), e("gw", "svc"), e("svc", "q", "enqueue", "async"), e("q", "w", "consume", "async", "b", "t"), e("w", "db", "writes", "sync", "l", "r")],
    }),
  },
];
