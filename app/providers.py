"""OpenAI-compatible hosted providers (OpenRouter, Groq) and the API-key store.

A model setting is either a Claude alias ("sonnet", "opus", ...) or "<provider>:<model id>",
for example "openrouter:deepseek/deepseek-chat-v3.1:free" or "groq:openai/gpt-oss-120b".
"""
import asyncio
import json
import logging
import os
import re
import subprocess
import time
import urllib.error
import urllib.request

from . import config

log = logging.getLogger("coach.providers")

PROVIDERS = {
    "openrouter": {"label": "OpenRouter", "base": "https://openrouter.ai/api/v1", "env": "OPENROUTER_API_KEY",
                   "keys_url": "https://openrouter.ai/keys"},
    "groq": {"label": "Groq", "base": "https://api.groq.com/openai/v1", "env": "GROQ_API_KEY",
             "keys_url": "https://console.groq.com/keys"},
}
KEYCHAIN_SERVICE = "Lemma"
LEGACY_KEYCHAIN_SERVICES = ("InterviewCoach", "DesignCoach")  # earlier names; keys saved under them are still read
_KEY_RE = re.compile(r"^[A-Za-z0-9_\-\.]{8,300}$")
_NOT_CHAT = ("whisper", "tts", "guard", "orpheus", "playai", "embed", "moderation")


def parse_model(value: str) -> tuple[str | None, str]:
    """('openrouter', 'x/y') for provider models, (None, 'sonnet') for Claude aliases."""
    prov, sep, rest = (value or "").partition(":")
    if sep and prov in PROVIDERS and rest:
        return prov, rest
    return None, value


def valid_model_setting(value: str) -> bool:
    prov, _ = parse_model(value)
    return prov is not None and not any(c.isspace() for c in value)


# ---- key store: macOS Keychain, falling back to a 0600 file ----------------------------------

def _secrets_file():
    return config.CONFIG_DIR / ".secrets.json"


def _file_secrets() -> dict:
    try:
        return json.loads(_secrets_file().read_text())
    except (OSError, ValueError):
        return {}


def _keychain(*args: str, stdin: str | None = None) -> str | None:
    try:
        r = subprocess.run(["/usr/bin/security", *args], input=stdin, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def get_key(provider: str) -> str:
    env = os.environ.get(PROVIDERS[provider]["env"], "").strip()
    if env:
        return env
    v = next((k for k in (_keychain("find-generic-password", "-s", svc, "-a", provider, "-w") for svc in (KEYCHAIN_SERVICE, *LEGACY_KEYCHAIN_SERVICES)) if k), None)
    return v or _file_secrets().get(provider, "")


def set_key(provider: str, key: str) -> None:
    key = key.strip()
    if not _KEY_RE.match(key):
        raise ValueError("That does not look like an API key (unexpected characters or length).")
    # `security -i` reads the command from stdin so the key never appears in the process list.
    ok = _keychain("-i", stdin=f"add-generic-password -U -s {KEYCHAIN_SERVICE} -a {provider} -w {key}\n") is not None
    if ok and _keychain("find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", provider, "-w") == key:
        return
    data = _file_secrets()
    data[provider] = key
    f = _secrets_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data))
    f.chmod(0o600)


def delete_key(provider: str) -> None:
    for service in (KEYCHAIN_SERVICE, *LEGACY_KEYCHAIN_SERVICES):
        _keychain("delete-generic-password", "-s", service, "-a", provider)
    data = _file_secrets()
    if data.pop(provider, None) is not None:
        _secrets_file().write_text(json.dumps(data))


def key_status() -> dict:
    out = {}
    for p, meta in PROVIDERS.items():
        k = get_key(p)
        out[p] = {"label": meta["label"], "configured": bool(k), "hint": ("…" + k[-4:]) if k else "",
                  "keys_url": meta["keys_url"], "from_env": bool(os.environ.get(meta["env"]))}
    return out


