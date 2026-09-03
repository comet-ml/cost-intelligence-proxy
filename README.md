# Cost Intelligence Proxy for Claude Code (opik-cipx)

`opik-cipx` is a local reverse HTTP proxy that sits between Claude Code and
the Anthropic API. Claude Code routes through it via `ANTHROPIC_BASE_URL`;
opik-cipx owns the TLS leg to `api.anthropic.com`. It captures every call on
the wire, categorizes input/output bytes into cost buckets — system prompt,
tools, memory, agents, skills, MCP, user input, tool I/O — and ships
per-call spans to [Opik](https://github.com/comet-ml/opik) so you can answer
"where did my tokens go and how much did they cost?"

[Opik](https://github.com/comet-ml/opik) is the open-source LLM observability and evaluation platform, built by [Comet](https://www.comet.com). opik-cipx is its cost lens for Claude Code.

> **Status:** actively developed, versioned `v0.0.x`. This repo is the public
> distribution point: it ships the prebuilt binaries (see
> [Releases](https://github.com/comet-ml/cost-intelligence-proxy/releases)) and
> the Claude Code plugin. The source lives in the private
> [comet-ml/cost-intelligence-proxy-internal](https://github.com/comet-ml/cost-intelligence-proxy-internal)
> repo; each release is built from there.

## Features

- **Wire capture** — totals come straight from Anthropic's `response.usage`,
  so token counts and costs are exact, not estimated.
- **Per-category attribution** — request + response bytes are bucketed (system
  prompt, builtin tools, MCP tools, skills, memory, custom agents, prior
  assistant turns, tool I/O, user prompts, …) using chars-proportional math
  over the actual wire bytes. No tokenizer dependency.
- **Subagent aware** — subagent calls are captured and peer under the same
  session.
- **MCP attribution** — MCP tool definitions and results are bucketed
  separately so you can see what your MCP servers cost.
- **Survives Opik outages** — a local WAL spools spans; the shipper drains when
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

```bash
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
curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash -s -- v0.0.35
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
    "OPIK_CIPX_PROJECT": "cc-{user}",
    "ENABLE_TOOL_SEARCH": "auto"
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
  isolated from any user's personal Opik work.
- `OPIK_CIPX_API_KEY` — the workspace-scoped key the gateway uses to write
  traces. Treat as sensitive; the key is shared with every machine it's
  deployed to. Provision with the minimum write scope on the CC workspace.
- `OPIK_CIPX_PROJECT` — supports `{field}` tokens (see below), so one config
  string routes every user to their own project.
- `ENABLE_TOOL_SEARCH` — routing Claude Code through opik-cipx sets a
  non-Anthropic `ANTHROPIC_BASE_URL`, which makes CC (≥ 2.1.70) disable MCP
  tool search by default. opik-cipx forwards requests unmodified, so it's safe
  to keep on — `auto` restores it. (See the MDM section below for the details.)
- `forceRemoteSettingsRefresh: true` — fail-closed startup: blocks the CLI at
  launch until fresh managed settings are fetched, so the brief unenforced
  window on first launch can't leak unmonitored sessions.

The binary itself still needs to land on each machine separately —
enabling the plugin via managed settings gives every user the hook wiring
and the `/opik-cipx:opik-cipx` skill, but the actual `opik-cipx`
binary is dropped by `install.sh` in your provisioning script — see the
[Provisioning](#provisioning) section.

**Available `{field}` tokens** for `OPIK_CIPX_PROJECT`:

| Token | Resolves to |
|---|---|
| `{user}` | local-part of the user's email (before `@`) — e.g. `collinc` |
| `{email}` | full email — e.g. `collinc@comet.com` |
| `{hostname}` | machine hostname |

The gateway also resolves the signed-in user's identity (email, username,
organization) and attaches it to every trace, so admins can filter by user
even inside a shared project.

### Deploy via MDM (managed settings file)

The [Enterprise install](#enterprise-install-managed-settings) above delivers
config through Anthropic's admin console (server-managed settings). If you'd
rather push it with your own MDM — Jamf, Intune, Workspace ONE, Ansible, a
provisioning script — Claude Code also reads an **enterprise managed settings
file** from a fixed system path. Land the same JSON there and every user on
the machine picks it up at next launch; no per-user step.

**Where the file goes** (Claude Code reads it automatically — no env var, no
flag points at it):

| Platform | Path |
|---|---|
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux / WSL | `/etc/claude-code/managed-settings.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-settings.json` |

(The legacy Windows path `C:\ProgramData\ClaudeCode\managed-settings.json` was
dropped in Claude Code v2.1.75.) To split config across files, drop `*.json`
into a `managed-settings.d/` directory beside the file — they merge
alphabetically on top of the base, systemd-style.

Managed settings sit at the **top** of Claude Code's precedence chain —
managed → command-line args → local project (`.claude/settings.local.json`) →
project (`.claude/settings.json`) → user (`~/.claude/settings.json`) — so users
can't override or disable what you set here. The file uses the same schema as
`settings.json`.

**What to put in it** — register the marketplace, force-enable the plugin, and
set the Opik destination:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "extraKnownMarketplaces": {
    "opik-enterprise": {
      "source": {"source": "github", "repo": "comet-ml/cost-intelligence-proxy"}
    }
  },
  "enabledPlugins": {
    "opik-cipx@opik-enterprise": true
  },
  "env": {
    "OPIK_CIPX_BASE_URL": "https://www.comet.com/opik/api",
    "OPIK_CIPX_WORKSPACE": "your-org-cc-workspace",
    "OPIK_CIPX_API_KEY": "<workspace-scoped API key>",
    "OPIK_CIPX_PROJECT": "cc-{user}",
    "ENABLE_TOOL_SEARCH": "auto"
  }
}
```

Notes:

- **Don't set `ANTHROPIC_BASE_URL` here.** `opik-cipx sync` writes it into the
  user's `~/.claude/settings.json` pointing at the loopback listener
  (`http://127.0.0.1:9909`), and clears it again when you flip the
  `CIPX_DISABLED` kill-switch. Pinning it in managed settings would sit *above*
  the user scope and defeat that teardown, leaving a disabled proxy in the wire
  path. Let `sync` own it.
- **`ENABLE_TOOL_SEARCH`** — because CC now talks to a non-Anthropic
  `ANTHROPIC_BASE_URL`, it turns MCP tool search off by default (v2.1.70+).
  opik-cipx is a transparent tee that forwards requests unmodified, so it's
  safe to turn back on: `ENABLE_TOOL_SEARCH=auto` (or, equivalently,
  `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1`) restores it.
- **The binary still ships separately.** Managed settings only carries the
  plugin wiring and env — deploy the `opik-cipx` binary in the same MDM payload
  with `install.sh` (see [Provisioning](#provisioning)).
- To lock down which marketplaces users may add at all, pair
  `extraKnownMarketplaces` with
  [`strictKnownMarketplaces`](https://code.claude.com/docs/en/settings#strictknownmarketplaces)
  in the same file.

#### Step-by-step: rolling it out with any MDM

Any MDM that can run a script as root — or simply place a file — can deploy this:
Jamf, Kandji, Intune, Workspace ONE, JumpCloud, Ansible, or a plain provisioning
script. The mechanics are the same everywhere:

1. **Prepare the JSON.** Start from the managed-settings JSON above and fill in
   your `OPIK_CIPX_WORKSPACE` and a workspace-scoped `OPIK_CIPX_API_KEY`. Keep
   this file out of version control — it carries a credential.

2. **Deliver it to each device**, either way:

   - **File payload** — have the MDM place the JSON at the managed path for the
     OS (paths table above), owned by `root`, mode `0644`. It must be
     world-readable: Claude Code reads it as the *logged-in user*, not as root.

   - **Script payload** — run a small root script that writes and validates the
     file. This is the most portable option, and writing into a
     `managed-settings.d/` drop-in means you won't clobber any other managed
     policy already on the machine. macOS example:

     ```bash
     #!/bin/bash
     set -euo pipefail
     DIR="/Library/Application Support/ClaudeCode/managed-settings.d"
     /bin/mkdir -p "$DIR"
     TMP="$(/usr/bin/mktemp)"
     /bin/cat > "$TMP" <<'JSON'
     { ...your filled managed-settings JSON... }
     JSON
     /usr/bin/plutil -convert json -o /dev/null "$TMP"   # validate; abort if invalid
     /bin/mv "$TMP" "$DIR/50-opik-cipx.json"
     /usr/sbin/chown root:wheel "$DIR/50-opik-cipx.json"
     /bin/chmod 644 "$DIR/50-opik-cipx.json"
     ```

     On Linux use `/etc/claude-code/managed-settings.d/` and validate with
     `python3 -m json.tool` instead of `plutil`. Use absolute tool paths — MDM
     script runners often execute with a minimal `PATH`.

3. **Ship the binary in the same payload** — managed settings only carries the
   plugin wiring and env; the `opik-cipx` binary lands via `install.sh`
   (see [Provisioning](#provisioning)).

4. **Verify** on a device, as the logged-in user, in a *fresh* Claude Code
   session (managed settings load at startup):

   ```sh
   claude plugin list    # opik-cipx@opik-enterprise shows as enabled / managed
   ```

**Targeting and offline devices.** Scope the deployment to machines your current
users actually own so decommissioned devices are excluded. MDMs that queue
actions for offline devices (JumpCloud Commands, for example) apply the settings
when each machine next checks in — leave the deployment in place rather than
removing it, or offline machines never receive it. For MDMs that only act on
online devices, re-run the deployment periodically to pick up machines as they
come online and as new hires are onboarded.

## Configuration

Point the gateway at your Opik installation with the `OPIK_CIPX_*` environment
variables (below) or a `~/.opik-cipx/config.toml` file. Resolution precedence
is **env var → `~/.opik-cipx/config.toml` → built-in default**, and changes
take effect on the next daemon (re)start — there is no mid-session hot-reload.

### Environment variables

opik-cipx env vars use the `OPIK_CIPX_` prefix (Opik destination credentials)
or `CIPX_` (proxy behavior) so they don't collide with the standard Opik SDK
variables (`OPIK_API_KEY`, `OPIK_WORKSPACE`, etc.) — users running both
opik-cipx and a regular Opik client can configure them independently.

| Variable | Purpose |
|---|---|
| `OPIK_CIPX_BASE_URL` | Opik installation URL (e.g. `https://www.comet.com/opik/api`). |
| `OPIK_CIPX_API_KEY` | API key the gateway uses to write traces. |
| `OPIK_CIPX_WORKSPACE` | Opik workspace traces land in. |
| `OPIK_CIPX_PROJECT` | Project name. Supports `{user}`, `{email}`, `{hostname}` templating — see Enterprise install above. |
| `OPIK_CIPX_DEBUG` | `true`/`on` → verbose logging to `~/.opik-cipx/logs/cipx.log`. |

#### opik-cipx-specific

| Variable | Purpose |
|---|---|
| `CIPX_DISABLED` | Master kill-switch. Truthy (`1`/`true`/`yes`/`on`) tears the install down on the next `opik-cipx sync` so Claude Code routes directly to Anthropic. |
| `CIPX_CAPTURE_CONTENT` | `false` ships counts and costs only, never prompt or completion bytes. |
| `CIPX_HOME` | Override the state root (default `~/.opik-cipx`). |
| `CIPX_CONFIG` | Path to the opik-cipx config file (default `~/.opik-cipx/config.toml`). |
| `CIPX_UPSTREAM_PROXY` | Forward outbound traffic through this proxy. |
| `CIPX_SENTRY` | `off` disables anonymous error reporting. |
| `CIPX_SENTRY_DSN` | Sentry DSN for anonymous panic/error reports. Telemetry stays off unless this is set. |

### Config file (`~/.opik-cipx/config.toml`)

Anything you can set with an `OPIK_CIPX_*` / `CIPX_*` env var can also live in
`~/.opik-cipx/config.toml` (env vars win when both are set):

```toml
[opik]
base_url  = "https://www.comet.com/opik/api"
api_key   = "your-api-key"
workspace = "comet-all"
project   = "cc-{user}"

[capture]
capture_content = true
```

Override the file's location with `$CIPX_CONFIG`, or the whole state root with
`$CIPX_HOME`.

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
raw prompt or completion bytes. Request/response bodies and tool
arguments/results are dropped, while every `cc.categories` number, the
`cc.usage` totals, and all category/skill/memory/agent metadata (paths,
counts, lengths) are kept. Capturing content is the default.

## Skills (plugin)

After `/plugin install opik-cipx@opik-enterprise`:

| Skill | Purpose |
|---|---|
| `/opik-cipx:opik-cipx` | How opik-cipx works — architecture, the CLI, state layout, enable/disable, privacy/telemetry, and how to read `opik-cipx status`. Claude pulls it in on its own when you ask about opik-cipx or when spans stop reaching Opik; you can also call it directly. |
| `/opik-cipx:cost-intelligence-policy` | Which MCP servers your organization's cost policy denies for you, and how to turn one off or back on for yourself. Claude Code drops a denied server silently — it vanishes from `/mcp` and `claude mcp list` with no warning — so Claude pulls this in on its own when you ask where a server went. It reads the result of `opik-cipx mcp enable`/`disable` off the exit code, so a refusal is never reported back to you as a success. |

## Commands (plugin)

| Command | What it does |
|---|---|
| `/opik-cipx:cost-intelligence [thing]` | The receipt for "your Claude Code has been optimized". What cipx actually changed on this machine, what your organization's MCP policy actually blocks, what the last 30 days cost and where the tokens went, which cost policies are in effect and who set each one — and, for anything a policy turned off, the one route that turns it back on. Every figure is measured, none estimated. Pass an MCP server, skill, tool or settings key to ask about just that one thing instead. |
| `/opik-cipx:cost-intelligence-mcp` | The MCP policy table on its own: which servers your organization blocks, which are active, and whether you can change it yourself. |

Both commands and the `cost-intelligence-policy` skill call `opik-cipx` as a bare command on
PATH, which the plugin supplies only from the release that adds the
`bin/opik-cipx` dispatcher — on an earlier plugin version they fail with
`command not found` or `unknown command`.

## Debugging

```bash
opik-cipx status   # pid, ports, queue depth, counters, telemetry on/off
opik-cipx logs     # tail ~/.opik-cipx/logs/cipx.log
opik-cipx viewer   # print the local debug-UI URL (add --open to launch it)
```

The viewer renders the raw request body with every region colored by the
category it landed in — unattributed bytes stand out, indicating a
categorizer gap or a new CC wire-format variant.

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
opik-cipx purge       # stops the gateway, wipes the WAL spool (drops unshipped spans)
opik-cipx uninstall   # stops the daemon, removes the supervisor unit, deletes ~/.opik-cipx
```

`opik-cipx uninstall` clears the managed `ANTHROPIC_BASE_URL` and removes
`~/.opik-cipx`, but the Claude Code plugin owns the `SessionStart` hook wiring
— to remove that too, uninstall the plugin from Claude Code
(`/plugin uninstall opik-cipx@opik-enterprise`).

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

File issues on the
[issue tracker](https://github.com/comet-ml/cost-intelligence-proxy/issues)
for this repo.

## Opik for Claude Code

This repo is part of a set of tools for observing Claude Code and other coding agents with [Opik](https://github.com/comet-ml/opik):

- [opik-claude-code-plugin](https://github.com/comet-ml/opik-claude-code-plugin): log Claude Code sessions as Opik traces, with skills and agents included
- [ccsync](https://github.com/comet-ml/ccsync): export Claude Code conversation history to Opik
- [cost-intelligence-proxy](https://github.com/comet-ml/cost-intelligence-proxy): meter Claude Code token spend and cost per call **(this repo)**
- [opik-skills](https://github.com/comet-ml/opik-skills): agent skills for instrumenting your code with Opik

## License

© 2026 Comet ML, Inc. All rights reserved. This software is proprietary and
confidential.
