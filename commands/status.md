---
description: Show opik-cipx proxy status — pid, port, queue depth, last shipped span, last Opik error
allowed-tools:
  - Bash
---

You are running the `/opik-cipx:status` command. Run `opik-cipx status` and
present the output to the user.

If `opik-cipx` isn't on PATH, fall back to `~/.opik-cipx/bin/opik-cipx
status`. If neither exists, tell the user to install opik-cipx (see the
plugin's README) and stop.

Highlight anything that looks wrong:

- `pid: -` or `port: -` → proxy is not running. Suggest restarting Claude
  Code to fire the SessionStart hook, or running `opik-cipx ensure-running`
  directly.
- `queue_depth` consistently large or `last_opik_error` present → Opik is
  unreachable or rejecting; surface the error and suggest checking
  `OPIK_BASE_URL` / `OPIK_API_KEY`.
- `telemetry: on` (Sentry) — note this is anonymous error reporting only and
  can be disabled with `CIPX_SENTRY=off`.
- `tracing: disabled` → point the user at `.claude/.opik-tracing-enabled`
  (per-project) or `OPIK_CC_TRACING_ENABLED=true` to enable.

The command is read-only; never modify state from `/opik-cipx:status`. If the
user asks to fix something, point them at the right command.
