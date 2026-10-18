# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]
- Renamed to Lemma (was Design Coach): new name, logo and tagline, one Today page for both tracks, a sidebar grouped into Design and Code, and a
  shared streak. The data folder moves from `~/SystemDesignCoach` to `~/Lemma` on first launch (copied, the old folder is kept), and API keys saved
  under the old Keychain items are still found. Env vars `SD_COACH_*` are now `LEMMA_*`.
- Code: Java language server in the editor (completion, auto-import, live errors, go to definition) when `jdtls` is installed.
- Code: 160 coding problems and 5 multi-level builds from the roadmap. Claude builds each problem once (statement, reference and
  brute-force solutions, test generator); the app runs both on every test and keeps only the cases they agree on. A local Java judge
  runs your code, and a staff-level review grades it on a 1-4 scale against a coding rubric.

## [0.1.0]
- Initial public release: section-by-section spoken practice, local Whisper transcription, Claude/OpenRouter/Groq grading,
  progress tracking, macOS app bundle.