# ---- HTTP -----------------------------------------------------------------------------------

class HttpError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:500]}")
        self.status, self.body = status, body


def _request(method: str, url: str, key: str = "", body: dict | None = None, timeout: float = 60) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Lemma/1.0"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if "openrouter.ai" in url:
        headers["HTTP-Referer"] = "http://localhost"
        headers["X-Title"] = "Lemma"
    req = urllib.request.Request(url, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read().decode("utf-8", "replace")) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise HttpError(0, f"network error: {getattr(e, 'reason', e)}") from None
    except ValueError as e:
        raise HttpError(0, f"bad JSON from provider: {e}") from None


def _err_text(e: HttpError) -> str:
    try:
        j = json.loads(e.body)
        err = j.get("error", j)
        msg = err.get("message") if isinstance(err, dict) else str(err)
        raw = (err.get("metadata") or {}).get("raw") if isinstance(err, dict) else None
        return f"HTTP {e.status}: {msg}" + (f" ({str(raw)[:300]})" if raw else "")
    except (ValueError, AttributeError):
        return str(e)


def _classify(e: HttpError) -> str:
    if e.status in (401, 403):
        return "auth"
    if e.status in (402, 413, 429):
        return "rate_limit"
    low = e.body.lower()
    if "rate limit" in low or "rate_limit" in low or "tokens per" in low or "quota" in low:
        return "rate_limit"
    return "other"


# ---- model lists and key test ----------------------------------------------------------------

def _list_models_sync(provider: str) -> list[dict]:
    base = PROVIDERS[provider]["base"]
    if provider == "openrouter":
        rows = _request("GET", f"{base}/models", get_key(provider))["data"]
        out = []
        for m in rows:
            params = m.get("supported_parameters") or []
            if (m.get("architecture") or {}).get("output_modalities", ["text"]) != ["text"]:
                continue
            if "structured_outputs" not in params and "response_format" not in params:
                continue
            pr = m.get("pricing") or {}
            free = m["id"].endswith(":free") or (str(pr.get("prompt")) == "0" and str(pr.get("completion")) == "0")
            try:
                per_m = (float(pr.get("prompt") or 0) + float(pr.get("completion") or 0)) * 1e6
            except ValueError:
                per_m = None
            out.append({"id": m["id"], "name": m.get("name") or m["id"], "free": free, "context": m.get("context_length"),
                        "price": None if free else per_m})
        out.sort(key=lambda m: (not m["free"], m["id"]))
        return out
    key = get_key(provider)
    if not key:
        raise HttpError(401, "no API key")
    rows = _request("GET", f"{base}/models", key)["data"]
    out = [{"id": m["id"], "name": m["id"], "free": True, "context": m.get("context_window"), "price": None}
           for m in rows if m.get("active", True) and not any(w in m["id"].lower() for w in _NOT_CHAT)]
    out.sort(key=lambda m: m["id"])
    return out


async def list_models(provider: str) -> list[dict]:
    try:
        return await asyncio.to_thread(_list_models_sync, provider)
    except HttpError as e:
        raise RuntimeError(_err_text(e)) from None


def _test_key_sync(provider: str, key: str) -> None:
    base = PROVIDERS[provider]["base"]
    # OpenRouter's model list is public, so use the key-info endpoint to actually check the key.
    _request("GET", f"{base}/key" if provider == "openrouter" else f"{base}/models", key, timeout=20)


async def test_key(provider: str, key: str) -> None:
    if not _KEY_RE.match(key):
        raise ValueError("That does not look like an API key (unexpected characters or length).")
    try:
        await asyncio.to_thread(_test_key_sync, provider, key)
    except HttpError as e:
        raise ValueError("The provider rejected this key." if e.status in (401, 403) else _err_text(e)) from None


# ---- structured chat call --------------------------------------------------------------------

def _extract_json(text: str):
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except ValueError:
        i, j = t.find("{"), t.rfind("}")
        if i >= 0 and j > i:
            return json.loads(t[i:j + 1])
        raise


