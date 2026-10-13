# AGENTS.md

Local-only macOS app for practicing staff-level system design interviews. More detail in [DEVELOPMENT.md](DEVELOPMENT.md).

## Features

- Answer out loud, one section at a time, through a fixed five-part framework (`app/seed/framework.yaml`).
- Local speech-to-text (mlx-whisper); the user edits the transcript before grading.
- Excalidraw canvas for diagrams, sent to the grader as text.
- A web-researched reference brief per question, then per-section grades, gaps and an overall grade.
- Follow-up probes, session reports with markdown export, and a Progress page that tracks gaps across sessions.
- Articles (`app/articles.py`, `/articles/`): explainer articles grouped by design problem; Explain picks an existing article or writes one.
- Grading through the `claude` CLI (Pro login), OpenRouter or Groq, chosen per task; Usage page shows calls, tokens and cost.

## Architecture

```
Next.js UI (web/) ──/api──► FastAPI (app/main.py) ──► SQLite (~/SystemDesignCoach/coach.db)
                                  │
                      jobs.py queue ──► pipeline.py ──► grader.run_claude() ──► claude CLI | providers.py
                                  └──► transcribe.py (ffmpeg + mlx-whisper)
```

- `app/`: Python backend. `jobs.py` is a persistent queue (restart-safe); `pipeline.py` has the `research`, `grade_section`
  and `grade_session` handlers; `grader.py` is the only place a model is called; `config.py` seeds user config from `app/seed/`.
- `web/`: Next.js App Router + Tailwind + shadcn/ui. Read `web/AGENTS.md` first (this Next.js has breaking changes).
  Static export means no dynamic routes: use `/session/?id=3`.
- `app/desktop.py` + `packaging/`: pywebview shell and `build_app.sh`, which produce `Design Coach.app` / `.dmg`
  (no Node in the shipped app; FastAPI serves the exported UI).
- Rules: servers bind to `127.0.0.1`; audio and transcripts stay local and never go in logs; API keys live in the Keychain
  and are never returned by the API; never commit anything from `~/SystemDesignCoach/`.

## Making changes locally

```bash
./run.sh                              # API :8765 + UI :3000 (needs uv, ffmpeg, node, logged-in claude CLI)
DEV=1 ./run.sh                        # UI hot reload; Python changes need a restart
SD_COACH_HOME=/tmp/scratch ./run.sh   # throwaway data dir for risky changes

uvx ruff check app tests                          # before finishing
.venv/bin/python -m unittest discover -s tests
cd web && npm run lint && npx tsc --noEmit
```

- Tests use a fake provider server; no keys, network or Whisper needed. Add a test for behavior changes.
- UI changes: click through Home, a session, the report, Settings and Usage; static export is stricter than the dev server.
- `db.py` schema changes need a `user_version` migration; try it on a copy of a real `coach.db` via `SD_COACH_HOME`.
- Prompt or rubric changes: re-grade a saved session before and after and compare scores.
- Shipping the app: `./packaging/build_app.sh` (see DEVELOPMENT.md).
