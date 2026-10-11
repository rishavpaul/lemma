# Staff System Design Coach

A local-only practice app for system design interviews. You answer out loud, section by section, using one fixed
seven-part staff-level framework. Each clip is transcribed locally with Whisper, you fix the transcript, and Claude grades it
against a web-researched reference brief. A Progress page tracks you over many sessions.

- Speech-to-text: `mlx-whisper` (`large-v3-turbo`), fully local and free.
- Grading and research: the `claude` CLI in print mode (`claude -p`) through your **Claude Pro subscription**. No API key is
  used; `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are stripped from the subprocess environment.
- Everything is stored under `~/SystemDesignCoach/`. The server binds to `127.0.0.1` only.

## Start

```bash
cd sd-coach
./run.sh            # creates .venv, installs deps, starts the server, opens http://127.0.0.1:8765
```

Needs `uv` and `ffmpeg` (`brew install uv ffmpeg`) and a logged-in `claude` CLI. `PORT=9000 ./run.sh` changes the port,
`NO_OPEN=1 ./run.sh` skips opening the browser. The first launch downloads the Whisper model (about 1.5 GB) in the background;
the Settings page shows its state.

## Using it

1. **Home** -> "Start suggested question" (picks one that stresses your weakest dimensions), "Random", or pick one.
2. In the runner, press **Record** (or Space), talk through the section, **Stop**. Wait for the transcript, fix it,
   then **Save & Next** (⌘↵). The countdown goes amber at 80% of the budget and red when over.
3. After the last section, **Save & Finish** takes you to the report, which fills in as grading jobs complete.
4. **Progress** shows the score trend, the 10 dimensions, time vs budget, recurring gaps and your study queue.

Reloading mid-session resumes at the first unsaved section. The first session on a question also runs a research job
(web search for how real systems do it); section grading waits for it.

## Where things live

| Path | What |
|---|---|
| `~/SystemDesignCoach/coach.db` | SQLite: sessions, transcripts, grades, gaps, jobs, study items |
| `~/SystemDesignCoach/config/` | Editable framework, rubric, questions, prompts, schemas, vocabulary |
| `~/SystemDesignCoach/audio/<session>/` | Recordings (`.webm`/`.mp4`) and converted `.wav` |
| `~/SystemDesignCoach/research/<question>.md` | Reference briefs |
| `~/SystemDesignCoach/exports/<session>.md` | Markdown exports |
| `~/SystemDesignCoach/logs/app.log` | Server log (never contains transcripts or prompts) |

**Back up:** copy the `~/SystemDesignCoach` folder (stop the app first, or copy `coach.db*` together).

## Editing the framework, rubric and questions

Edit the files in `~/SystemDesignCoach/config/`; the app never overwrites them. Restart the server to apply.
`framework.yaml` (sections, budgets, cover lists, staff bars), `rubric.md` (anchors per section; keep the `### <section key>`
headings), `questions.yaml` (add or change questions by `slug`; quote any hint containing a colon), `gap_tags.yaml`,
`grader_system_prompt.md`, `research_system_prompt.md`, `schemas/*.json`, `vocabulary.txt` (Whisper hint, also editable in
Settings). To get a seed file back after a bad edit, delete it and restart. The defaults are in `app/seed/`.
You can also add a custom question (title + prompt) on the Questions page.

## What a session costs

All Claude calls are `claude -p` subprocesses on your Pro plan:

- **1 research call** the first time a question is used (re-run via "Refresh research"): about 5 minutes.
- **7 section grades**: about 1 to 1.5 minutes each with Opus, about 25 s with Sonnet.
- **1 holistic grade**: about 1 to 1.5 minutes with Opus, about 1 minute with Sonnet.

So a repeat session is 8 calls (about 10 minutes of background grading, finishing shortly after you stop talking), and a first
session on a new question is 9 calls. Opus is the default; switch to Sonnet in Settings to use less of your usage limit.
Re-grading a session repeats the 8 calls.

## Troubleshooting

- **Red banner: Claude not available / not logged in.** Run `claude`, then `/login`, then use "Re-check Claude" in Settings.
  If `claude` is installed in an unusual place, set its path in Settings.
- **"Retry" button with a usage-limit message.** Claude Pro limits are used up; they reset after a few hours. Click Retry
  later. Nothing is lost; transcripts are saved.
- **Microphone.** The browser asks for permission the first time. If you denied it, click the lock icon in the address bar
  and allow the microphone for `127.0.0.1`. Only `http://127.0.0.1` (not another hostname) is treated as a secure context.
- **Whisper model download.** The first start downloads `mlx-community/whisper-large-v3-turbo` from Hugging Face; wait for
  the "Whisper model: loaded" chip in Settings. If it fails, check your connection and restart.
- **"p99" transcribed oddly.** Add the term to the vocabulary in Settings; edit the transcript before saving anyway.
- **Grading seems stuck.** Research runs first and can take several minutes; the report shows what is pending. Failed jobs
  show their error with a Retry button. Logs: `~/SystemDesignCoach/logs/app.log`.
