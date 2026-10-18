"""Compile and run Java through the generic harness (app/code/java/Harness.java)."""
import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .. import config

JAVA_DIR = Path(__file__).resolve().parent / "java"
HARNESS_FILES = ("Harness.java", "ListNode.java", "TreeNode.java")
COMPILE_TIMEOUT = 60
_tools: dict = {}
_harness_dir: Path | None = None
_lock = asyncio.Lock()


def _candidates() -> list[Path]:
    out = []
    home = os.environ.get("JAVA_HOME")
    if home:
        out.append(Path(home) / "bin")
    try:  # macOS: the registered JDK, which /usr/bin/java only forwards to
        jh = subprocess.run(["/usr/libexec/java_home"], capture_output=True, text=True, timeout=10).stdout.strip()
        if jh:
            out.append(Path(jh) / "bin")
    except (OSError, subprocess.SubprocessError):
        pass
    for p in ("/opt/homebrew/opt/openjdk/bin", "/usr/local/opt/openjdk/bin"):
        out.append(Path(p))
    found = shutil.which("javac")
    if found:
        out.append(Path(found).parent)
    return out


def find_java(refresh: bool = False) -> dict:
    """{"ok", "java", "javac", "version", "error"}. A JDK (javac) is required, not just a JRE."""
    if _tools and not refresh:
        return dict(_tools)
    _tools.clear()
    for b in _candidates():
        java, javac = b / "java", b / "javac"
        if not (java.exists() and javac.exists()):
            continue
        try:
            r = subprocess.run([str(javac), "-version"], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            continue
        text = (r.stdout + r.stderr).strip()
        if r.returncode == 0 and text.lower().startswith("javac"):
            _tools.update(ok=True, java=str(java), javac=str(javac), version=text, error=None)
            return dict(_tools)
    _tools.update(ok=False, java=None, javac=None, version=None,
                  error="No JDK found. Install one (brew install openjdk) so the coding judge can compile Java.")
    return dict(_tools)


def _clean_env() -> dict:
    env = {"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", "/tmp"), "LANG": "en_US.UTF-8"}
    if os.environ.get("JAVA_HOME"):
        env["JAVA_HOME"] = os.environ["JAVA_HOME"]
    return env


async def _exec(cmd: list[str], cwd: Path, timeout: float) -> tuple[int, str, str, bool]:
    proc = await asyncio.create_subprocess_exec(*cmd, cwd=str(cwd), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                env=_clean_env(), start_new_session=True)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        await proc.wait()
        return -1, "", "", True
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace"), False


async def ensure_harness() -> Path:
    """Compile the harness once per source version; returns the classes directory."""
    global _harness_dir
    async with _lock:
        digest = hashlib.sha256(b"".join((JAVA_DIR / f).read_bytes() for f in HARNESS_FILES)).hexdigest()[:12]
        target = config.CODE_DIR / "harness" / digest
        if _harness_dir == target and (target / "Harness.class").exists():
            return target
        if not (target / "Harness.class").exists():
            tools = find_java()
            if not tools["ok"]:
                raise RuntimeError(tools["error"])
            tmp = target.with_name(target.name + ".tmp")
            shutil.rmtree(tmp, ignore_errors=True)
            tmp.mkdir(parents=True)
            code, out, err, timed_out = await _exec([tools["javac"], "-d", str(tmp), "-proc:none", *[str(JAVA_DIR / f) for f in HARNESS_FILES]],
                                                    JAVA_DIR, COMPILE_TIMEOUT)
            if code != 0:
                shutil.rmtree(tmp, ignore_errors=True)
                raise RuntimeError("could not compile the judge harness: " + (err or out or "timed out")[:500])
            shutil.rmtree(target, ignore_errors=True)
            tmp.rename(target)
        _harness_dir = target
        return target


_ERR = re.compile(r"^(?P<file>[\w$./-]+\.java):(?P<line>\d+): (?P<kind>error|warning): (?P<msg>.*)$")


