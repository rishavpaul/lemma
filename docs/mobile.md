# Using Lemma on your iPhone

The Mac does all the work (Whisper, `claude`, SQLite). The phone is a thin client reached over Tailscale, so it only works
while the Mac is on, awake and online. The desktop app and `./run.sh` are unchanged.

## One-time setup

1. Install Tailscale on the Mac and the iPhone and sign in to the same account.
2. In the Tailscale admin console (DNS), turn on MagicDNS and HTTPS certificates. Safari only allows the microphone over HTTPS.

## Each time

```bash
./scripts/mobile.sh
```

Stop `./run.sh` and the desktop app first if they hold port 8765. The script builds the UI if needed, starts the API,
publishes it with `tailscale serve`, and holds the Mac awake with `caffeinate`. It prints a URL like
`https://<mac>.<tailnet>.ts.net/#token=...`. Open it once in Safari, then Share → Add to Home Screen.
Ctrl-C stops the server and unpublishes it.

## How access is controlled

- Only devices on your tailnet can reach the URL. The server still binds to `127.0.0.1`; `tailscale serve` proxies to it.
- Requests that arrive through the proxy must also carry the shared token (`~/Lemma/auth_token`, mode 0600).
  The phone exchanges it once for an HttpOnly cookie. Requests made directly on the Mac need no token.
- To rotate the token, delete that file and restart; every phone will ask again.

## While walking

- The screen stays on during recording (Wake Lock). iOS stops recording if you lock the phone or switch apps, and that clip is lost.
  Keep Coach in the foreground and set Auto-Lock to Never while you practice if the screen still dims.
- Transcription and grading run on the Mac, so a dropped connection doesn't lose work. Reopen the session and it picks up where the jobs are.

## Voice

Articles, questions and feedback are read aloud with Kokoro, a neural voice that runs on the Mac (`app/tts.py`), so the phone
and the desktop app sound the same. It needs `brew install espeak-ng` and the `kokoro-onnx` package (installed by the run
scripts). The first start downloads the ~350 MB model to `~/Lemma/models/kokoro/`. Until it is ready, or if
espeak-ng is missing, the UI falls back to the phone's built-in voices. `GET /api/tts/status` shows which one is active.
Audio is played through an `<audio>` element and registered with the lock-screen media controls.

## Keeping it running

It does not run forever on its own. Plan for these:

- **Reboot, logout or killed process:** the server is a plain background process and does not come back. Rerun `./scripts/mobile.sh`.
- **Sleep:** `caffeinate` blocks idle sleep, not lid-close sleep. Keep the Mac awake, ideally plugged in.
- **Tailscale key expiry:** device keys expire after 180 days by default and the phone then loses the Mac.
  Turn it off: admin console → Machines → the Mac → Disable key expiry.
- **`claude` login:** if grading fails with a banner, run `claude` on the Mac and `/login`.
- **Phone sign-in:** the cookie lasts a year. Open the tokenized URL again when it lapses.
- **UI changes:** reach the phone only after a rebuild; `mobile.sh` rebuilds on start when sources changed.
- **Port 8765** is shared with `./run.sh` and the desktop app. Stop them before starting `mobile.sh`, or set `PORT=`.

## Troubleshooting

- Microphone prompt never appears: the URL must be `https://`, not the 100.x address.
- "Sign in required": the cookie expired or the token was rotated. Open the printed URL again.
- Phone can't connect: check Tailscale is on for the phone and the Mac isn't asleep.
