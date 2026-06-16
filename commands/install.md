---
description: Install or upgrade the cipx binaries and finish setup
allowed-tools:
  - Bash
---

You are running the `/opik:install` command. Your job is to install the cipx
binaries on the user's machine and finish setup.

Steps:

1. Detect the user's OS and architecture with `uname -s` and `uname -m`.
   Windows users can't run this command path; tell them to download the
   `cipx-windows-amd64.zip` archive manually from
   https://github.com/comet-ml/cost-intelligence-proxy/releases and stop.

2. Tell the user you're about to download cipx. Confirm with them if they
   haven't already approved the install in this session.

3. Run the installer:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh)
   ```

   While the repo is private, the user needs a `GH_TOKEN` env var with read
   access. If `curl` fails on a 404, prompt the user to set `GH_TOKEN` and
   re-run.

4. After the install succeeds, run:

   ```bash
   ~/.cipx/bin/cipx setup
   ```

   This generates the local CA, signs a leaf cert for the Anthropic SAN set,
   and writes (or updates) `~/.claude/hooks/SessionStart`. It's idempotent.

5. Tell the user to add `~/.cipx/bin` to their PATH (only if missing), then
   restart Claude Code so the new hook fires from a fresh process.

6. Suggest `/opik:status` to verify the proxy comes up and `/opik:tracing on`
   to enable tracing.

Never assume cipx is already installed. Never silently overwrite an existing
install — if `~/.cipx/bin/cipx` already exists, ask whether to upgrade.