def parse_compile_errors(text: str, workdir: Path) -> list[dict]:
    """javac output -> [{file, line, message, detail}], with the scratch path removed."""
    text = text.replace(str(workdir) + os.sep, "")
    errors: list[dict] = []
    for line in text.splitlines():
        m = _ERR.match(line)
        if m and m["kind"] == "error":
            errors.append({"file": Path(m["file"]).name, "line": int(m["line"]), "message": m["msg"], "detail": ""})
        elif errors and line.strip() and not line.startswith(("Note:", "1 error", "2 errors")) and not re.match(r"^\d+ errors?$", line):
            if len(errors[-1]["detail"]) < 300:
                errors[-1]["detail"] += line + "\n"
    return errors[:20]


async def compile_sources(files: dict[str, str], workdir: Path) -> dict:
    """Compile `files` (name -> source) into workdir/out. Returns {"ok", "errors", "output"}."""
    tools = find_java()
    if not tools["ok"]:
        return {"ok": False, "errors": [], "output": tools["error"], "unavailable": True}
    harness = await ensure_harness()
    src = workdir / "src"
    src.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (src / name).write_text(text, encoding="utf-8")
    out = workdir / "out"
    out.mkdir(exist_ok=True)
    code, so, se, timed_out = await _exec([tools["javac"], "-d", str(out), "-cp", str(harness), "-proc:none", "-Xlint:none", "-encoding", "UTF-8",
                                           *[str(src / n) for n in files]], workdir, COMPILE_TIMEOUT)
    if timed_out:
        return {"ok": False, "errors": [], "output": "compilation timed out"}
    text = (se or so).strip()
    if code != 0:
        return {"ok": False, "errors": parse_compile_errors(text, src), "output": text.replace(str(src) + os.sep, "")[:4000]}
    return {"ok": True, "errors": [], "output": ""}


async def run_cases(workdir: Path, class_name: str, kind: str, method: str, inplace, cases: list[dict]) -> list[dict]:
    """Run cases [{id, input, timeout_ms}] and return one result dict per case, in order."""
    tools = find_java()
    harness = await ensure_harness()
    spec = workdir / "cases.json"
    spec.write_text(json.dumps({"method": method or "", "inplace": inplace, "cases": [
        {"id": c["id"], "input": c["input"], "timeout_ms": c.get("timeout_ms", 2000)} for c in cases]}), encoding="utf-8")
    budget = sum(c.get("timeout_ms", 2000) for c in cases) / 1000 + 20
    cp = f"{workdir / 'out'}{os.pathsep}{harness}"
    code, out, err, timed_out = await _exec([tools["java"], "-Xmx512m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=4", "-Xshare:auto", "-cp", cp,
                                             "Harness", class_name, "design" if kind == "design" else "function", str(spec)],
                                            workdir, min(budget, 240))
    results: dict[str, dict] = {}
    fatal = None
    for line in out.splitlines():
        if line.startswith("@@R@@"):
            try:
                r = json.loads(line[5:])
            except ValueError:
                continue
            results[r["id"]] = r
        elif line.startswith("@@FATAL@@"):
            try:
                fatal = json.loads(line[9:])
            except ValueError:
                fatal = line[9:]
    ordered = []
    tail = (err.strip().splitlines() or [""])[-1][:300]
    for c in cases:
        r = results.get(c["id"])
        if r is None:
            why = fatal or ("the whole run exceeded its time budget" if timed_out else
                            (f"the JVM exited early: {tail}" if tail else "the JVM exited before running this case"))
            r = {"id": c["id"], "status": "crash", "error": why, "ms": 0, "stdout": ""}
        ordered.append(r)
    return ordered


class Workdir:
    """A scratch directory under CODE_DIR that is removed afterwards."""
    def __enter__(self) -> Path:
        config.CODE_DIR.mkdir(parents=True, exist_ok=True)
        self.path = Path(tempfile.mkdtemp(prefix="run-", dir=config.CODE_DIR))
        return self.path

    def __exit__(self, *exc) -> None:
        shutil.rmtree(self.path, ignore_errors=True)


async def execute(files: dict[str, str], class_name: str, kind: str, method: str, inplace, cases: list[dict]) -> dict:
    """Compile and run in one go: {"compile": {...}, "results": [...]}. `results` is empty if compilation failed."""
    with Workdir() as wd:
        comp = await compile_sources(files, wd)
        if not comp["ok"]:
            return {"compile": comp, "results": []}
        return {"compile": comp, "results": await run_cases(wd, class_name, kind, method, inplace, cases)}
