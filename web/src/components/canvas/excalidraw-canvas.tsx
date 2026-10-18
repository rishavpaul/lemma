"use client";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Diagram, SceneDiagram, SceneElement } from "@/lib/types";
import { emptyDiagram, isLegacy, legacyToSkeletons } from "./legacy";
import { TEMPLATES } from "./templates";

// Excalidraw loads its fonts from a CDN unless pointed elsewhere; the desktop app is offline (see scripts/sync-excalidraw-assets.mjs).
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

type Els = readonly { id: string; version: number; isDeleted?: boolean }[];

export interface CanvasHandle { getDiagram: () => SceneDiagram; flush: () => void }

export interface CanvasProps {
  initial: Diagram;
  readOnly?: boolean;
  onChange?: (d: SceneDiagram) => void;
  handleRef?: Ref<CanvasHandle>;
  className?: string;
}

// Element versions only ever increase, so their sum changes whenever anything is edited, moved or deleted.
const signature = (els: Els) => els.reduce((n, e) => n + e.version, els.length);
const live = (els: readonly unknown[]) => (els as SceneElement[]).filter((e) => !e.isDeleted);
const scene = (els: readonly unknown[]): SceneDiagram => ({ format: "excalidraw", elements: JSON.parse(JSON.stringify(live(els))) });
const fromInitial = (d: Diagram) => (isLegacy(d) ? convertToExcalidrawElements(legacyToSkeletons(d) as never) : (d.elements as never[]));

export default function ExcalidrawCanvas({ initial, readOnly = false, onChange, handleRef, className }: CanvasProps) {
  const { resolvedTheme } = useTheme();
  const initialEls = useMemo(() => fromInitial(initial ?? emptyDiagram()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [empty, setEmpty] = useState(live(initialEls).length === 0);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastSig = useRef(signature(initialEls as Els));
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const emit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!dirty.current || !apiRef.current) return;
    dirty.current = false;
    onChangeRef.current?.(scene(apiRef.current.getSceneElements()));
  }, []);
  useImperativeHandle(handleRef, () => ({
    getDiagram: () => scene(apiRef.current?.getSceneElements() ?? []),
    flush: emit,
  }), [emit]);
  useEffect(() => () => { if (!readOnly) emit(); }, [readOnly, emit]);

  const onSceneChange = useCallback((els: readonly unknown[]) => {
    const sig = signature(els as Els);
    if (sig === lastSig.current) return; // scrolling, zooming and selecting also fire this
    lastSig.current = sig;
    setEmpty(live(els).length === 0);
    if (readOnly) return;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(emit, 700);
  }, [readOnly, emit]);

  const onApi = useCallback((a: ExcalidrawImperativeAPI) => {
    apiRef.current = a;
    setApi(a);
  }, []);
  useEffect(() => {
    if (!api || live(initialEls).length === 0) return;
    const t = setTimeout(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.85, maxZoom: 1.1 }), 60);
    return () => clearTimeout(t);
  }, [api, initialEls]);

  const startFrom = (build: () => Diagram) => {
    if (!api) return;
    const els = fromInitial(build());
    api.updateScene({ elements: els as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setTimeout(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.8, maxZoom: 1, animate: true }), 30);
  };

  return (
    <div className={cn("sdc-excalidraw relative h-full w-full", className)}>
      <Excalidraw
        excalidrawAPI={onApi}
        initialData={{
          elements: initialEls as never,
          appState: {
            currentItemRoughness: 0, currentItemFontFamily: 6, currentItemRoundness: "round", currentItemFontSize: 18,
            currentItemFillStyle: "solid",
          },
        }}
        onChange={onSceneChange as never}
        viewModeEnabled={readOnly}
        theme={resolvedTheme === "light" ? "light" : "dark"}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false },
          tools: { image: false },
        }}
        autoFocus={false}
        handleKeyboardGlobally={false}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

      {empty && !readOnly && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 max-sm:pt-24">
          <div className="pointer-events-auto max-w-md rounded-[3px] bg-background p-7 shadow-2xl">
            <h3 className="font-serif text-[1.6rem] font-medium leading-tight">Draw while you talk</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              Pick a shape from the toolbar (or press R for a box, O for a circle, A for an arrow, T for text). Double-click a shape or arrow to
              label it. Draw arrows from one shape to another so they stay attached. The grader reads the whole diagram along with your answer.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <Button key={t.id} variant="outline" size="sm" title={t.blurb} onClick={() => startFrom(t.build)}>
                  Start from {t.title.toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
