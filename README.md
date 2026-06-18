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
  short-lived process Claude Code's session hooks invoke (subcommand
  `opik-cipx hook claude_code <event>`).

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

`opik-cipx setup` writes the SessionStart + PreToolUse hook scripts under
`~/.claude/hooks/` and prints the `~/.claude/settings.json` snippet that
points Claude Code at `http://127.0.0.1:9909` via `ANTHROPIC_BASE_URL`. The
SessionStart hook calls `opik-cipx hook claude_code session-start`, which
double-fork-detaches the gateway if it isn't already alive. No
filesystem-level CA installs, no per-host MITM cert dance — Claude Code
talks plain HTTP to the loopback listener and opik-cipx is the only thing
holding a TLS session to Anthropic.

## Install

### Claude Code plugin (recommended)

From within Claude Code:

```
/plugin marketplace add comet-ml/cost-intelligence-proxy
/plugin install opik-cipx@opik-enterprise
```

Then drop the binary and finish setup with the plugin's own command:

```
/opik-cipx:install
```

The plugin installs the `SessionStart` + `PreToolUse` hooks that keep the
opik-cipx gateway alive between Claude Code sessions, plus the
`/opik-cipx:tracing`, `/opik-cipx:status`, and `/opik-cipx:viewer` slash
commands. `/opik-cipx:install` is the one that downloads the actual binary
from this repo's releases and runs `opik-cipx setup`.

Restart Claude Code after running `/opik-cipx:install` so the hook fires
from a fresh process.

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
opik-cipx setup            # one-time: writes the CC hooks + prints the settings.json snippet
opik-cipx ensure-running   # spawn the gateway if it isn't already up
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
    "OPIK_CC_TRACING_ENABLED": "true",
    "OPIK_BASE_URL": "https://www.comet.com/opik/api",
    "OPIK_CC_WORKSPACE": "your-org-cc-workspace",
    "OPIK_API_KEY": "<workspace-scoped API key>",
    "OPIK_CC_PROJECT": "cc-{username}"
  },
  "forceRemoteSettingsRefresh": true
}
```

What each piece does:

- `extraKnownMarketplaces` + `enabledPlugins` — registers this repo as a
  marketplace and force-enables the plugin for every user. Users see it as
  **managed** and can't disable it.
- `OPIK_CC_TRACING_ENABLED=true` — turns tracing on for every session without
  users dropping per-project files. Individual projects can still opt out by
  writing `off` to `.claude/.opik-tracing-enabled`.
- `OPIK_CC_WORKSPACE` — sends Claude Code traces to a dedicated workspace,
  isolated from any user's personal Opik work in `~/.opik.config`.
- `OPIK_API_KEY` — the workspace-scoped key the gateway uses to write traces.
  Treat as sensitive; the key is shared with every machine it's deployed to.
  Provision with the minimum write scope on the CC workspace.
- `OPIK_CC_PROJECT` — supports `{field}` tokens that expand from the user's
  Claude Code OAuth identity. So one config string routes every user to their
  own project.
- `forceRemoteSettingsRefresh: true` — fail-closed startup: blocks the CLI at
  launch until fresh managed settings are fetched, so the brief unenforced
  window on first launch can't leak unmonitored sessions.

The binary itself still needs to land on each machine separately — enabling
the plugin via managed settings gives every user the slash commands and the
hook wiring, but the actual `opik-cipx` binary is downloaded by
`/opik-cipx:install` (or `install.sh` in a provisioning script — see the
[#provisioning](#provisioning) section).

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

#### Opik connection (shared with the Opik SDK)

| Variable | Purpose | Falls back to |
|---|---|---|
| `OPIK_BASE_URL` | Opik installation URL | `url_override` in `~/.opik.config` |
| `OPIK_API_KEY` | API key | `api_key` in `~/.opik.config` |
| `OPIK_WORKSPACE` | Workspace | `workspace` in `~/.opik.config` |

#### Claude Code-scoped (`OPIK_CC_*`)

Override the shared values without affecting other Opik SDK consumers on the
same machine.

| Variable | Purpose |
|---|---|
| `OPIK_CC_TRACING_ENABLED` | Org-wide master switch. `true` or `1` enables; anything else disables. Designed for managed-settings deployment. |
| `OPIK_CC_PROJECT` | Project name (default `claude-code`). Supports `{field}` templating against the OAuth identity — see Enterprise install above. |
| `OPIK_CC_WORKSPACE` | Workspace override scoped to opik-cipx (leaves global `OPIK_WORKSPACE` alone). |
| `OPIK_CC_DEBUG` | `true` → verbose logging to `~/.opik-cipx/logs/cipx.log`. |
| `OPIK_CC_TRUNCATE_FIELDS` | `false` → ship full payloads (default truncates large fields). |
| `OPIK_CC_PARENT_TRACE_ID` | Attach every span under an existing Opik trace — useful for CI runs that wrap CC in an outer trace. |
| `OPIK_CC_ROOT_SPAN_ID` | Attach under a specific root span within `OPIK_CC_PARENT_TRACE_ID`. |

All opik-cipx env vars use the `OPIK_CC_` prefix or `CIPX_` to avoid
conflicts with the standard Opik SDK variables.

#### opik-cipx-specific

| Variable | Purpose |
|---|---|
| `CIPX_SENTRY` | `off` disables anonymous error reporting (on by default). |
| `CIPX_PORT` | Force a specific listener port (default `9909`, written to `~/.opik-cipx/port`). |
| `CIPX_UPSTREAM_PROXY` | Forward outbound traffic through this proxy. |
| `CIPX_CONFIG` | Path to the opik-cipx config file (default `~/.opik-cipx/config.toml`). |
| `CIPX_CAPTURE_CONTENT` | `false` ships counts and costs only, never prompt or completion bytes. Hot-reloadable. |
| `CIPX_SAMPLE_RATE` | Fraction of LLM calls to ship spans for (0.0–1.0). Hot-reloadable. |

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

### Tracing on/off per project

opik-cipx is off-by-default. Resolution precedence (first match wins):

1. **Project-level marker** — `.claude/.opik-tracing-enabled` in the cwd
   - Content `off` or `disabled` → disabled (per-repo opt-out wins over global
     enable)
   - Content `debug` → enabled + debug mode
   - Any other content (including empty) → enabled
2. **`OPIK_CC_TRACING_ENABLED` env** — `true` or `1` enables; anything else
   disables.
3. **User-level marker** — `~/.claude/.opik-tracing-enabled`, same content
   semantics.
4. **Default** — disabled.

Toggle from the shell:

```bash
echo > .claude/.opik-tracing-enabled            # enable for this repo
echo off > .claude/.opik-tracing-enabled        # disable just this repo
echo debug > .claude/.opik-tracing-enabled      # enable + debug logging
rm .claude/.opik-tracing-enabled                # fall through to env / user / default
```

Changes take effect within seconds — opik-cipx watches the runtime config
and hot-reloads.

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

## Slash commands (plugin)

After `/plugin install opik-cipx@opik-enterprise`:

| Command | Purpose |
|---|---|
| `/opik-cipx:install` | Download the opik-cipx binary for your OS/arch and run `opik-cipx setup`. Idempotent — also used to upgrade. |
| `/opik-cipx:tracing on \| off \| debug \| status` | Toggle the project's tracing marker (or the global one with `--global`). `status` prints the effective state and how it resolved. |
| `/opik-cipx:status` | Show proxy pid, port, queue depth, last shipped span, last Opik error, telemetry on/off. |
| `/opik-cipx:viewer` | Launch the local debug viewer in the background and print its URL. |

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
