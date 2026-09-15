# opik-cipx — Codex plugin

Cost intelligence proxy for [Codex](https://github.com/openai/codex). Companion to
the Claude Code plugin at the repo root; both drive the **same** `opik-cipx`
gateway binary.

## What it does

Installs a `SessionStart` hook (`hooks.json` → `scripts/opik-cipx-hook-launcher`)
that runs `opik-cipx sync codex` on every Codex session start. `sync codex`:

- brings up the shared local gateway daemon if it isn't already running, and
- writes `openai_base_url` / `chatgpt_base_url` into `~/.codex/config.toml`
  (scope `codex`, so it never touches Claude Code's config).

This gives Codex an **independent lifecycle driver**: unlike routing Codex
through Claude Code's hook (which broke Codex whenever the daemon was down and
no CC prompt had refreshed it), Codex now starts and re-points itself.

## Install

```
codex plugin marketplace add comet-ml/cost-intelligence-proxy
codex plugin add opik-cipx@opik-enterprise
```

## Hook trust

Codex gates every non-managed hook behind **hook trust**: it content-hashes the
hook entry (event, matcher, command, timeout) and runs it only once that hash is
recorded under `hooks.state` in the user's `~/.codex/config.toml`. Plugin hooks
are always non-managed, even when the marketplace itself is delivered by MDM.

- **Interactive `codex`** prompts once at session start; accept and the hash is
  stored. The two `session-publish` hooks that `sync codex` writes into
  `~/.codex/hooks.json` are trusted the same way, so a fresh install prompts
  for those as well.
- **`codex exec` (non-interactive)** skips an untrusted hook silently — the
  plugin still lists as `installed, enabled`, and nothing is captured. Pass
  `codex exec --dangerously-bypass-hook-trust` in automation that already vets
  its hook sources (a pinned container image, for example).
- **Trust cannot be pre-seeded from managed config.** Codex reads `hooks.state`
  only from the user and session layers; a `trusted_hash` pushed through
  `/etc/codex/config.toml`, `requirements.toml` or macOS managed preferences is
  ignored.
- **Changing the hook re-prompts.** Any edit to the command line or timeout
  changes the hash, and the launcher path is part of the command.

The first session after install is not captured either way: the hook fires
after Codex has read its config, so the base URL it writes takes effect from the
next session on.

## Fleet deployment: use a managed hook, not this plugin

For a fleet, define the hook in a Codex **managed** layer instead of installing
this plugin. Codex trusts managed hooks automatically and users cannot disable
them. Managed layers are `/etc/codex/config.toml` (Linux and macOS), macOS
managed preferences (domain `com.openai.codex`, key `config_toml_base64`
holding the same TOML base64-encoded), and `/etc/codex/requirements.toml`.

1. Install the binary at a path that exists for every user, e.g.
   `CIPX_INSTALL_DIR=/usr/local/bin bash install.sh` from a root MDM script.
2. Ship the Opik destination as `OPIK_CIPX_*` environment or as
   `~/.opik-cipx/config.toml` — see the root README, *Configuration*.
3. Push this TOML as `/etc/codex/config.toml` (or base64 it into the managed
   preference):

   ```toml
   [[hooks.SessionStart]]
   hooks = [
     { type = "command", command = "/usr/local/bin/opik-cipx sync codex", timeout = 30 },
     { type = "command", command = "OPIK_CIPX_HARNESS=codex /usr/local/bin/opik-cipx session-publish", timeout = 10 },
   ]

   [[hooks.UserPromptSubmit]]
   hooks = [
     { type = "command", command = "OPIK_CIPX_HARNESS=codex /usr/local/bin/opik-cipx session-publish", timeout = 10 },
   ]
   ```

   `sync codex` still writes its own `session-publish` entries into the user's
   `~/.codex/hooks.json`; those are non-managed and would prompt once. To
   suppress every user-layer hook, add `allow_managed_hooks_only = true` to
   `/etc/codex/requirements.toml`. That also silences the user's own hooks, so
   it is an IT policy decision; without it the duplicates run twice, which is
   harmless (both commands are idempotent).

## Layout

```
plugins/opik-cipx/
├── .codex-plugin/plugin.json   # manifest; declares "hooks": "./hooks.json"
├── hooks.json                  # SessionStart → launcher (uses ${CLAUDE_PLUGIN_ROOT})
└── scripts/opik-cipx-hook-launcher   # resolves/bootstraps the binary, runs `sync codex`
```

This plugin ships **no binary**. `codex plugin add` copies only the plugin
subtree and does not follow symlinks, so bundling a binary would mean a second
committed copy of the artifact the Claude Code plugin already carries. Instead
the binary lives once per machine in the shared `~/.opik-cipx/bin`; the launcher
resolves it there (or on `$PATH`) and, on a box that has never run `install.sh`
(e.g. Codex-only), bootstraps it from the public release on first run. One
binary per machine, one copy in the repo (Claude Code's root `bin/`, untouched).
