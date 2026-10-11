# BUILD_LOG

## Phase 0: feasibility
- `claude` 2.1.296. Flags confirmed: `-p`, `--output-format json|stream-json`, `--json-schema`, `--system-prompt`, `--model`, `--permission-mode` (incl. `dontAsk`), `--allowedTools`, `--disallowedTools`, `--tools`, `--strict-mcp-config`. **No `--max-turns`** (omitted; timeouts enforce limits).
- Auth: no API key/token/apiKeyHelper anywhere. `/status` (user-pasted): Login method = Claude Pro account.
- Structured call (cwd sandbox, API vars stripped): default/opus/sonnet all OK in 5/6/4 s. Result JSON top-level fields: type, subtype, is_error, result, structured_output, num_turns, session_id, total_cost_usd, usage, modelUsage, permission_denials, stop_reason, terminal_reason, duration_ms, duration_api_ms, api_error_status, uuid (+ timing extras).
- Web search: stream-json showed `WebSearch` tool_use; 3 real URLs returned in 16 s. Read/Bash unavailable.
- Whisper large-v3-turbo: 11 s TTS clip in 0.8 s warm (first run 48 s incl. download). "p99" transcribed as "page 99".
- 309 s audio (clip + 20 s silence x10): 5.7 s, speech at correct timestamps, no looping. One hallucination: trailing "Thank you." over 30 s of silence with no_speech_prob 0.0 -> Phase 2 adds a filler-phrase/repeat filter.
- **Finding:** sandboxed `claude -p` could see claude.ai connector tools (Drive/Docs). Wrapper uses `--tools "WebSearch,WebFetch" --strict-mcp-config` on top of allow/disallow lists. Health call (which uses this exact command) succeeds, so structured output still works.

## Phase 1: skeleton
Built: repo, `run.sh` (port 8765, `NO_OPEN=1` skips browser), uv venv, FastAPI serving index.html, `config.py` seeding, `db.py` schema (user_version migrations), `/api/health`, `/api/framework`, 25 seed questions, all seed config files, vendored Chart.js 4.4.7.
Also built early (needed for health): `grader.run_claude` + `check_health`, `transcribe.warm`.

Verification:
- `./run.sh` -> uvicorn on 127.0.0.1:8765. `/api/health` -> `claude_ok:true, ffmpeg_ok:true, whisper_loaded:true`.
- `sqlite3 coach.db .tables` -> gaps, jobs, questions, research, section_grades, section...(all 11 tables incl. sections, sessions, session_grades, settings, study_items). 25 questions synced.
- config dir holds all 10 seed files. Edited `framework.yaml` title, restarted: file kept, `/api/framework` returned the edit; reverted.

Deviations / notes:
- `questions.yaml` crux_hints needed quoting (colons parsed as dicts) - fixed.
- Default model `opus`.
- `SD_COACH_HOME` env var overrides the data dir (used for scratch runs).

## Phase 2: recording and transcription
Built: `jobs.py` (persistent queue, transcription worker + Claude workers, dependency checks, retry rules), transcription handler + hallucination filter in `transcribe.py`, API routes (questions, sessions, audio upload, transcript PUT, finish, jobs, settings), SPA core (`app.js`: router, safe DOM helpers, escape-first markdown, Home, session runner).

Verification (all run for real):
- 102.5 s `say` clip -> webm (opus) -> `POST .../sections/scope/audio` -> job done in 2.6 s. Transcript matches the spoken text closely; only error "p99" -> "page 99" (now post-corrected by `fix_terms`).
- DB: section status `transcribed`, duration 102.5; `PUT .../transcript` -> status `saved`, edited text + client duration stored, grade_section job enqueued.
- Restart mid-job: 820 s clip, `kill -9` while job `running`; restart logged "requeued 1 running job(s)", job finished (attempts=2), 820 s audio in 21 s.
- Hallucination filter confirmed live: a silent recording produced a phantom segment that was dropped.
- UI via headless Chrome (CDP driver, fake mic playing the speech clip, `--disable-features=AudioServiceSandbox` needed for the fake-audio file): home lists 25 questions, picking one opens the runner, countdown 05:00 -> 04:53 after 7 s, Record/Stop works, upload+transcribe, editable transcript appears, Save & Next advances to section 2; 0 console errors.

