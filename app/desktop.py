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


def _restore_context_menu() -> None:
    """pywebview empties WKWebView's right-click menu unless debug is on, which removes Copy and Reload."""
    import objc
    from webview.platforms import cocoa

    def will_open_menu(self, menu, event):
        pass

    objc.classAddMethods(cocoa.BrowserView.WebKitHost, [objc.selector(will_open_menu, selector=b"willOpenMenu:withEvent:", signature=b"v@:@@")])


# Select All goes through the page, not WKWebView's native selectAll:. The menu's key equivalent takes Cmd+A before the page sees
# it, and the native command cannot select a CodeMirror document (CodeMirror only keeps the visible lines in the DOM).
# window.__lemmaSelectAll (web/src/components/code/java-editor.tsx) selects the whole document of a focused editor; anywhere
# else this falls back to the browser's own select-all, which covers text fields and the page.
SELECT_ALL_JS = "(window.__lemmaSelectAll || (() => document.execCommand('selectAll')))()"
_menu_target = None  # the Objective-C object the Select All and zoom items call; kept alive for the app's lifetime


ZOOM_STEPS = (0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0)


def _zoom_file() -> Path:
    from . import config
    return config.DATA_DIR / ".zoom"


def _webviews() -> list:
    from webview.platforms import cocoa
    return [i.webview for i in cocoa.BrowserView.instances.values()]


def _set_zoom(z: float) -> None:
    """Page zoom (Cmd +/-/0): the whole page scales and text reflows. Remembered across launches."""
    for wv in _webviews():
        wv.setPageZoom_(z)
    try:
        _zoom_file().write_text(str(z))
    except OSError:
        pass


def _current_zoom() -> float:
    wvs = _webviews()
    return float(wvs[0].pageZoom()) if wvs else 1.0


def _enable_zoom() -> None:
    """Trackpad pinch-to-zoom (and two-finger double-tap) like Safari, plus the page zoom saved last time."""
    try:
        saved = float(_zoom_file().read_text())
    except (OSError, ValueError):
        saved = 1.0
    for wv in _webviews():
        wv.setAllowsMagnification_(True)
        if saved != 1.0:
            wv.setPageZoom_(saved)


def _menu_target_factory():
    import objc
    from Foundation import NSObject

    class LemmaMenuTarget(NSObject):
        def selectAllInPage_(self, sender):
            import webview
            # evaluate_js waits for the main thread, and menu actions run on it: hand the call to another thread.
            threading.Thread(target=lambda: webview.windows[0].evaluate_js(SELECT_ALL_JS), daemon=True).start()

        def zoomInPage_(self, sender):
            z = _current_zoom()
            _set_zoom(next((s for s in ZOOM_STEPS if s > z + 0.01), ZOOM_STEPS[-1]))

        def zoomOutPage_(self, sender):
            z = _current_zoom()
            _set_zoom(next((s for s in reversed(ZOOM_STEPS) if s < z - 0.01), ZOOM_STEPS[0]))

        def actualSizePage_(self, sender):
            _set_zoom(1.0)
            for wv in _webviews():
                wv.setMagnification_centeredAtPoint_(1.0, (0, 0))  # also undo any pinch

        selectAllInPage_ = objc.selector(selectAllInPage_, signature=b"v@:@")
        zoomInPage_ = objc.selector(zoomInPage_, signature=b"v@:@")
        zoomOutPage_ = objc.selector(zoomOutPage_, signature=b"v@:@")
        actualSizePage_ = objc.selector(actualSizePage_, signature=b"v@:@")

    return LemmaMenuTarget.alloc().init()


def _add_edit_menu() -> None:
    """Our custom menu bar has no Edit menu, so Cmd+C/V/X/A never reach WKWebView. Add the standard one."""
    from PyObjCTools import AppHelper

    def build():
        global _menu_target
        from AppKit import NSApplication, NSMenu, NSMenuItem
        main_menu = NSApplication.sharedApplication().mainMenu()
        if main_menu is None:
            return
        _menu_target = _menu_target_factory()
        edit = NSMenu.alloc().initWithTitle_("Edit")
        for title, action, key in (("Undo", b"undo:", "z"), ("Redo", b"redo:", "Z"), (None, None, None),
                                   ("Cut", b"cut:", "x"), ("Copy", b"copy:", "c"), ("Paste", b"paste:", "v"),
                                   ("Select All", b"selectAllInPage:", "a")):
            if title is None:
                edit.addItem_(NSMenuItem.separatorItem())
                continue
            item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, action, key)
            if action == b"selectAllInPage:":
                item.setTarget_(_menu_target)
            edit.addItem_(item)
        holder = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Edit", None, "")
        holder.setSubmenu_(edit)
        main_menu.insertItem_atIndex_(holder, min(1, main_menu.numberOfItems()))

        view = NSMenu.alloc().initWithTitle_("View")
        for title, action, key in (("Actual Size", b"actualSizePage:", "0"), ("Zoom In", b"zoomInPage:", "="),
                                   ("Zoom In", b"zoomInPage:", "+"), ("Zoom Out", b"zoomOutPage:", "-")):
            item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, action, key)
            item.setTarget_(_menu_target)
            if key == "+":
                item.setHidden_(True)  # Cmd+Shift+= also zooms in, as in Safari, without a second visible item
                item.setAllowsKeyEquivalentWhenHidden_(True)
            view.addItem_(item)
        vholder = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("View", None, "")
        vholder.setSubmenu_(view)
        main_menu.insertItem_atIndex_(vholder, min(2, main_menu.numberOfItems()))
        _enable_zoom()

    AppHelper.callAfter(build)


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
    subprocess.run(["/usr/bin/osascript", "-e", f'display alert "Lemma" message "{text}"'], check=False)


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
        _alert("Lemma is already running. Look for its window, or quit it (and any run.sh instance) first.")
        sys.exit(0)
    from . import main as api
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    if not _wait_ready(url):
        _alert("Lemma could not start its engine. Details are in ~/Lemma/logs/app.log")
        sys.exit(1)
    try:
        import webview
        _allow_microphone()
        _restore_context_menu()
        from webview.menu import Menu, MenuAction
        window = webview.create_window("Lemma", url, width=1440, height=920, min_size=(900, 600), js_api=Bridge(), text_select=True)
        reload_page = lambda: window.evaluate_js("location.reload()")  # noqa: E731
        webview.start(_add_edit_menu, menu=[Menu("Page", [MenuAction("Reload", reload_page)])])
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
