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
