# Developing Lemma

For using the app, see [README.md](README.md). This file is for changing it and shipping it.

## 1. Architecture

```
 ┌─────────────── Lemma.app (one process, one window) ───────────────┐
 │  app/desktop.py   pywebview window (WKWebView) + uvicorn thread          │
 │        │                                                                 │
 │        ▼  http://127.0.0.1:<port>                                        │
 │  app/main.py   FastAPI                                                   │
 │    ├─ /api/*      JSON API                                               │
 │    └─ /*          static UI (web/out, exported Next.js)                  │
 │                                                                          │
 │  jobs.py worker loop ──► pipeline.py handlers ──► grader.run_claude()    │
 │                                                     ├─ claude CLI  (claude -p, subscription login)
 │                                                     └─ providers.py (OpenRouter / Groq, HTTPS)
 │  transcribe.py ──► ffmpeg + mlx-whisper (local)                          │
 │  db.py ──► ~/Lemma/coach.db (SQLite)                         │
 └──────────────────────────────────────────────────────────────────────────┘
```

**Two ways to run the same code.** In development the UI is the Next.js dev server (`:3000`) proxying `/api` to FastAPI
(`:8765`). In the shipped app there is no Node: the UI is exported to static files (`STATIC_EXPORT=1`) and FastAPI serves
them itself, so the browser and the API share one origin.

### Backend (`app/`)

| File | Role |
|---|---|
| `main.py` | Routes (sessions, audio upload, jobs, settings, providers, usage) and static UI mount. |
| `jobs.py` | Persistent job queue in SQLite. One transcription worker plus 1 to 2 grading workers. Jobs survive restarts (`running` is re-queued on startup). A job fails with a classified `error_kind` (`rate_limit`, `auth`, `timeout`, `schema`, `other`); `rate_limit` becomes `pending_retry` and waits for the user. |
| `pipeline.py` | The three job handlers: `research`, `grade_section` (7 per session), `grade_session` (1). Builds payloads, validates the JSON the model returns against the schema, normalizes it and writes grades and gaps. |
| `prompts.py`, `diagram.py` | Turn questions, briefs, transcripts and the drawn diagram into the text sent to the model. The diagram is sent as text because the grader cannot see images. |
| `grader.py` | **The only place a model is called.** `run_claude()` picks the backend from the model string, retries once with the validation error appended, and records every call in `llm_calls`. |
| `providers.py` | OpenRouter and Groq through the OpenAI-compatible chat API, the API-key store, model lists, and `recommend()` (the one-click "use a free model" choice). |
| `transcribe.py` | Converts audio with ffmpeg and transcribes with `mlx-whisper`; drops hallucinated segments over silence. |
| `config.py` | Paths, settings, and seeding of `~/Lemma/config/` from `app/seed/` (never overwrites user edits). |
| `db.py` | SQLite schema with `user_version` migrations, plus the usage ledger. |
| `code/` | The coding vertical: `routes.py` (API), `handlers.py` (jobs), `generate.py` (build and validate a problem), `judge.py`, `runner.py` (javac/java), `compare.py`, `sandbox.py` (model-written Python), `java/Harness.java`. See AGENTS.md. |
| `desktop.py` | Desktop entry point: single-instance lock, free port, native window, microphone permission handler, save/open bridge. |

### Model strings

A model setting is either a Claude alias (`opus`, `sonnet`, `fable`, `haiku`) or `<provider>:<id>`, for example
`openrouter:openai/gpt-oss-120b:free` or `groq:openai/gpt-oss-120b`. `providers.parse_model()` splits them; anything
without a known provider prefix goes to the `claude` CLI. Research is Claude-only (it needs live web search), which
`config.put_settings` enforces.

Every backend returns the same result dict (`ok`, `structured`, `raw`, `error_kind`, `error`, `duration_s`), so
`pipeline.py` and the usage page do not care which one ran. To add a provider: add an entry to `providers.PROVIDERS`
(base URL, env var name, key page URL). Anything OpenAI-compatible needs no other code.

### API keys

Stored in the macOS Keychain (service `Lemma`, account = provider) through `/usr/bin/security`, with a `0600` file
(`config/.secrets.json`) as fallback. Environment variables `OPENROUTER_API_KEY` / `GROQ_API_KEY` override both. The API
never returns a key, only `configured` and the last four characters. A key is verified with the provider before it is saved.

### Frontend (`web/`)

