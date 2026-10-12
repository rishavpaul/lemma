"""The only place that calls a model: the `claude` CLI (print mode, subscription login) or an
OpenAI-compatible provider (see providers.py)."""
import asyncio
import json
import logging
import os
import pwd
import re
import shutil
import time
from pathlib import Path
from typing import Callable

from . import config, db, providers

log = logging.getLogger("coach.grader")

STRIPPED_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
                "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY")
_children: set = set()  # live `claude -p` subprocesses, killed on shutdown so they don't linger as orphans
DISALLOWED = "Bash,Read,Write,Edit,Glob,Grep,NotebookEdit,Task,Agent"

_health: dict = {"claude_ok": None, "version": None, "error": None, "path": None, "checked_at": None}


def find_claude(override: str = "") -> str | None:
    if override:
        return override if Path(override).expanduser().exists() else None
    found = shutil.which("claude")
    if found:
        return found
    for p in ("~/.claude/local/claude", "/opt/homebrew/bin/claude", "~/.local/bin/claude"):
        p = str(Path(p).expanduser())
        if Path(p).exists():
            return p
    return None


def kill_children() -> None:
    for proc in list(_children):
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    _children.clear()


def _drop_cli_transcript(session_id: str | None) -> None:
    """`claude -p` keeps a transcript of every call under ~/.claude/projects/<sandbox>/. The result is already stored, so remove it."""
    if not session_id or not str(session_id).replace("-", "").isalnum():
        return
    root = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    folder = root / re.sub(r"[^A-Za-z0-9]", "-", str(config.SANDBOX_DIR))
    try:
        (folder / f"{session_id}.jsonl").unlink(missing_ok=True)
    except OSError:
        pass


def clean_env() -> dict:
    env = {k: v for k, v in os.environ.items() if k not in STRIPPED_ENV}
    # The claude CLI finds its login in the Keychain by $USER, and an app started from Finder may not have it.
    user = env.get("USER") or env.get("LOGNAME") or pwd.getpwuid(os.getuid()).pw_name
    env["USER"] = env["LOGNAME"] = user
    env.setdefault("HOME", str(Path.home()))
    return env


def _classify(text: str) -> str:
    t = (text or "").lower()
    if any(w in t for w in ("usage limit", "rate limit", "rate_limit", "limit reached", "too many requests", "overloaded", "429")):
        return "rate_limit"
    if any(w in t for w in ("not logged in", "please run /login", "login", "authenticat", "unauthorized", "401", "invalid api key")):
        return "auth"
    return "other"


def _fail(kind: str, error: str, raw, dur: float) -> dict:
    return {"ok": False, "structured": None, "raw": raw, "error_kind": kind, "error": error, "duration_s": dur}


