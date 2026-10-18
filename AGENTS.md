# AGENTS.md

Lemma: a local-only macOS app for practicing staff-level interviews, in two tracks (system design and coding) that share one shell,
streak and settings. In the UI, design is amber (`--signal`) and code is blue (`--code`); the logo is code braces around a system diagram.
The data folder is `~/Lemma` (copied from `~/SystemDesignCoach` on first launch by `config.migrate_legacy_data`). More detail in [DEVELOPMENT.md](DEVELOPMENT.md).

## Features

- Answer out loud, one section at a time, through a fixed five-part framework (`app/seed/framework.yaml`).
- Local speech-to-text (mlx-whisper); the user edits the transcript before grading.
- Excalidraw canvas for diagrams, sent to the grader as text.
- A web-researched reference brief per question, then per-section grades, gaps and an overall grade.
- Follow-up probes, session reports with markdown export, and a Progress page that tracks gaps across sessions.
- Articles (`app/articles.py`, `/articles/`): explainer articles grouped by design problem; Explain picks an existing article or writes one.
- Code (`app/code/`, `/code/`): a second vertical for coding interviews, driven by the 160-problem roadmap in `app/seed/problems.yaml`.
  See "Coding vertical" below.
- Grading through the `claude` CLI (Pro login), OpenRouter or Groq, chosen per task; Usage page shows calls, tokens and cost.

## Architecture

```
Next.js UI (web/) ──/api──► FastAPI (app/main.py) ──► SQLite (~/Lemma/coach.db)
                                  │
                      jobs.py queue ──► pipeline.py ──► grader.run_claude() ──► claude CLI | providers.py
                                  └──► transcribe.py (ffmpeg + mlx-whisper)
```

- `app/`: Python backend. `jobs.py` is a persistent queue (restart-safe); `pipeline.py` has the `research`, `grade_section`
  and `grade_session` handlers; `grader.py` is the only place a model is called; `config.py` seeds user config from `app/seed/`.
- `web/`: Next.js App Router + Tailwind + shadcn/ui. Read `web/AGENTS.md` first (this Next.js has breaking changes).
  Static export means no dynamic routes: use `/session/?id=3`.
- `app/desktop.py` + `packaging/`: pywebview shell and `build_app.sh`, which produce `Lemma.app` / `.dmg`
  (no Node in the shipped app; FastAPI serves the exported UI).
- Phone access: `scripts/mobile.sh` publishes the API over `tailscale serve` (see `docs/mobile.md`). `app/auth.py` requires a shared token
  only for proxied requests (forwarding headers present); direct localhost requests, i.e. the desktop app and `run.sh`, are trusted.
  `mobile.sh` builds the UI into `web/.next-export` (served via `LEMMA_WEB`), separate from `.next` and `out`, and shares port 8765
  with `run.sh`. It is not a service: it needs rerunning after a reboot (see "Keeping it running" in `docs/mobile.md`).
- Read-aloud: `app/tts.py` (Kokoro via `kokoro-onnx`, system espeak-ng from Homebrew; never the bundled espeak wheel, it aborts the process)
  serves `POST /api/tts`; `web/src/lib/speech.ts` is the one player (Mac voice, browser voice as fallback). Tests set `LEMMA_TTS=0`
  so they never download the model. Interactive sessions (`show_feedback_live`) also ask the grader for `spoken_feedback`.
- Rules: servers bind to `127.0.0.1`; audio and transcripts stay local and never go in logs; API keys live in the Keychain
  and are never returned by the API; never commit anything from `~/Lemma/`.

## Coding vertical

```
/code (roadmap) ─► /code/problem/?slug= ─► routes.py ─► judge.py ─► runner.py ─► javac + java Harness (app/code/java)
                                              │              └─► compare.py (expected vs actual)
              jobs: code_spec / code_review / code_hint ─► handlers.py ─► grader.run_claude()
              generate.py: spec ─► compile reference + brute ─► run both on every case ─► keep only the cases that agree
```

