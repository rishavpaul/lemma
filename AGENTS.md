# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Deeper detail lives in [DEVELOPMENT.md](DEVELOPMENT.md);
this file is the short version plus the rules that are easy to get wrong.

## What this is

A local-only macOS practice app for staff-level system design interviews. The user answers out loud, one section at a time,
through a fixed seven-part framework (`scope`, `estimates`, `api_data`, `hld`, `deep_dives`, `reliability_ops`,
`tradeoffs_evolution`; defined in `app/seed/framework.yaml`). Each clip is transcribed locally (mlx-whisper), the user
fixes the transcript, and a model grades it against a web-researched reference brief. A Progress page tracks gaps over time.

## Layout

| Path | What |
|---|---|
| `app/` | Python backend (FastAPI + SQLite). `main.py` routes, `jobs.py` persistent queue, `pipeline.py` job handlers, `grader.py` the only place a model is called, `providers.py` OpenRouter/Groq + key store, `transcribe.py`, `config.py`, `db.py`, `desktop.py` (pywebview shell). |
| `app/seed/` | Prompts, rubric, framework, question bank, JSON schemas. Copied into `~/SystemDesignCoach/config/` on first run and never overwritten, so users can edit their copies. |
| `web/` | Next.js (App Router, Tailwind, shadcn/ui, Excalidraw). Statically exported for the shipped app. |
| `packaging/` | `build_app.sh` builds `dist/Design Coach.app` and `.dmg`. |
| `tests/` | `unittest` suites; no network, keys, Claude or Whisper needed. |
| `docs/BUILD_LOG.md` | Historical build notes and release log. |

## Run and check

```bash
./run.sh                     # API :8765, UI :3000 (needs uv, ffmpeg, node)
DEV=1 ./run.sh               # UI hot reload
SD_COACH_HOME=/tmp/scratch ./run.sh   # throwaway data dir; use for anything destructive

uvx ruff check app tests
.venv/bin/python -m unittest discover -s tests
cd web && npm run lint && npx tsc --noEmit
```

CI runs the same checks plus `next build`. Run them before calling work done. UI changes also need a click-through in the
browser; `DEVELOPMENT.md` has a "you changed X, check Y" table.

## Architecture rules

- **All model calls go through `grader.run_claude()`.** It picks the backend from the model string (Claude alias or
  `<provider>:<id>`), retries once with the validation error, and logs to `llm_calls`. Don't call a provider elsewhere.
- Every backend returns the same dict (`ok`, `structured`, `raw`, `error_kind`, `error`, `duration_s`). Keep it that way.
- Research needs live web search, so it is Claude-only (`config.put_settings` enforces this).
- Jobs are persistent and must be restart-safe: `running` jobs are re-queued on startup; `rate_limit` becomes `pending_retry`.
- The grader cannot see images, so diagrams are sent as text (`diagram.py`).
- Schema changes need a `user_version` migration in `db.py`; test against a copy of a real `coach.db` via `SD_COACH_HOME`.
- Adding an OpenAI-compatible provider is one entry in `providers.PROVIDERS`; no other code.

## Frontend rules

- **Read `web/AGENTS.md` first.** This Next.js version has breaking changes; check `web/node_modules/next/dist/docs/`
  rather than relying on memory.
- Static export cannot serve unknown ids, so no dynamic routes: use `/session/?id=3` with `useSearchParams` in `<Suspense>`.
- Pages are client components that fetch `/api/*` via `src/lib/api.ts` and `useApi`.

## Privacy and security (do not regress)

- Servers bind to `127.0.0.1` only.
- Audio and transcription stay local. Transcript text must never appear in logs.
- API keys live in the macOS Keychain (service `DesignCoach`), fallback `config/.secrets.json` (0600). The API never returns
  a key, only `configured` plus the last four characters. `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are stripped from
  the `claude` subprocess environment; grading uses the user's CLI login (`grader.clean_env()` also sets `USER`/`LOGNAME`).
- Never commit anything from `~/SystemDesignCoach/`, real keys, or personal paths. Tests must not need real keys.

## Packaging gotchas

- The shipped app has no Node; the UI is the static export served by FastAPI on one origin.
- `torch` is deleted from the bundle; if `import mlx_whisper` breaks after a dependency bump, look there first.
- The bundle must not contain absolute symlinks. Never `rm` inside the bundle through a symlinked path.
- Apple Silicon only (mlx-whisper). `mlx_whisper` is imported lazily so tests run anywhere.

## Style

- Python 3.12, ruff (config in `pyproject.toml`). Match the surrounding comment density and naming; comments explain why.
- Keep PRs small, add a test for behavior changes, update `CHANGELOG.md` for user-visible changes.
