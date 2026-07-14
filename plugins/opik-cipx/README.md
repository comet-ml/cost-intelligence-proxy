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

Codex gates plugin hooks behind **hook trust** (each hook is content-hashed;
an untrusted hook silently no-ops in non-interactive `codex exec`). For fleet
deployment the hook trust must be pre-seeded via Codex managed/MDM config —
see the internal rollout doc. Interactively, Codex prompts to trust the hook on
first run.

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
