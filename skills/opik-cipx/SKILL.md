---
name: opik-cipx
description: How the opik-cipx cost-tracking proxy works — architecture, the CLI, where it stores state, how it's enabled and disabled, privacy and telemetry, and how to read `opik-cipx status`. Use whenever the user asks about opik-cipx, token/cost tracking, or Opik spans, or when spans stop reaching Opik, Claude Code seems to bypass the proxy, or you need to explain, diagnose, or repair any part of it.
allowed-tools: Bash
---

# opik-cipx

opik-cipx is a local reverse HTTP proxy between Claude Code and the Anthropic
API. Claude Code is pointed at it through `ANTHROPIC_BASE_URL`; opik-cipx owns
the TLS leg to `api.anthropic.com`. It captures every call, attributes the
token bill to cost buckets, and ships per-call spans to Opik. It is a single Go
binary — both the long-lived gateway and the short-lived commands below.

## How a session gets wired

Installing the plugin is the whole opt-in. Each Claude Code **SessionStart**
runs the plugin's hook launcher, which locates the binary and execs
`opik-cipx sync` (the hook event argument is ignored — `sync` is the same
operation every time). From then on every API call flows through opik-cipx.
There is no per-project or per-repo toggle and no marker file.

Wire path: Claude Code → `http://127.0.0.1:9909` (plain HTTP, loopback) →
opik-cipx tees the request and response → forwards over TLS to Anthropic. The
proxy only tees bytes; categorization and span-building run on a background
materializer so they never block the wire.

## Turning capture on and off

- **On:** install the plugin, or run `opik-cipx sync`. It is on by virtue of
  being installed.
- **Off:** set `CIPX_DISABLED` to a truthy value (`1`, `true`, `yes`, `on`).
  The next `opik-cipx sync` tears the install down — removes the launchd /
  systemd supervisor unit and clears the managed `ANTHROPIC_BASE_URL` — so
  Claude Code routes straight to Anthropic. As a backstop, `opik-cipx proxy`
  exits 0 immediately while disabled. Disabling never breaks the Claude Code
  session.
- **Back on:** `unset CIPX_DISABLED`, then `opik-cipx sync` (or restart Claude
  Code). Settings take effect only on (re)start — there is no hot-reload.

## CLI

All commands are subcommands of the single `opik-cipx` binary. Only
`opik-cipx proxy` is long-lived; the rest are short-lived helpers.

- `opik-cipx status [--json]` — snapshot the running daemon (read-only).
- `opik-cipx sync` — the SessionStart entry point: install/refresh the OS
  supervisor, bring the daemon up if it's down, and point Claude Code's
  `ANTHROPIC_BASE_URL` at the proxy. Idempotent; safe to run anytime.
- `opik-cipx restart` — force the daemon to restart and pick up the latest
  binary on disk.
- `opik-cipx logs` — print and tail the gateway log.
- `opik-cipx viewer [--open]` — print (and with `--open`, launch) the debug-UI
  URL.
- `opik-cipx purge` — stop the daemon and wipe the WAL spool. **Destructive:**
  drops any spans not yet shipped to Opik.
- `opik-cipx uninstall` — stop the daemon, remove the supervisor unit, and
  delete `~/.opik-cipx`. **Destructive.**
- `opik-cipx proxy` — run the gateway in the foreground (normally launched by
  the supervisor, not by hand).
- `opik-cipx replay` — re-derive spans from stored raw captures (offline,
  read-only).

`sync` and `restart` are the safe, idempotent repairs — non-destructive and
fine to run on your own. `purge` and `uninstall` destroy state; confirm with
the user before running either.

## Where state lives

Everything is under `~/.opik-cipx/` (override the root with `$CIPX_HOME`),
created at mode 0700:

- `bin/` — the binary, when installed via the plugin or `install.sh`.
- `logs/cipx.log` — the gateway log (`opik-cipx logs` tails it).
- `config.toml` — optional config file (override its path with `$CIPX_CONFIG`).
- `ports.json` — assigned loopback ports, auto-bootstrapped on first start.
- `state.json` — daemon bring-up handshake (pid, started_at).
- `spool/` — the write-ahead log that buffers spans; it survives Opik outages
  and drains when Opik is reachable again.