Next.js (App Router, Tailwind, shadcn/ui, Excalidraw for the canvas). Read `web/AGENTS.md` first: this Next.js version has
breaking changes, so check `web/node_modules/next/dist/docs/` before using an API from memory.

- Pages are client components fetching `/api/*` through `src/lib/api.ts` and `useApi`.
- Dynamic routes are not used, because static export cannot serve unknown ids. Sessions and reports are
  `/session/?id=3` and `/report/?id=3`, read with `useSearchParams` inside `<Suspense>`.
- `components/model-picker.tsx` is the provider and model chooser (settings and the report's Re-grade control);
  `components/setup-guide.tsx` is the first-run panel on the home screen.
- `components/shell/app-shell.tsx` also routes `target=_blank` clicks to the native shell when running in the desktop window.

### Packaging (`packaging/`)

`build_app.sh` assembles `dist/Lemma.app`:

```
Lemma.app/Contents/
  MacOS/Lemma        shell launcher: sets PATH, PYTHONHOME, USER, LEMMA_WEB, then execs python3.12
  MacOS/python3.12         the interpreter, placed here so macOS treats the bundle as the running app
                           (this is what lets the Info.plist microphone text apply)
  Resources/python/        standard library (trimmed)
  Resources/site-packages/ fastapi, uvicorn, mlx-whisper, pywebview, imageio-ffmpeg ...
  Resources/src/app/       this repo's app/ package
  Resources/web/           the exported UI
  Resources/bin/ffmpeg     symlink to imageio-ffmpeg's static binary (ffprobe is a stub)
  Info.plist, Resources/Lemma.icns
```

Things that are easy to break:

- Wheels are installed with `--python-platform aarch64-apple-darwin` so they target an old macOS, not the build machine.
  The script reads the real minimum from the binaries (`vtool`) and writes it to `LSMinimumSystemVersion`.
- `torch` is deleted from the bundle; `mlx-whisper` only needs it for model conversion. If an import of `mlx_whisper`
  fails after a dependency bump, this is the first place to look.
- Finder launches apps with a bare environment. The launcher exports `USER`/`LOGNAME` because the `claude` CLI finds its
  login in the Keychain by `$USER`; without it Claude reports "Not logged in". `grader.clean_env()` repeats this for each call.
- The bundle must not contain absolute symlinks (the build checks) and the Python it copies must be the real directory,
  not uv's symlink to it.

## 2. Build and test changes

### Prerequisites

`brew install uv node` (ffmpeg is only needed for the dev server, `brew install ffmpeg`). Apple Silicon Mac. A logged-in
`claude` CLI if you want to exercise Claude models.

### Day-to-day development

```bash
cd lemma
./run.sh                      # API on :8765, UI on :3000, opens the browser (production UI build)
DEV=1 ./run.sh                # UI with hot reload
LEMMA_HOME=/tmp/coach-scratch ./run.sh   # throwaway data directory; use this when testing destructive changes
```

`run.sh` creates `.venv` and installs the Python dependencies itself. Python changes need a restart of `run.sh`; UI changes
rebuild automatically (or hot reload with `DEV=1`).

### Checks

```bash
# Python: provider backend against a fake local server (no keys or network needed)
.venv/bin/python -m unittest discover -s tests -t .

# UI: types and lint
cd web && npx tsc --noEmit && npx eslint src
```

There is no other automated test suite. The rest is verified by hand, so for a change in these areas do the matching check:

| You changed | Check |
|---|---|
| `providers.py`, `grader.py` | Unit tests above. Then a real call: Settings > add a key > pick a model for section grading > finish a short session. Check the Usage page shows the call. |
| Prompts, rubric, schemas | Re-grade a saved session with the old and new version from the report page and compare scores. |
| `jobs.py`, `pipeline.py` | Kill the server while a job is `running`, restart, confirm it resumes. Force a failure (wrong key) and confirm the Retry button appears. |
| `transcribe.py`, recording UI | Record a short answer; confirm transcript, then check the log has no transcript text. |
| Anything in `web/` | Click through Home, a session, the report, Settings, Usage. Use the browser at `:3000`, then confirm again in the built app (step below), because static export is stricter. |
| `app/code/`, `app/seed/code/` | `unittest` (needs a JDK). Then build one real problem from the Code page and check that the report on the About tab says the two solutions agreed; submit a wrong and a slow solution and confirm both fail; ask for a staff review. |
| Schema or migrations in `db.py` | Run against a copy of a real `coach.db` via `LEMMA_HOME`. |

Keep real keys out of tests; the fake server in `tests/test_providers.py` is the pattern to extend.

### Test the real app

```bash
./packaging/build_app.sh          # about 2 minutes; output: dist/Lemma.app
open "dist/Lemma.app"
```

The build ends with a smoke test: it starts the app with a bare environment (like a Finder launch), waits for the API and
UI to respond, and reports whether the Claude login check passes. A failed smoke test fails the build.

Still check by hand in the built app, because nothing automated covers it:

1. The icon appears in the Dock and the window renders.
2. Recording asks for the microphone once, then works.
3. Export markdown opens a save dialog.
4. Links to external pages open in your browser.
5. A second launch shows "already running" instead of a second window.
6. Settings > API keys: save, replace and remove a key; open Keychain Access and confirm item `Lemma` appears and disappears.

To test the first-run experience, use a fresh data directory: `LEMMA_HOME=/tmp/fresh "dist/Lemma.app/Contents/MacOS/Lemma"`
(the Whisper model is cached by Hugging Face, so delete `~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo`
to test the download as well). Quit any running copy first, or the single-instance lock will stop it.

Never run `rm` inside the bundle through a symlinked path; this once deleted files from the uv-managed Python on the
build machine. The build now refuses to trim a Python directory that is a symlink.

## 3. Publish the app

### Versioning

Set `VERSION` when building; it becomes `CFBundleShortVersionString` and `CFBundleVersion` (default `1.0.0`). Add what
changed to `docs/BUILD_LOG.md`.

### Option A: share an unsigned build (friends, a small group)

```bash
VERSION=1.1.0 DMG=1 ./packaging/build_app.sh
```

Produces `dist/Lemma.dmg` (drag-to-Applications installer with a "Read me first" file). The app is ad-hoc signed, so
on another Mac macOS shows a one-time "cannot verify" warning; the Read-me explains right-click > Open (macOS 14 and
earlier) and System Settings > Privacy & Security > Open Anyway (macOS 15 and later). Send people the `.dmg`, not a zip of
the `.app` (zipping through some tools strips the signature).

### Option B: signed and notarized (anyone, no warnings)

Needs a paid Apple Developer account. One-time setup:

1. In Xcode or the developer portal create a **Developer ID Application** certificate and install it in your login Keychain.
   Find its name with `security find-identity -v -p codesigning`.
2. Create an app-specific password at appleid.apple.com, then store notary credentials:
   ```bash
   xcrun notarytool store-credentials design-coach --apple-id you@example.com --team-id TEAMID --password <app-specific-password>
   ```

Each release:

```bash
VERSION=1.1.0 DMG=1 \
SIGN_ID="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE=design-coach \
./packaging/build_app.sh
```

This signs with the hardened runtime and `packaging/entitlements.plist` (microphone, plus the memory and library
permissions Python and MLX need), builds the DMG, signs it, submits it to Apple, waits for the result and staples the
ticket so it opens offline. This path has not been run yet: expect to debug the first notarization. If it is rejected,
`xcrun notarytool log <submission-id> --keychain-profile design-coach` lists the offending binaries; unsigned or
wrongly signed `.so` files inside `site-packages` are the usual cause.

Verify the result on a Mac that has never seen the app, or at least clear the quarantine state:

```bash
spctl -a -vv "dist/Lemma.app"            # should say: accepted, source=Notarized Developer ID
xcrun stapler validate "dist/Lemma.dmg"
```

### Distributing

Upload the `.dmg` to a GitHub Release (or any file host) and note the version, the minimum macOS (printed by the build,
currently 13.5), and that it is Apple Silicon only. There is no auto-update; users download the new DMG and replace the app.
Their data (`~/Lemma`) and Keychain entries are untouched by a replacement, and database migrations run on next launch.

### Release checklist

- [ ] `unittest`, `tsc`, `eslint` pass
- [ ] `./packaging/build_app.sh` smoke test passes
- [ ] Manual checks 1 to 6 above pass in the built app
- [ ] Built with the new `VERSION`; DMG opens and the app copies to Applications
- [ ] Tested on a fresh data directory (first-run guide, free-model path, Claude path)
- [ ] If signed: `spctl` and `stapler validate` pass
- [ ] `docs/BUILD_LOG.md` updated, DMG uploaded
