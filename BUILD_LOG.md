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
