"""Java language server (Eclipse JDT LS) for the code editor, bridged to the browser over a WebSocket.

Started lazily when a problem page connects and stopped when it disconnects. One server runs at a time (they share one index under
CODE_DIR/lsp/data), so a new connection replaces the old one. Each problem gets its own plain source folder with the support classes
next to the candidate file; jdtls needs no build file for that.
"""
import asyncio
import json
import logging
import os
import re
import shutil
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect

from .. import config
from . import runner

log = logging.getLogger("lemma.lsp")
JDTLS_CANDIDATES = ("/opt/homebrew/bin/jdtls", "/usr/local/bin/jdtls")
SERVER_REQUEST_REPLIES = {"workspace/configuration": lambda p: [None] * len(p.get("items", []))}  # everything else is answered with null
_current: "asyncio.subprocess.Process | None" = None


def find_jdtls() -> str | None:
    return os.environ.get("LEMMA_JDTLS") or shutil.which("jdtls") or next((p for p in JDTLS_CANDIDATES if os.access(p, os.X_OK)), None)


def lsp_root() -> Path:
    return config.CODE_DIR / "lsp"


def prepare_project(slug: str, class_name: str, starter: str, support: str | None) -> dict:
    """Lay out the source folder for one problem and return the URIs the editor should use."""
    safe = re.sub(r"[^a-z0-9_-]", "_", slug.lower())
    root = lsp_root() / "projects" / safe
    root.mkdir(parents=True, exist_ok=True)
    for name in runner.HARNESS_FILES:
        if name != "Harness.java":
            shutil.copyfile(Path(__file__).parent / "java" / name, root / name)
    if (support or "").strip():
        (root / "Support.java").write_text(support, encoding="utf-8")
    main = root / f"{class_name}.java"
    if not main.exists():
        main.write_text(starter, encoding="utf-8")
    return {"rootUri": root.as_uri(), "fileUri": main.as_uri()}


async def _read_frame(stream: asyncio.StreamReader) -> str | None:
    length = 0
    while True:
        line = await stream.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            break
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1])
    return (await stream.readexactly(length)).decode("utf-8") if length else ""


def _frame(text: str) -> bytes:
    body = text.encode("utf-8")
    return f"Content-Length: {len(body)}\r\n\r\n".encode() + body


def _jdtls_env() -> dict:
    """jdtls is launched through a system Python script, so the bundled app's PYTHONHOME/PYTHONPATH must not leak into it."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}
    env["PATH"] = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", env.get("PATH", "/usr/bin:/bin")])
    return env


def _terminate(proc: "asyncio.subprocess.Process") -> None:
    try:
        proc.terminate()
    except ProcessLookupError:
        pass


async def _stop(proc: "asyncio.subprocess.Process | None") -> None:
    if proc is None or proc.returncode is not None:
        return
    _terminate(proc)
    try:
        await asyncio.wait_for(proc.wait(), 5)
    except TimeoutError:
        proc.kill()


async def bridge(ws: WebSocket) -> None:
    """Relay LSP messages between the browser and a fresh jdtls process until either side goes away."""
    global _current
    jdtls = find_jdtls()
    if not jdtls:
        await ws.close(code=1011, reason="jdtls is not installed")
        return
    await _stop(_current)
    data = lsp_root() / "data"
    data.mkdir(parents=True, exist_ok=True)
    proc = _current = await asyncio.create_subprocess_exec(
        jdtls, "-data", str(data), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=_jdtls_env())
    await ws.accept()

    async def to_browser() -> None:
        while (text := await _read_frame(proc.stdout)) is not None:
            msg = json.loads(text)
            if "method" in msg and "id" in msg:  # a request from the server (registerCapability, configuration...): answer it here
                reply = SERVER_REQUEST_REPLIES.get(msg["method"], lambda p: None)(msg.get("params") or {})
                proc.stdin.write(_frame(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": reply})))
                await proc.stdin.drain()
            else:
                await ws.send_text(text)

    async def to_server() -> None:
        while True:
            text = await ws.receive_text()
            proc.stdin.write(_frame(text))
            await proc.stdin.drain()

    tasks = [asyncio.create_task(to_browser()), asyncio.create_task(to_server())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        _terminate(proc)  # synchronous, so it happens even if this handler is being cancelled
        if _current is proc:
            _current = None
        await asyncio.shield(_stop(proc))
        try:
            await ws.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
