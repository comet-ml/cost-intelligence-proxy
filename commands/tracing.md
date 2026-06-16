---
description: Enable, disable, or check Claude Code → Opik tracing
argument-hint: on | off | debug | status [--global]
allowed-tools:
  - Bash
  - Read
  - Write
---

You are running the `/opik:tracing` command. Toggle whether cipx ships spans
to Opik for the current project (or globally with `--global`).

Tracing state is stored in marker files:

- `.claude/.opik-tracing-enabled` (project — current cwd)
- `~/.claude/.opik-tracing-enabled` (global — user-level)

Resolution precedence (first match wins):

1. Project file containing `off` or `disabled` → **disabled** (project-level
   opt-out wins over a global enable).
2. Project file present with any other content (including empty or `debug`) →
   **enabled** (`debug` also enables verbose logging).
3. Global file present → **enabled** (same content rules).
4. Neither file → **disabled**.

Action based on the user's argument:

- **`on`** — write an empty marker file at the right scope. With `--global`,
  write `~/.claude/.opik-tracing-enabled`; otherwise write
  `.claude/.opik-tracing-enabled` in the cwd (create `.claude/` if needed).

- **`off`** — if the marker file exists at the chosen scope, write `off` into
  it. This is the only way to opt a single project out of a global enable —
  do not just delete the marker, because that falls back to whatever the
  global state is.

- **`debug`** — write `debug` to the chosen marker file (enables tracing and
  flips `OPIK_CC_DEBUG` to true for verbose logging).

- **`status`** (or no argument) — report the effective state by reading both
  marker files and applying the precedence above. Show:
  - The project marker (path + contents or `(not set)`)
  - The global marker (path + contents or `(not set)`)
  - The effective decision (enabled / disabled / debug)
  - The value of `OPIK_CC_TRACING_ENABLED` env if set

After flipping state, mention that changes take effect within a few seconds —
cipx watches the runtime config and hot-reloads (no restart needed).
