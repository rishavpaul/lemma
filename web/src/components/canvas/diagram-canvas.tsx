"use client";
import dynamic from "next/dynamic";
import type { CanvasHandle, CanvasProps } from "./excalidraw-canvas";

export type { CanvasHandle };

// Excalidraw touches window at import time, so it loads on the client only.
export const DiagramCanvas = dynamic<CanvasProps>(() => import("./excalidraw-canvas"), {
  ssr: false,
  loading: () => <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">Loading canvas…</div>,
});
