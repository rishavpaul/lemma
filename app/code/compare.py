"""Compare a program's JSON output with the expected JSON under a named mode."""
import json
import math

MODES = ("exact", "unordered", "unordered_nested", "float")


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _close(a, b, tol: float) -> bool:
    if _num(a) and _num(b):
        return math.isclose(a, b, rel_tol=tol, abs_tol=tol)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k], tol) for k in a)
    return _exact(a, b)


def _exact(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _num(a) and _num(b):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_exact(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_exact(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


def _sort_deep(x):
    if isinstance(x, list):
        return sorted((_sort_deep(i) for i in x), key=lambda v: json.dumps(v, sort_keys=True))
    if isinstance(x, dict):
        return {k: _sort_deep(v) for k, v in x.items()}
    return x


def equal(actual, expected, mode: str = "exact", tol: float = 1e-6) -> bool:
    if mode == "float":
        return _close(actual, expected, tol)
    if mode == "unordered":
        if not (isinstance(actual, list) and isinstance(expected, list)):
            return _exact(actual, expected)
        key = lambda v: json.dumps(v, sort_keys=True)  # noqa: E731
        return _exact(sorted(actual, key=key), sorted(expected, key=key))
    if mode == "unordered_nested":
        return _exact(_sort_deep(actual), _sort_deep(expected))
    return _exact(actual, expected)


def show(x, limit: int = 600) -> str:
    """Compact JSON for display, clipped."""
    try:
        s = json.dumps(x, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        s = str(x)
    return s if len(s) <= limit else s[:limit] + f"... ({len(s)} chars)"
