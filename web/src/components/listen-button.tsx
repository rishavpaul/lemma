"use client";
import { useEffect } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { speech, useSpeech } from "@/lib/speech";

const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];

/** Reads `text` aloud. `id` names what is being read so the button knows when it is the one playing. `controls` adds speed and voice pickers. */
export function ListenButton({ id, text, label = "Listen", controls, className }: { id: string; text: string; label?: string; controls?: boolean; className?: string }) {
  const s = useSpeech();
  useEffect(() => () => { if (speech.current() === id) speech.stop(); }, [id]);
  if (!s.supported) return null;
  const mine = s.playingId === id;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {!mine ? (
        <Button size="sm" variant="outline" onClick={() => speech.play(id, text)} disabled={!text.trim()}><Volume2 />{label}</Button>
      ) : (
        <>
          {s.paused
            ? <Button size="sm" variant="outline" onClick={() => speech.resume()}><Play />Resume</Button>
            : <Button size="sm" variant="outline" onClick={() => speech.pause()}><Pause />Pause</Button>}
          <Button size="sm" variant="ghost" onClick={() => speech.stop()} aria-label="Stop listening"><Square />Stop</Button>
        </>
      )}
      {controls && (
        <>
          <select className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Reading speed" value={s.rate} onChange={(e) => speech.setRate(Number(e.target.value))}>
            {RATES.map((r) => <option key={r} value={r}>{r}x</option>)}
          </select>
          {s.voices.length > 1 && (
            <select className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs" aria-label="Voice" value={s.voice} onChange={(e) => speech.setVoice(e.target.value)}>
              {s.engine === "browser" && <option value="">Auto voice</option>}
              {s.voices.map((v) => <option key={v.uri} value={v.uri}>{v.name}</option>)}
            </select>
          )}
        </>
      )}
    </span>
  );
}