def _chat_sync(provider: str, model: str, system: str, payload: str, schema: dict, timeout_s: int) -> dict:
    key = get_key(provider)
    if not key:
        raise HttpError(401, f"No {PROVIDERS[provider]['label']} API key set. Add one in Settings.")
    base = PROVIDERS[provider]["base"]
    system = (system + "\n\nReply with ONLY one JSON object, no prose and no code fences, that conforms to this JSON Schema:\n"
              + json.dumps(schema))
    body = {"model": model, "temperature": 0.2,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": payload}]}
    if provider == "openrouter":
        body["usage"] = {"include": True}
    attempts = [{"type": "json_schema", "json_schema": {"name": "result", "schema": schema}}, {"type": "json_object"}]
    last: HttpError | None = None
    for i, fmt in enumerate(attempts):
        b = dict(body, response_format=fmt)
        if provider == "openrouter" and i == 0:
            b["provider"] = {"require_parameters": True}
        try:
            return _request("POST", f"{base}/chat/completions", key, b, timeout=timeout_s)
        except HttpError as e:
            last = e
            # A model/provider without json_schema support answers 400/404; retry in plain JSON mode.
            if e.status in (400, 404, 422) and i == 0:
                continue
            raise
    raise last  # type: ignore[misc]


async def chat_json(provider: str, model: str, system: str, payload: str, schema: dict, timeout_s: int) -> dict:
    """Same result shape as grader._once."""
    t0 = time.time()

    def fail(kind: str, msg: str, raw=None) -> dict:
        return {"ok": False, "structured": None, "raw": raw, "error_kind": kind, "error": msg, "duration_s": time.time() - t0}

    try:
        data = await asyncio.wait_for(asyncio.to_thread(_chat_sync, provider, model, system, payload, schema, timeout_s), timeout_s + 5)
    except TimeoutError:
        return fail("timeout", f"timed out after {timeout_s}s")
    except HttpError as e:
        return fail(_classify(e), _err_text(e), {"status": e.status, "body": e.body[:2000]})
    choice = (data.get("choices") or [{}])[0]
    if data.get("error"):
        return fail("other", str(data["error"])[:500], data)
    text = ((choice.get("message") or {}).get("content")) or ""
    u = data.get("usage") or {}
    raw = {"provider": provider, "model": data.get("model", model), "id": data.get("id"), "finish_reason": choice.get("finish_reason"),
           "content": text[:100000],
           "usage": {"input_tokens": u.get("prompt_tokens", 0), "output_tokens": u.get("completion_tokens", 0)},
           "total_cost_usd": u.get("cost") or 0, "num_turns": 1}
    try:
        obj = _extract_json(text)
    except ValueError:
        why = "the response was cut off (max length)" if choice.get("finish_reason") == "length" else "the response was not valid JSON"
        return fail("schema", f"{why}: {text[:200]!r}", raw)
    if not isinstance(obj, dict):
        return fail("schema", "the response was not a JSON object", raw)
    return {"ok": True, "structured": obj, "raw": raw, "error_kind": None, "error": None, "duration_s": time.time() - t0}


_SKIP = ("vision", "-vl", "coder", "embed", "audio", "image", "guard", "tts", "whisper", "safeguard", "gemma-3n", "nano")


def recommend(models: list[dict]) -> str | None:
    """Pick a capable default for grading: the largest text model with a long enough context, free ones first."""
    best, best_score = None, -1.0
    for m in models:
        mid = m["id"].lower()
        if any(w in mid for w in _SKIP) or (m.get("context") or 0) < 32000:
            continue
        sizes = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)b", mid)]
        # "a22b"-style active-parameter counts must not outrank the total size, so use the largest number.
        score = max(sizes, default=30.0) + (1000 if m.get("free") else 0)
        if score > best_score:
            best, best_score = m["id"], score
    return best
