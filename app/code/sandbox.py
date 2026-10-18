"""Runs the Python the model wrote for test generation and answer checking, in a throwaway interpreter.

It is not a security boundary (the process has the user's privileges, like the Java being judged), but it runs in an empty
directory (the only importable module is the script itself) with a minimal environment, skips the user site-packages, and is
killed on a CPU/wall-clock limit.

Not `-I`: isolated mode also ignores PYTHONHOME, and the packaged app's interpreter cannot find its standard library without it
(it dies at startup with "Fatal Python error ... <no Python frame>")."""
import asyncio
import json
import os
import resource
import sys
import tempfile
from pathlib import Path

GENERATE = r'''
import json, random, sys
payload = json.load(sys.stdin)
ns = {"__name__": "generator"}
exec(compile(payload["code"], "generator.py", "exec"), ns)
gen = ns["gen"]
out, errors = [], []
for step in payload["plan"]:
    rng = random.Random(step["seed"])
    for i in range(step["count"]):
        try:
            v = gen(rng, step["size"], step["level"])
            json.dumps(v)
        except Exception as e:
            errors.append(f"size {step['size']} level {step['level']}: {type(e).__name__}: {e}")
            continue
        out.append({"size": step["size"], "level": step["level"], "perf": step.get("perf", False), "input": v})
print(json.dumps({"cases": out, "errors": errors[:5]}))
'''

CHECK = r'''
import json, sys
payload = json.load(sys.stdin)
ns = {"__name__": "checker"}
exec(compile(payload["code"], "checker.py", "exec"), ns)
check = ns["check"]
out = []
for item in payload["items"]:
    try:
        r = check(item["input"], item["actual"])
        out.append(None if r is None or r is True else (str(r) if r is not False else "not a valid answer"))
    except Exception as e:
        out.append(f"checker crashed: {type(e).__name__}: {e}")
print(json.dumps(out))
'''


PY_FLAGS = ("-B", "-s")  # no bytecode files, no user site-packages


class SandboxError(RuntimeError):
    """The interpreter itself could not run. That is the app's fault, not the model's, so it must not be sent back to the model."""


def _limits(cpu_s: int):
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s))
        resource.setrlimit(resource.RLIMIT_FSIZE, (10_000_000, 10_000_000))
    return apply


async def run_python(script: str, payload: dict, timeout: int = 30) -> dict:
    """Run `script` with `payload` on stdin; returns its JSON stdout, or {"error": ...}."""
    with tempfile.TemporaryDirectory(prefix="sdc-py-") as tmp:
        (Path(tmp) / "run.py").write_text(script, encoding="utf-8")
        env = {"PATH": "/usr/bin:/bin", "PYTHONHASHSEED": "0", "HOME": tmp}
        if os.environ.get("PYTHONHOME"):  # the packaged app's interpreter needs it to find the standard library
            env["PYTHONHOME"] = os.environ["PYTHONHOME"]
        proc = await asyncio.create_subprocess_exec(
            sys.executable, *PY_FLAGS, "run.py", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, cwd=tmp, env=env, preexec_fn=_limits(timeout + 5), start_new_session=True)
        try:
            out, err = await asyncio.wait_for(proc.communicate(json.dumps(payload).encode()), timeout=timeout)
        except TimeoutError:
            try:
                os.killpg(proc.pid, 9)
            except ProcessLookupError:
                pass
            await proc.wait()
            return {"error": f"timed out after {timeout}s"}
    if proc.returncode != 0:
        text = err.decode(errors="replace").strip()
        lines = [x.strip() for x in text.splitlines() if x.strip()]
        if "Fatal Python error" in text:
            raise SandboxError("the Python sandbox could not start: " + " / ".join(lines[:2])[:300])
        return {"error": (lines or ["failed"])[-1][:500]}
    try:
        return {"value": json.loads(out.decode())}
    except ValueError:
        return {"error": "the script did not print JSON"}


async def generate(code: str, plan: list[dict], timeout: int = 40) -> dict:
    """plan: [{count, size, level, seed, perf}] -> {"cases": [...], "errors": [...]} or {"error": ...}"""
    r = await run_python(GENERATE, {"code": code, "plan": plan}, timeout)
    return r["value"] if "value" in r else {"cases": [], "errors": [r["error"]], "error": r["error"]}


async def check(code: str, items: list[dict], timeout: int = 40) -> list[str | None] | str:
    """Verdict per item: None when valid, else a message. A string result is a failure of the checker itself."""
    r = await run_python(CHECK, {"code": code, "items": items}, timeout)
    return r["value"] if "value" in r else r["error"]
