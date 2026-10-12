"""Desktop entry point: runs the API (which also serves the UI) and shows it in a native window."""
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

log = logging.getLogger("coach.desktop")
PREFERRED_PORT = 8765


def _free_port() -> int:
    for port in (PREFERRED_PORT, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


def _wait_ready(url: str, timeout: float = 60) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url + "/api/health", timeout=1).read()
            return True
        except OSError:
            time.sleep(0.25)
    return False


def _allow_microphone() -> None:
    """pywebview's WKWebView delegate has no media-capture handler, so getUserMedia would be denied.
    Grant it for our own local page; macOS still shows its own one-time microphone prompt."""
    import objc
    from webview.platforms import cocoa

    def handler(self, webview, origin, frame, media_type, decision):
        decision(1 if origin.host() in ("127.0.0.1", "localhost") else 2)  # WKPermissionDecisionGrant / Deny

    sel = b"webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:"
    objc.classAddMethods(cocoa.BrowserView.BrowserDelegate, [objc.selector(handler, selector=sel, signature=b"v@:@@@q@?")])


def _single_instance() -> bool:
    """One app per data directory: two servers would both run the job queue against the same database."""
    import fcntl

    from . import config
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    global _lock
    _lock = open(config.DATA_DIR / ".app.lock", "w")
    try:
        fcntl.flock(_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


_lock = None


def _alert(text: str) -> None:
    import subprocess
    subprocess.run(["/usr/bin/osascript", "-e", f'display alert "Design Coach" message "{text}"'], check=False)


class Bridge:
    """Exposed to the page as window.pywebview.api for things WKWebView cannot do itself."""

    def open_external(self, url: str) -> None:
        if url.startswith(("http://", "https://")):
            webbrowser.open(url)

    def save_text(self, name: str, text: str) -> bool:
        import webview
        win = webview.windows[0]
        dest = win.create_file_dialog(webview.SAVE_DIALOG, save_filename=name)
        if not dest:
            return False
        Path(dest if isinstance(dest, str) else dest[0]).write_text(text, encoding="utf-8")
        return True


def main() -> None:
    if not _single_instance():
        _alert("Design Coach is already running. Look for its window, or quit it (and any run.sh instance) first.")
        sys.exit(0)
    from . import main as api
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    if not _wait_ready(url):
        _alert("Design Coach could not start its engine. Details are in ~/SystemDesignCoach/logs/app.log")
        sys.exit(1)
    try:
        import webview
        _allow_microphone()
        webview.create_window("Design Coach", url, width=1440, height=920, min_size=(900, 600), js_api=Bridge())
        webview.start()
    except ImportError:
        webbrowser.open(url)
        thread.join()
    server.should_exit = True
    thread.join(timeout=5)
    from . import grader
    grader.kill_children()  # os._exit skips shutdown hooks; don't leave claude -p running unattended
    os._exit(0)


if __name__ == "__main__":
    main()