- `generate.py` is the trust model: nothing the model writes is believed until it has run. The reference and an independent brute force
  must agree on every example, edge case and random input (or both satisfy `checker_py` when many answers are valid). Disagreements go
  back to the model (up to 3 rounds); what still disagrees is dropped and the spec is marked `partial`. Stress-case time limits are
  scaled from the reference's measured time (`time_limit`).
- `java/Harness.java` is one generic, reflection-driven harness (function problems and class/operation-list "design" problems, with
  `ListNode`/`TreeNode`). It reads a JSON cases file and prints `@@R@@{...}` lines; Python does all comparing. Change it and the
  compiled copy is rebuilt automatically (cached by source hash under `~/Lemma/code/harness/`).
- Two stages, so nobody waits: `ensure_brief` writes the statement and starter (about 10-20s, stored in `problem_briefs`, kept across
  rebuilds) and the page shows it at once; the tests are then built against that fixed signature (`validate_spec(..., brief)`). An attempt
  can start from the brief (`attempts.spec_id` NULL) and binds to the tests lazily (`routes._spec_for`); Run, hints, coach and solution
  answer 409 until then. The problem the user opened builds as `code_spec` on its own worker; bulk and build-ahead (the dashboard
  prefetches the next problem of each track) use `code_spec_batch`, the lowest priority.
- Secrets (reference, brute force, generator, checker, hints, write-up) live in `problem_specs.secrets_json` and never leave the server
  except through `/attempts/{id}/hint` and `/solution`, which record that they were used.
- Reviews: `handlers.apply_caps` enforces the rubric caps in code (failing 2.0, solution viewed 2.0, hints 3.0, correct-but-slow 2.5),
  so a generous model cannot lift a score. The rubric, prompts, gap tags and schemas are in `app/seed/code/` and `app/seed/schemas/code_*.json`.
- `code_review` and `code_hint` have their own worker; `code_spec` is the lowest-priority job so a batch never delays grading.
- Safety: the judge runs the candidate's Java and model-written Java/Python on this Mac with the user's privileges (isolated working
  directory, minimal environment, wall-clock and CPU limits, no network guarantees). That is the same trust as running the code yourself.
- Editor language server: `lsp.py` bridges `WS /api/code/lsp` to Eclipse JDT LS (`brew install jdtls`), started when a problem page connects and stopped when it
  closes; `web/src/lib/lsp.ts` + `@codemirror/lsp-client` give completion, auto-import, live errors and go to definition. Without jdtls the editor stays plain.
  `judge.add_missing_imports` also adds common `java.util` imports at compile time, on line 1 so error lines do not move.
- Needs a JDK (`javac`). Tests in `tests/test_code.py` skip the Java parts without one.

## Making changes locally

```bash
./run.sh                              # API :8765 + UI :3000 (needs uv, ffmpeg, node, logged-in claude CLI)
DEV=1 ./run.sh                        # UI hot reload; Python changes need a restart
LEMMA_HOME=/tmp/scratch ./run.sh   # throwaway data dir for risky changes

uvx ruff check app tests                          # before finishing
.venv/bin/python -m unittest discover -s tests
cd web && npm run lint && npx tsc --noEmit
```

- `config.seed_config()` never overwrites existing files, so a changed `app/seed/` file does NOT reach an existing install: copy it into
  `~/Lemma/config/` by hand (back up first). Framework, rubric, grader prompt, gap tags and schemas must change together,
  and sessions keep their section keys, so a framework change breaks in-progress sessions.
- Tests use a fake provider server; no keys, network or Whisper needed. Add a test for behavior changes.
- UI changes: click through Home, a session, the report, Settings and Usage; static export is stricter than the dev server.
- `db.py` schema changes need a `user_version` migration; try it on a copy of a real `coach.db` via `LEMMA_HOME`.
- Prompt or rubric changes: re-grade a saved session before and after and compare scores.
- Shipping the app: `./packaging/build_app.sh` (see DEVELOPMENT.md).
