DESIGN COACH: practice system design interviews out loud

INSTALL
1. Drag "Design Coach" onto the Applications folder.
2. Open it from Applications.

IF macOS SAYS IT CANNOT VERIFY THE APP
This app is not from the App Store. The first time only:
  - macOS 14 and earlier: right-click (or Control-click) Design Coach, choose Open, then Open again.
  - macOS 15 and later: try to open it once, then go to System Settings > Privacy & Security,
    scroll down and click "Open Anyway", then confirm.
After that it opens normally.

FIRST LAUNCH
  - Allow the microphone when macOS asks. Your voice is transcribed on this Mac; the audio never leaves it.
  - The speech model (about 1.5 GB) downloads once. You need an internet connection for that.
  - The home screen walks you through choosing a grader: a free model (OpenRouter or Groq key)
    or your Claude subscription.

REQUIREMENTS
Apple Silicon Mac (M1 or newer).

YOUR DATA
Everything is stored in the folder  SystemDesignCoach  in your home folder (sessions, recordings, grades).
Back it up by copying that folder. To uninstall, drag the app to the Trash; delete that folder only if you
also want to erase your history. API keys are in the macOS Keychain (Keychain Access, item "DesignCoach").
If something goes wrong, the log is SystemDesignCoach/logs/app.log.
