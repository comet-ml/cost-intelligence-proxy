# Cost Intelligence Proxy for Claude Code (opik-cipx)

`opik-cipx` is a local reverse HTTP proxy that sits between Claude Code and
the Anthropic API. Claude Code routes through it via `ANTHROPIC_BASE_URL`;
opik-cipx owns the TLS leg to `api.anthropic.com`. It captures every call on
the wire, categorizes input/output bytes into cost buckets — system prompt,
tools, memory, agents, skills, MCP, user input, tool I/O — and ships
per-call spans to [Opik](https://github.com/comet-ml/opik) so you can answer
"where did my tokens go and how much did they cost?"

> **Status:** pre-release scaffolding. Releases tagged `v0.0.x` exercise the
> build pipeline; the binaries do not yet do useful work. Wait for `v0.1.0`+
> before deploying for real. Source lives in
> [comet-ml/cost-intelligence-proxy-internal](https://github.com/comet-ml/cost-intelligence-proxy-internal)
> (currently private).

## Features

- **Wire capture** — totals come straight from Anthropic's `response.usage`,
  so token counts and costs are exact, not estimated.
- **Per-category attribution** — request + response bytes are bucketed (system
  prompt, builtin tools, MCP servers, skills, memory, custom agents, prior
  assistant turns, tool I/O, user prompts, …) using chars-proportional math
  over the actual wire bytes. No tokenizer dependency.
- **Subagent + compaction aware** — subagent calls peer under the same trace;
  `/compact` triggers carry a `cc.compaction` flag with size deltas.
- **MCP per-server breakdowns** — see which MCP server is costing you tokens.
- **Survives Opik outages** — local WAL spools spans; the shipper drains when
  Opik comes back.
- **Single binary** — `opik-cipx` is the long-lived gateway *and* the
  short-lived process Claude Code's `SessionStart` hook invokes (subcommand
  `opik-cipx sync`).

## How it works

```
   ┌──────────────────────┐         ┌─────────────────────────────┐
   │  Claude Code         │  HTTP   │  opik-cipx (127.0.0.1:9909) │   TLS
   │  ANTHROPIC_BASE_URL ─┼────────►│  reverse proxy ─────────────┼──► Anthropic API
   │  http://127.0.0.1:99 │         │  capture req + resp         │
   └──────────────────────┘         │  categorize + build span    │
                                    │  WAL spool → Opik shipper   │
                                    └────────────────┬────────────┘
                                                     │
                                                     ▼
                                                   Opik
```

The plugin's `SessionStart` hook execs `opik-cipx sync` on every Claude Code
launch. `sync` is idempotent: it installs the OS supervisor (launchd /
systemd) so the daemon auto-restarts on crash, brings the daemon up if it
isn't already running, and upserts `ANTHROPIC_BASE_URL` into
`~/.claude/settings.json` so Claude Code routes through
`http://127.0.0.1:9909`. No filesystem-level CA installs, no per-host MITM
cert dance — Claude Code talks plain HTTP to the loopback listener and
opik-cipx is the only thing holding a TLS session to Anthropic.

## Install

### Claude Code plugin (recommended)

From within Claude Code:

```
/plugin marketplace add comet-ml/cost-intelligence-proxy
/plugin install opik-cipx@opik-enterprise
```

The plugin installs the `SessionStart` hook that keeps the opik-cipx gateway
alive between Claude Code sessions, plus the `/opik-cipx:opik-cipx` skill
(how it works + diagnostics). The hook tolerates a missing binary — it just
prints a hint to install opik-cipx and lets the session continue.

The plugin ships the binary in its own tree, so a clean plugin install needs
nothing more. For a non-plugin setup, drop the binary with `install.sh` (see
below), then restart Claude Code — the `SessionStart` hook runs `opik-cipx
sync`, which wires everything up.

### Local plugin install (contributors)

If you've cloned this repo locally and want to install your working copy
instead of the published version:

```
/plugin marketplace add /path/to/cost-intelligence-proxy
/plugin install opik-cipx@opik-enterprise
```

### macOS / Linux (curl, no plugin)

If you'd rather skip the plugin and just run `opik-cipx` from your shell:

> The repo is still private, so `install.sh` needs a `GH_TOKEN` with read
> access to release assets. Once we go public this drops away.

```bash
GH_TOKEN=ghp_yourtoken \
  curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash
```

The installer downloads the latest release for your OS/arch, drops
`opik-cipx` into `~/.opik-cipx/bin/`, and prints the next step. Add that
path to your `PATH`, then:

```bash
opik-cipx sync     # supervise + start the daemon and route Claude Code through it
opik-cipx status   # confirm it's up
```

To pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash -s -- v0.0.3
```

### Manual download

Grab the right archive from the
[Releases page](https://github.com/comet-ml/cost-intelligence-proxy/releases):

| Filename | Platform |
|---|---|
| `opik-cipx-darwin-arm64.tar.gz` | Apple Silicon macOS |
| `opik-cipx-darwin-amd64.tar.gz` | Intel macOS |
| `opik-cipx-linux-amd64.tar.gz`  | x86_64 Linux |
| `opik-cipx-linux-arm64.tar.gz`  | arm64 Linux |
| `opik-cipx-windows-amd64.zip`   | Windows |

Each archive contains the `opik-cipx` binary. Verify against `SHA256SUMS`
from the same release before extracting:

```bash
shasum -a 256 -c <(grep darwin-arm64 SHA256SUMS)
mkdir -p ~/.opik-cipx/bin
tar -xzf opik-cipx-darwin-arm64.tar.gz -C ~/.opik-cipx/bin/
```

### Enterprise install (managed settings)

For org-wide deployment, push configuration through Claude Code's
[server-managed settings](https://code.claude.com/docs/en/server-managed-settings) —
Anthropic's admin console delivers JSON to every authenticated user, no MDM
required. (Requires Claude for Teams or Enterprise.)

**Where to set it up:** in [Claude.ai](https://claude.ai), go to
**Admin Settings → Claude Code → Managed settings** and paste the JSON below.
Clients pick it up at next startup or within the hourly poll.

```json
{
  "extraKnownMarketplaces": {
    "opik-enterprise": {
      "source": {"source": "github", "repo": "comet-ml/cost-intelligence-proxy"},
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "opik-cipx@opik-enterprise": true
  },
  "env": {
    "OPIK_CIPX_BASE_URL": "https://www.comet.com/opik/api",
    "OPIK_CIPX_WORKSPACE": "your-org-cc-workspace",
    "OPIK_CIPX_API_KEY": "<workspace-scoped API key>",
    "OPIK_CIPX_PROJECT": "cc-{username}"
  },
  "forceRemoteSettingsRefresh": true
}
```

What each piece does:

- `extraKnownMarketplaces` + `enabledPlugins` — registers this repo as a
  marketplace and force-enables the plugin for every user. Users see it as
  **managed** and can't disable it.
- `OPIK_CIPX_BASE_URL` — Opik installation URL the gateway ships traces to.
- `OPIK_CIPX_WORKSPACE` — sends Claude Code traces to a dedicated workspace,
  isolated from any user's personal Opik work in `~/.opik.config`.
- `OPIK_CIPX_API_KEY` — the workspace-scoped key the gateway uses to write
  traces. Treat as sensitive; the key is shared with every machine it's
  deployed to. Provision with the minimum write scope on the CC workspace.
- `OPIK_CIPX_PROJECT` — supports `{field}` tokens that expand from the user's
  Claude Code OAuth identity. So one config string routes every user to their
  own project.
- `forceRemoteSettingsRefresh: true` — fail-closed startup: blocks the CLI at
  launch until fresh managed settings are fetched, so the brief unenforced
  window on first launch can't leak unmonitored sessions.

The binary itself still needs to land on each machine separately —
enabling the plugin via managed settings gives every user the hook wiring
and the `/opik-cipx:opik-cipx` skill, but the actual `opik-cipx`
binary is dropped by `install.sh` in your provisioning script — see the
[#provisioning](#provisioning) section.

**Available `{field}` tokens:**

| Token | Resolves to |
|---|---|
| `{username}` | local-part of email (before `@`) — e.g. `collinc` |
| `{email}` / `{user_email}` | full email — e.g. `collinc@comet.com` |
| `{user_uuid}` | Anthropic account UUID |
| `{display_name}` | OAuth display name |
| `{org_name}` | Anthropic organization name |
| `{org_uuid}` | Anthropic organization UUID |

Unknown tokens pass through literally so misconfigurations are visible in
Opik rather than silently producing empty project names.

Per-trace identity (`cc.identity.user_email`, `cc.identity.user_uuid`,
`cc.identity.org_uuid`) is also attached to every trace regardless of project
name, plus a `user:<email>` tag, so admins can filter across users in a
shared project too.

## Configuration

Run the Opik CLI to configure the connection if you haven't already:

```bash
pip install opik
opik configure
```

This creates `~/.opik.config` with your API URL, key, and workspace.
`opik-cipx` reads this file when the matching env var isn't set.

### Environment variables

All opik-cipx env vars use the `OPIK_CIPX_` prefix (Opik destination
credentials) or `CIPX_` (proxy behavior) so they don't collide with the
standard Opik SDK variables (`OPIK_API_KEY`, `OPIK_WORKSPACE`, etc.) — users
running both opik-cipx and a regular Opik client can configure them
independently.

| Variable | Purpose |
|---|---|
| `OPIK_CIPX_BASE_URL` | Opik installation URL (e.g. `https://www.comet.com/opik/api`). |
| `OPIK_CIPX_API_KEY` | API key the gateway uses to write traces. |
| `OPIK_CIPX_WORKSPACE` | Opik workspace traces land in. |
| `OPIK_CIPX_PROJECT` | Project name. Supports `{email}`, `{user}`, `{hostname}` templating — see Enterprise install above. |
| `OPIK_CIPX_DEBUG` | `true`/`on` → verbose shipper logging to `~/.opik-cipx/logs/spawn.log`. |

#### opik-cipx-specific

| Variable | Purpose |
|---|---|
| `CIPX_DISABLED` | Master kill-switch. Truthy (`1`/`true`/`yes`/`on`) tears the install down on the next `opik-cipx sync` so Claude Code routes directly to Anthropic. |
| `CIPX_SENTRY` | `off` disables anonymous error reporting (on by default). |
| `CIPX_SENTRY_DSN` | Sentry DSN for anonymous panic/error reports. Telemetry is opt-in via this DSN. |
| `CIPX_UPSTREAM_PROXY` | Forward outbound traffic through this proxy. |
| `CIPX_CONFIG` | Path to the opik-cipx config file (default `~/.opik-cipx/config.toml`). |
| `CIPX_CAPTURE_CONTENT` | `false` ships counts and costs only, never prompt or completion bytes. |

### `~/.opik.config` integration

Keep opik-cipx's settings in a dedicated `[opik_cc]` section so they don't
disturb the SDK config:

```ini
[opik]
url_override = https://www.comet.com/opik/api/
api_key = your-api-key
workspace = my-sdk-workspace
project_name = my-sdk-project

[opik_cc]
workspace = comet-all
project_name = claude-code
```

The plugin reads keys it recognises (`workspace`, `project_name`,
`url_override`, `api_key`) from the whole file, with later values overriding
earlier ones — so the `[opik_cc]` values win only when that section comes
last. Environment variables (`OPIK_CC_WORKSPACE`, `OPIK_CC_PROJECT`) always
take precedence over the file.

You can also override `url_override` and `api_key` in `[opik_cc]` to point
Claude Code traces at a **different Opik instance** than the SDK:

```ini
[opik_cc]
url_override = https://my-other-opik/api/
api_key = other-instance-api-key
workspace = comet-all
project_name = claude-code
```

Set `url_override` and `api_key` together — a URL pointing at one instance
with another instance's key will fail auth.

### Turning capture on and off

There's no per-project marker file and no per-repo toggle — **installing the
plugin is the opt-in.** Once it's installed, every Claude Code session runs
`opik-cipx sync` at SessionStart, which keeps the proxy supervised and points
Claude Code's `ANTHROPIC_BASE_URL` at it. From then on every call is captured
automatically; there is nothing to switch on per repo.

To turn capture **off**, set the `CIPX_DISABLED` kill-switch (any of `1`,
`true`, `yes`, `on`):

```bash
export CIPX_DISABLED=1
```

It's an environment variable, not a file, so it applies wherever it's set — a
single shell or your whole login environment. The next `opik-cipx sync` (i.e.
the next SessionStart) reads it and **tears the install down**: it removes the
launchd / systemd supervisor unit and clears the managed `ANTHROPIC_BASE_URL`,
so Claude Code routes straight to Anthropic with no proxy in the path. As a
backstop, `opik-cipx proxy` also exits 0 immediately when launched while
disabled, so a stray supervisor can't resurrect it. Either way your Claude
Code session stays healthy — disabling never breaks the wire.

To turn capture back **on**:

```bash
unset CIPX_DISABLED
opik-cipx sync          # or just restart Claude Code — SessionStart runs sync
```

Settings take effect only on (re)start — there is no mid-session hot-reload.
Toggling `CIPX_DISABLED` means restarting Claude Code, or re-running
`opik-cipx sync`, before the change is picked up.

## Privacy: redacted-mode

For environments where prompt and completion bytes can't leave the machine,
set:

```bash
export CIPX_CAPTURE_CONTENT=false
```

opik-cipx then ships counts, costs, structure, and identity — but never the
prompt or completion bytes. Specifically dropped:

- `span.input` / `span.output` (raw request and response on the LLM-call span)
- Sub-span `input` / `output` (tool args + tool_results)
- `cc.user_prompt.text` (keeps `text_chars`)
- `cc.slash_command.args` and `<local-command-stdout>` (keeps the lengths)
- `cc.tool_io.by_tool[*].sample_chars` (keeps counts and lengths)

Kept: all `cc.categories` numbers, `cc.usage`, `cc.metrics_rollup`,
`cc.tools.summary`, `cc.slash_commands.summary.by_command[*]`, all
`cc.skills` / `cc.memory` / `cc.agents` metadata (paths, SHAs, body_tokens —
not body text).

Every span shipped under redaction carries `cc.privacy = {capture_content:
false, applied_at: <ts>}` so consumers can filter
`WHERE cc.privacy.capture_content = false`.

## Skills (plugin)

After `/plugin install opik-cipx@opik-enterprise`:

| Skill | Purpose |
|---|---|
| `/opik-cipx:opik-cipx` | How opik-cipx works — architecture, the CLI, state layout, enable/disable, privacy/telemetry, and how to read `opik-cipx status`. Claude pulls it in on its own when you ask about opik-cipx or when spans stop reaching Opik; you can also call it directly. |

## Debugging

```bash
opik-cipx status   # pid, port, queue depth, last Opik error, telemetry on/off
opik-cipx logs     # tail ~/.opik-cipx/logs/cipx.log
opik-cipx viewer   # local HTTP UI on 127.0.0.1: list captures, see where each byte was attributed
```

`opik-cipx viewer` renders the raw request body with every region colored by
the category it landed in — red bytes are unattributed, indicating a
categorizer gap or a new CC wire-format variant.

## External trace linking

Link Claude Code sessions to existing Opik traces — useful for embedding CC
in larger workflows:

```bash
export OPIK_CC_PARENT_TRACE_ID="your-trace-id"
export OPIK_CC_ROOT_SPAN_ID="your-span-id"
```

All opik-cipx spans land under the existing trace/span instead of creating
new session-level traces.

## MCP server setup

The [Opik MCP server](https://github.com/comet-ml/opik-mcp) gives Claude
tools to query your Opik data — traces, experiments, evaluation results —
directly in conversation. It's independent of opik-cipx (opik-cipx ingests
traces; the MCP server queries them).

For Opik Cloud, add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "opik": {
      "command": "npx",
      "args": ["-y", "opik-mcp", "--apiKey", "YOUR_OPIK_API_KEY"]
    }
  }
}
```

For self-hosted Opik, replace with `--apiBaseUrl http://localhost:5173/api`
(or your URL).

## Uninstall

```bash
opik-cipx purge       # stops the gateway, wipes ~/.opik-cipx/spool
opik-cipx uninstall   # removes ~/.opik-cipx and the managed CC hook scripts
```

`opik-cipx uninstall` only deletes hook scripts whose first line carries the
opik-cipx managed-header marker, so it won't touch hooks you wrote by hand.

## Provisioning

For deploying opik-cipx across a team:

- **Homebrew tap** (planned) — `brew install comet-ml/tap/opik-cipx`.
- **Provisioning script** — drop `install.sh` into Ansible / Chef / Salt /
  whatever you already use.
- **Container images** — none yet; the binary is statically linked so
  copying it in works.

If you're at an org with a managed-settings rollout, pair the install with
the JSON in [Enterprise install](#enterprise-install-managed-settings) above.

## Reporting issues

While the repo is private, file issues on
[comet-ml/cost-intelligence-proxy-internal](https://github.com/comet-ml/cost-intelligence-proxy-internal/issues).
Once we go public the issue tracker on this repo becomes the primary entry
point.

## License

TBD — will be set before this repo becomes externally visible.
