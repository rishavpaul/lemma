# Contributing

Thanks for helping. Architecture and release steps are in [DEVELOPMENT.md](DEVELOPMENT.md).

## Setup
```bash
./run.sh                 # full app (needs uv, ffmpeg, node, a logged-in claude CLI)
DEV=1 ./run.sh           # UI with hot reload
```

## Before opening a PR
```bash
uvx ruff check app tests
.venv/bin/python -m unittest discover -s tests
cd web && npm run lint && npx tsc --noEmit
```
CI runs the same checks. Tests must not need network, Claude, or Whisper; use a fake provider (see `tests/test_providers.py`).

## Guidelines
- Keep PRs small and focused; explain the why.
- Match the surrounding style. Add a test for behavior changes.
- Don't commit personal data, API keys, or anything from `~/SystemDesignCoach/`.
- Questions and ideas: open an issue first for anything large.
