---
description: Show cipx proxy status — pid, port, queue depth, last shipped span, last Opik error
allowed-tools:
  - Bash
---

You are running the `/opik:status` command. Run `cipx status` and present
the output to the user.

If `cipx` isn't on PATH, fall back to `~/.cipx/bin/cipx status`. If neither
exists, tell the user to run `/opik:install` first.

Highlight anything that looks wrong:

- `pid: -` or `port: -` → proxy is not running. Suggest restarting Claude
  Code to fire the SessionStart hook, or running `cipx-hook` directly.
- `queue_depth` consistently large or `last_opik_error` present → Opik is
  unreachable or rejecting; surface the error and suggest checking
  `OPIK_BASE_URL` / `OPIK_API_KEY`.
- `telemetry: on` (Sentry) — note this is anonymous error reporting only and
  can be disabled with `CIPX_SENTRY=off`.
- `tracing: disabled` → suggest `/opik:tracing on` to enable.

The command is read-only; never modify state from `/opik:status`. If the
user asks to fix something, point them at the right command.
