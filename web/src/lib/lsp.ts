import { LSPClient, languageServerExtensions, type Transport } from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import { api } from "@/lib/api";

export type LspStatus = "off" | "starting" | "ready" | "unavailable";
export type LspConnection = { extension: Extension; close: () => void };

/** The dev UI on :3000 cannot proxy WebSockets through Next's rewrites, so it talks to the API directly. */
function socketUrl(): string {
  const host = window.location.port === "3000" ? "127.0.0.1:8765" : window.location.host;
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${host}/api/code/lsp`;
}

/** Connect an attempt's editor to the Java language server. Resolves null (with a reason) when it is not installed or cannot start. */
export async function connectLsp(attemptId: number, onStatus: (s: LspStatus, reason?: string) => void): Promise<LspConnection | null> {
  onStatus("starting");
  const info = await api<{ available: boolean; reason?: string; rootUri?: string; fileUri?: string }>(`/api/code/attempts/${attemptId}/lsp`);
  if (!info.available || !info.rootUri || !info.fileUri) { onStatus("unavailable", info.reason); return null; }
  const ws = new WebSocket(socketUrl());
  const opened = await new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
    ws.onclose = () => resolve(false);
  });
  if (!opened) { onStatus("unavailable", "Could not reach the language server."); return null; }
  const handlers = new Set<(m: string) => void>();
  ws.onmessage = (e) => handlers.forEach((h) => h(String(e.data)));
  ws.onclose = () => onStatus("unavailable", "The language server stopped.");
  const transport: Transport = {
    send: (m) => ws.send(m),
    subscribe: (h) => { handlers.add(h); },
    unsubscribe: (h) => { handlers.delete(h); },
  };
  const client = new LSPClient({ rootUri: info.rootUri, extensions: languageServerExtensions(), timeout: 10000 }).connect(transport);
  client.initializing.then(() => onStatus("ready"), () => onStatus("unavailable", "The language server did not start."));
  return { extension: client.plugin(info.fileUri, "java"), close: () => { ws.onclose = null; client.disconnect(); ws.close(); } };
}