async def _once(kind: str, system_prompt: str, payload: str, schema: dict, model: str,
                timeout_s: int, claude_path: str, web: bool = True) -> dict:
    path = find_claude(claude_path)
    t0 = time.time()
    if not path:
        return _fail("other", "claude CLI not found", None, 0.0)
    config.SANDBOX_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [path, "-p", "--system-prompt", system_prompt, "--output-format", "stream-json", "--verbose",
           "--json-schema", json.dumps(schema), "--model", model,
           "--tools", "WebSearch,WebFetch" if web else "", "--strict-mcp-config",
           "--allowedTools", "WebSearch,WebFetch" if web else "", "--disallowedTools", DISALLOWED,
           "--permission-mode", "dontAsk",
           # no CLAUDE.md, hooks, plugins or skills from the user's setup: grading must not depend on them, and they cost tokens
           "--safe-mode", "--disable-slash-commands"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, cwd=str(config.SANDBOX_DIR), env=clean_env())
    except OSError as e:
        return _fail("other", f"cannot start claude: {e}", None, time.time() - t0)
    _children.add(proc)
    try:
        out, err = await asyncio.wait_for(proc.communicate(payload.encode()), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return _fail("timeout", f"timed out after {timeout_s}s", None, time.time() - t0)
    except asyncio.CancelledError:
        proc.kill()
        raise
    finally:
        _children.discard(proc)
    dur = time.time() - t0
    stdout, stderr = out.decode(errors="replace"), err.decode(errors="replace")
    data, limits = None, None
    for line in stdout.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(ev, dict):
            continue
        if ev.get("type") == "result":
            data = ev
        elif ev.get("type") == "rate_limit_event":
            limits = ev.get("rate_limit_info")
    if limits:
        db.record_plan_usage(limits)
    if data is not None:
        _drop_cli_transcript(data.get("session_id"))
    if data is None:
        text = (stderr or stdout)[:2000]
        return _fail(_classify(text), text or f"exit {proc.returncode}, no result event", stdout[:2000], dur)
    if proc.returncode != 0 or data.get("is_error"):
        text = str(data.get("result") or stderr or data.get("subtype"))[:2000]
        kind = _classify(text + " " + str(data.get("subtype", "")))
        if limits and limits.get("status") not in (None, "allowed", "allowed_warning"):
            kind = "rate_limit"
        return _fail(kind, text, data, dur)
    if not isinstance(data.get("structured_output"), dict):
        return _fail("schema", "no structured_output in response", data, dur)
    return {"ok": True, "structured": data["structured_output"], "raw": data, "error_kind": None,
            "error": None, "duration_s": dur}


async def run_claude(kind: str, system_prompt: str, payload: str, schema: dict, model: str,
                     timeout_s: int, claude_path: str = "",
                     validator: Callable[[dict], str | None] | None = None, ref: dict | None = None, web: bool = True) -> dict:
    """Run one structured call. `validator` returns an error string (or None); on failure retry once
    with the error appended to the payload."""
    ref = ref or {}
    provider, provider_model = providers.parse_model(model)

    async def once(payload: str) -> dict:
        if provider:
            return await providers.chat_json(provider, provider_model, system_prompt, payload, schema, timeout_s)
        return await _once(kind, system_prompt, payload, schema, model, timeout_s, claude_path, web)

    def tracked(r: dict) -> dict:
        db.record_call(kind, model, r["ok"], r["error_kind"], r["duration_s"], r["raw"], ref.get("session_id"), ref.get("question_id"), section_id=ref.get("section_id"))
        return r

    res = tracked(await once(payload))
    if res["ok"] and validator:
        problem = validator(res["structured"])
        if problem:
            retry_payload = (payload + "\n\n<validation_error>\nYour previous answer was rejected: "
                             + problem + "\nFix this and answer again.\n</validation_error>")
            res2 = tracked(await once(retry_payload))
            res2["duration_s"] += res["duration_s"]
            if res2["ok"]:
                problem2 = validator(res2["structured"])
                if problem2:
                    res2 = _fail("schema", problem2, res2["raw"], res2["duration_s"])
            res = res2
    log.info("llm call kind=%s model=%s duration=%.1fs ok=%s error_kind=%s",
             kind, model, res["duration_s"], res["ok"], res["error_kind"])
    return res


# ---- health -------------------------------------------------------------

def get_health() -> dict:
    return dict(_health)


async def check_health() -> dict:
    claude_path = db.connect().execute("SELECT value FROM settings WHERE key='claude_path'").fetchone()
    claude_path = claude_path[0] if claude_path else ""
    path = find_claude(claude_path)
    _health.update(path=path, checked_at=time.time())
    if not path:
        _health.update(claude_ok=False, version=None, error="claude CLI not found (set the path in Settings)")
        return get_health()
    try:
        proc = await asyncio.create_subprocess_exec(path, "--version", stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.PIPE, env=clean_env())
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        _health["version"] = out.decode().strip()
    except Exception as e:  # noqa: BLE001
        _health.update(claude_ok=False, error=f"cannot run claude: {e}")
        return get_health()
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
    res = await _once("health", "Reply with the structured output only.", "Return ok=true.", schema,
                      "sonnet", 120, claude_path)
    db.record_call("health", "sonnet", res["ok"], res["error_kind"], res["duration_s"], res["raw"])
    if res["ok"]:
        _health.update(claude_ok=True, error=None)
    else:
        msg = res["error"] or "unknown error"
        if res["error_kind"] == "auth":
            msg = "Not logged in: run `claude` and /login. " + msg
        _health.update(claude_ok=False, error=f"[{res['error_kind']}] {msg}"[:500])
    log.info("claude health ok=%s error=%s", _health["claude_ok"], _health["error"])
    return get_health()
