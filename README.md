# cipx — Cost Intelligence Proxy for Claude Code

`cipx` is a local HTTPS proxy that sits between Claude Code and the Anthropic
API. It captures every call, categorizes input/output bytes into cost buckets,
and ships per-call spans to Opik so you can answer "where did my tokens go?"

This repository hosts the prebuilt binaries. Source lives in the internal repo
and is not yet public.

## Status

Pre-release scaffolding. Binaries currently do nothing — they exist so the
release pipeline can be wired end-to-end. Wait for `v0.1.0` or later before
trying to use this for real.

## Install

### macOS / Linux (curl-pipe)

```bash
curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash
```

The installer downloads the latest release for your OS/arch and drops both
binaries into `~/.cipx/bin/`. Add that to your `PATH`.

### Manual download

Grab the right archive from the [Releases page](https://github.com/comet-ml/cost-intelligence-proxy/releases):

| Filename | Platform |
|---|---|
| `cipx-darwin-arm64.tar.gz` | Apple Silicon macOS |
| `cipx-darwin-amd64.tar.gz` | Intel macOS |
| `cipx-linux-amd64.tar.gz`  | x86_64 Linux |
| `cipx-linux-arm64.tar.gz`  | arm64 Linux |
| `cipx-windows-amd64.zip`   | Windows |

Each archive contains both `cipx` (the main CLI) and `cipx-hook` (the hook
binary invoked from Claude Code's `SessionStart` / `PreToolUse`).

## Claude Code integration

After `cipx setup`:

1. `~/.cipx/ca.crt` is generated and trusted by Claude Code via
   `NODE_EXTRA_CA_CERTS=~/.cipx/ca.crt`.
2. `~/.claude/hooks/SessionStart` invokes `cipx-hook` to ensure the proxy is
   running before each session.
3. The wrapper `cipx run claude ...` sets `HTTPS_PROXY` for the launched CC
   process. No global env pollution.

Detailed integration docs land here once the binaries do real work.

## Releases

Versions are aligned with the source repo: a tag like `v0.1.0` on the
internal repo produces a matching release here with the same tag.

## License

TBD (will be set before public release).