Deviations / notes:
- Section countdown starts at first Record press (counts recording time only). `duration_sec` uses recorded time (falls back to ffprobe).
- `grade_session` waits for `grade_section` jobs to be done/failed; a `pending_retry` section blocks it until retried.
- Not verified: real microphone permission prompt (manual).

## Phase 3: Claude calls
Built: `prompts.py` (payload builders), `pipeline.py` (research/grade_section/grade_session handlers, schema validation, grounding check, brief->markdown), routes for research view/refresh, regrade, `/api/health/recheck`. (Handlers live in `pipeline.py` rather than `jobs.py` to avoid circular imports.) Command uses `--tools "WebSearch,WebFetch" --strict-mcp-config` in addition to the allow/disallow lists.

Verification (real `claude -p` calls on the Pro subscription, model opus):
- Research for "Distributed rate limiter": 301 s, 13 sources (11 primary), no grounding warning, 8 architectures, 7 crux areas, 24 key numbers. `curl -sIL` on 3 sources -> HTTP 200 (stripe, databricks, envoy). Written to `research/rate-limiter.md`.
- Section grade on a deliberately weak 297-word scope transcript: 87 s, score 2.0 (senior), tags `scope.missing_nfrs` (high), `scope.missed_crux`, `scope.no_out_of_scope` + others, 8 evidence quotes, 4 fact-checks with URLs, 9 sources; gaps rows written.
- Holistic on a full 7-section fake session: 78 s; 2.0 senior / lean_no, all 10 dimension scores, 3 top gaps, 7-item study plan, drill, model answer. Section grades took 56-87 s each.
- Env isolation: with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` set in the parent, a stub `claude` recorded its environment: none of the three present, PATH kept. A real call with a dummy key in the parent env still succeeded (subscription used). No log line added to the app.
- Forced timeout (5 s): attempt 1 `timeout` -> automatic retry -> attempt 2 `timeout` -> job `failed` with `error_kind: timeout`.
- Invalid `claude_path`: `/api/health` -> `claude_ok:false, error "claude CLI not found"`; resetting restores `claude_ok:true`.

Deviations / notes:
- `level_signal` and half-point rounding are normalized server-side from `score`; unknown gap tags are rewritten to `other.<slug>`.
- Grader system prompt = grader prompt + rubric scale text; per-section anchors travel in the payload.
- Rate-limit errors cannot be provoked on demand; the classification path was not exercised live.

## Phase 4: report and export
Built: `export.py`, `GET /api/sessions/{id}/export.md` (also writes `exports/<id>.md`), `DELETE /api/sessions/{id}`, study-item endpoints (GET/POST upsert by lower-cased concept, PATCH status), full report page (`report.js`: header, dimension + time charts, section cards, holistic extras, Transcript and Reference-brief tabs, job spinners/auto-refresh/Retry, Re-grade). Boot code moved to `boot.js` so page modules register routes first.

Verification:
- `GET /api/sessions/1` returns session, question (hints hidden), 7 sections with grades/jobs, research state, holistic grade, job states.
- Export written (492 lines, 94 KB); first 60 lines read well (verdict, dimension table, gaps, strengths, study plan, drill, model answer).
- Re-grade with sonnet (`POST .../regrade {"model":"sonnet"}`): 7 new section_grades + 1 new session_grades rows (opus rows kept), sections 23-31 s each, holistic 62 s; `GET /api/sessions/1` now reports `grade_meta.model = sonnet`. Job 13 hit a real transient `error_max_structured_output_retries` and was auto-retried successfully.
- Headless Chrome (CDP) on `#/report/1`: header chips, both charts drawn (10 dimension bars + 7 time pairs), staff line, tabs, brief rendered through the safe markdown renderer (no injected HTML), "Add to queue" works, pending spinner shown during regrade. Found and fixed one bug (charts recreated on a reused canvas when switching tabs). 0 console errors after the fix.

Notes: Sonnet scored the same session 2.0/senior as Opus.

