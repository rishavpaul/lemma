"use client";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State = "checking" | "ok" | "needs-token";

/**
 * On the Mac (desktop app or localhost) the API trusts the request and this renders the app straight away.
 * Over Tailscale the API wants the shared token: it is read from `#token=...` in the URL (the fragment never reaches
 * the server), or typed in once, and then lives in an HttpOnly cookie.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login(t: string) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t }) });
      if (!r.ok) throw new Error(r.status === 401 ? "That token is not right." : r.statusText);
      setState("ok");
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = /[#&]token=([^&]+)/.exec(window.location.hash);
      if (m) history.replaceState(null, "", window.location.pathname + window.location.search);
      try {
        const s = await (await fetch("/api/auth/status")).json() as { required: boolean; authed: boolean };
        if (!alive) return;
        if (s.authed) { setState("ok"); return; }
        if (m) { await login(decodeURIComponent(m[1])); return; }
        setState("needs-token");
      } catch { if (alive) setState("ok"); } // API unreachable: let the app's own error handling say so
    })();
    return () => { alive = false; };
  }, []);

  if (state === "ok") return <>{children}</>;
  if (state === "checking") return <div className="h-full" aria-busy="true" />;
  return (
    <div className="flex h-full items-center justify-center p-6">
      <form className="rise w-full max-w-sm space-y-5" onSubmit={(e) => { e.preventDefault(); void login(token.trim()); }}>
        <h1><Wordmark size="lg" /></h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">Enter the access token from your Mac. Run <code className="font-mono text-[13px]">./scripts/mobile.sh</code> there to see it.</p>
        <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus />
        {error && <p className="text-sm text-coral">{error}</p>}
        <Button type="submit" variant="design" size="lg" disabled={busy || !token.trim()} className="w-full">{busy ? "Checking…" : "Continue"}</Button>
      </form>
    </div>
  );
}