- `sessions/<session_id>.json` — per-session identity and repo metadata the
  SessionStart hook writes, joined onto spans at materialization.

## Reading `opik-cipx status`

`status` reads `state.json`, then GETs `/admin/stats` on the admin loopback.
Exit 0 = up, or not running (informational); exit 1 = `state.json` claims a pid
but `/admin/stats` was unreachable (daemon wedged).

**Header** — `running (pid N)`, the listener lines (`claude_code`, `admin`, and
`viewer`, all on `127.0.0.1`), `uptime`, `project`. `not running` → the daemon
is down; run `opik-cipx sync`.

**queue** — `in-memory`, `ready`, `inflight`, `wal hot` (bytes buffered),
`last sync` (age). `wal hot` climbing into hundreds of MiB, or `last sync`
minutes stale → the shipper is stuck; read `opik-cipx logs` for errors against
the Opik URL. A `degraded true` / `last-error` line means the WAL hit
disk-write failures.

**counters** — healthy progress shows in `requests_captured`,
`events_materialized`, `spans_shipped`. Flag any of these nonzero:
`materializer_errors_total`, `raw_captures_dropped`,
`requests_dropped_queue_full`, `spans_dropped_term`, `unknown_endpoints` (a
route cipx doesn't recognize — often a Claude Code wire-format change ahead of
an opik-cipx update), `panics_recovered` (a bug — surface
`~/.opik-cipx/logs/cipx.log`).

**materializer** — `lag_events`, `inflight_raw`, `ready_raw`; lag in the
thousands that won't drain = materializer wedged → `opik-cipx restart`.

**telemetry** — `off (no CIPX_SENTRY_DSN)` is the default. It reads `on` only
when `CIPX_SENTRY_DSN` is set and `CIPX_SENTRY` is not disabled.

`--json` exposes the raw `/admin/stats`. The hard signals when you need
precision: `stats.wal.degraded`, `stats.wal.last_write_error`, and
`stats.wal.dropped_events_inmem` / `dropped_events_disk`.

## Configuration

Resolution precedence is env var → `~/.opik-cipx/config.toml` → built-in
default, and changes need a daemon (re)start. Env vars the binary actually
reads:

- `CIPX_DISABLED` — master kill-switch (see above).
- `CIPX_CAPTURE_CONTENT` — `false` ships counts, costs, and structure but never
  prompt/completion bytes (redacted mode). Capturing content is the default.
- `CIPX_HOME` / `CIPX_CONFIG` — override the state root / config-file path.
- `CIPX_UPSTREAM_PROXY` — forward outbound traffic through another proxy.
- `OPIK_CIPX_BASE_URL` / `OPIK_CIPX_API_KEY` / `OPIK_CIPX_WORKSPACE` /
  `OPIK_CIPX_PROJECT` — the Opik destination, namespaced so they don't collide
  with the Opik SDK's own `OPIK_*` vars. `OPIK_CIPX_DEBUG` toggles debug.
- `CIPX_SENTRY` (`off` disables) and `CIPX_SENTRY_DSN` — anonymous error
  telemetry, opt-in via the DSN.

## Invariants

- **Loopback only.** Proxy, admin, and viewer all bind `127.0.0.1` and refuse
  anything else at startup. If something suggests otherwise, that's a red flag,
  not a thing to "fix".
- **Totals exact, categories proportional.** Token totals come straight from
  Anthropic's `response.usage`; per-bucket numbers are chars-proportional
  estimates. No tokenizer is ever called.
- **No bodies in logs or telemetry.** Auth headers are redacted at capture and
  Sentry events are scrubbed. Quote error strings, never payloads.

## Diagnosing

Run `opik-cipx status` first, then `opik-cipx logs`. `sync` and `restart` fix
most daemon problems and are safe to run yourself; never `purge` or `uninstall`
without asking. If the binary is missing entirely, the fix is reinstalling the
plugin (`/plugin install opik-cipx@opik-enterprise`) or re-running
`install.sh` — the daemon can't self-repair a missing binary.