## Phase 5: progress, suggestions, study queue
Built: `progress.py` (`/api/progress`, `/api/questions/suggest`), Progress / Questions / Settings pages (`pages.js`).

Verification (3 fake graded sessions inserted via SQL on top of the real session 1):
- `/api/progress` timeline = [2.0, 2.0, 2.5, 3.0] (one latest grade per session; manual query returned 5 rows only because session 1 had both an opus and a sonnet grade). Average time per section over the last 5 sessions (scope 310/300, estimates 172/180, api_data 285/300, hld 465/480) matched `sqlite3` AVG. Gap counts by distinct session (depth.shallow 3, scope.missing_nfrs 3, estimates.not_used 2, ops.no_observability_slos 2) matched `sqlite3`.
- `/api/questions/suggest` -> "Metrics and monitoring system" (stresses estimation + operational maturity; weakest over last 3 = operational maturity 1.7, estimation 1.8), with the reason string.
- Study items: 3 POSTs of the same concept (different case/spacing) merged into 1 row with merged `why`; PATCH validates status.
- Headless Chrome: Progress page draws overall + 10-line dimension chart with the dashed "staff bar", gaps table, study queue with status select, focus card; Questions page: hints hidden until toggled, custom question add, research view renders; Settings: health table, save works. 0 console errors.
- Cleaned up: fake sessions, real test session 1, custom question, study items, test settings. Research brief for rate-limiter kept.

## Phase 6: end-to-end and handoff
Ran a full session through the real API with no shortcuts: 7 `say` clips (35-53 s each) of a deliberately mediocre rate-limiter answer -> webm (opus) -> upload -> transcription -> transcript save -> finish -> section grades -> holistic grade. Research brief for the question already existed (grounded grading).

Measured wall-clock per stage:
| Stage | Time |
|---|---|
| create session | 0.01 s |
| upload + ffmpeg convert (per clip) | 0.1 s |
| transcribe (per clip, 35-53 s audio) | 2 s (4 s for 50 s clip) |
| save transcript | <0.1 s |
| section grade, opus (each) | 51-75 s |
| holistic grade, opus | 83 s |
| Finish click -> holistic done | 478 s (the 7 section grades run serially, concurrency 1, and had only just started when the clips finished uploading) |
| Research (first use of a question, Phase 3) | 301 s |

Results: 7/7 sections graded, none ungrounded; scores [1.5, 3.0, 2.0, 2.5, 2.0, 2.0, 2.5]; holistic 2.0 senior / lean_no with all 10 dimensions; `/api/progress` had timeline, 29 gap rows, 7 time rows, a drill and a suggestion; export 472 lines. No warnings or errors in `app.log` during the run. Session deleted afterwards (research brief kept).

Known limitations:
- Real microphone permission/recording in a real browser was not verified (headless Chrome with a fake mic playing speech was used instead).
- `rate_limit` classification and the "Retry later" UI path could not be provoked on demand and were not exercised live (only timeout, schema-retry and failure paths were).
- Safari/`audio/mp4` fallback is implemented but untested.
- One Claude call at a time by default, so grading finishes ~8 minutes after the last clip on Opus; use Sonnet (or concurrency 2) to speed up at the cost of depth/usage limit.
- Whisper still mishears "p99" as "page 99" occasionally; a post-filter fixes the common form.

## Post-handoff fix: scroll jumping on auto-refresh
Report page (5 s refresh while grading) and session runner (4 s poll while research/feedback pending) rebuilt the page and reset scroll to the top. Fix: soft re-render (no "Loading…" placeholder, scroll restored), report remembers the selected tab, runner `draw()` restores scroll. Verified in headless Chrome: Transcript tab at scrollY 1500 stays at 1500 on the Transcript tab after a soft refresh; 0 console errors. Static files only, so a browser reload picks it up (no server restart needed).

## Collapsible section reports
Each section card on the report page now has a clickable header (caret, score chip, time) and collapses to its score plus summary; "Expand all / Collapse all" buttons above the cards. Default is collapsed; state survives the auto-refresh. Verified in headless Chrome with a fake graded session (default, single toggle, refresh, expand all, collapse all; 0 console errors); fake session deleted.
