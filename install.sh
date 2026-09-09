#!/usr/bin/env bash
# opik-cipx installer — downloads the latest release for your OS/arch into
# ~/.opik-cipx/bin/.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash -s -- v0.0.35
#
# The repo is public, so no auth is needed. GH_TOKEN is honored if set (e.g.
# to raise the GitHub API rate limit).
#
# Override env vars:
#   CIPX_VERSION      Tag to install (default: latest release)
#   CIPX_INSTALL_DIR  Install dir (default: ~/.opik-cipx/bin)
#   CIPX_REPO         Override repo (default: comet-ml/cost-intelligence-proxy)
#   CIPX_NO_SYNC      Set to skip the `opik-cipx sync` this script ends with
#                     (image builds and packaging, where there is no user's
#                     ~/.claude to configure and no daemon worth starting)

set -euo pipefail

CIPX_VERSION="${1:-${CIPX_VERSION:-latest}}"
CIPX_INSTALL_DIR="${CIPX_INSTALL_DIR:-$HOME/.opik-cipx/bin}"
CIPX_REPO="${CIPX_REPO:-comet-ml/cost-intelligence-proxy}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "opik-cipx: unsupported arch $arch" >&2; exit 1 ;;
esac
case "$os" in
  darwin|linux) ;;
  *) echo "opik-cipx: unsupported os $os (only darwin and linux are supported)" >&2; exit 1 ;;
esac

archive="opik-cipx-${os}-${arch}.tar.gz"

# Resolve "latest" via the GitHub API (GH_TOKEN honored if set).
if [ "$CIPX_VERSION" = "latest" ]; then
  api="https://api.github.com/repos/${CIPX_REPO}/releases/latest"
  hdrs=(-H "Accept: application/vnd.github+json")
  [ -n "${GH_TOKEN:-}" ] && hdrs+=(-H "Authorization: Bearer ${GH_TOKEN}")
  CIPX_VERSION="$(curl -fsSL "${hdrs[@]}" "$api" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  if [ -z "$CIPX_VERSION" ]; then
    echo "opik-cipx: could not resolve latest release tag" >&2
    exit 1
  fi
fi

url="https://github.com/${CIPX_REPO}/releases/download/${CIPX_VERSION}/${archive}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "opik-cipx: downloading $url"
curl_args=(-fsSL)
[ -n "${GH_TOKEN:-}" ] && curl_args+=(-H "Authorization: Bearer ${GH_TOKEN}")
curl "${curl_args[@]}" -o "$tmp/$archive" "$url"

mkdir -p "$CIPX_INSTALL_DIR"
tar -xzf "$tmp/$archive" -C "$CIPX_INSTALL_DIR"
chmod +x "$CIPX_INSTALL_DIR"/opik-cipx

echo "opik-cipx: installed $CIPX_VERSION to $CIPX_INSTALL_DIR"

# Finish the install, rather than telling the reader to.
#
# WHY THIS IS NOT OPTIONAL. Downloading the binary configures nothing. `sync` is
# the install: it points Claude Code at the proxy (env.ANTHROPIC_BASE_URL),
# writes the session hook, the status line and the Cost Intelligence skill and
# slash commands into ~/.claude, and brings the daemon up.
#
# Until now something else always ran it — the plugin's SessionStart hook, which
# Claude Code registered the moment the plugin was installed. The binary now
# carries its own hook instead of borrowing the plugin's, and that hook has to be
# PLANTED by someone before it can fire. The installer is the only thing present
# at that moment, so if it does not run `sync` the download sits inert: no hook,
# so no future session runs `sync` either, so nothing ever installs. A curl
# install would appear to succeed and do nothing at all.
#
# STDIN MUST BE CLOSED, and not for the obvious reason. `sync` reads a Claude
# Code hook envelope from stdin. The documented way to run this script is
# `curl … | bash`, where stdin is the pipe carrying the SCRIPT'S OWN remaining
# bytes — so `sync` swallows them. Measured, without the redirect:
#
#   opik-cipx sync: session context publish: hook: decode envelope: invalid
#   character '#' looking for beginning of value
#
# and then bash reaches EOF and silently stops. Every line below this block —
# the PATH warning and the licence notice — never ran. That is the real hazard:
# not a crash, but an installer that quietly ends early and reports success.
#
# The blocking case is real too, just rarer: where stdin is a pipe that stays
# OPEN (a CI runner or a supervisor holding the fd), `sync` waits for an EOF
# that never comes and the install hangs on this line.
#
# NON-FATAL. A machine with no network, no credentials or no ~/.claude yet still
# has the binary installed correctly, and the next `sync` picks up from there. A
# first sync that could not finish must not make a good install report failure,
# so this neither `exit`s nor trips `set -e`.
if [ -z "${CIPX_NO_SYNC:-}" ]; then
  echo "opik-cipx: running \`opik-cipx sync\` to finish the install"
  if "$CIPX_INSTALL_DIR/opik-cipx" sync < /dev/null; then
    echo "opik-cipx: sync complete — start (or restart) Claude Code to pick it up"
  else
    echo "opik-cipx: sync did not finish; the binary is installed, so run \`$CIPX_INSTALL_DIR/opik-cipx sync\` once that is sorted" >&2
  fi
fi

# Make the program reachable by NAME, not only by address.
#
# WHY. Two of the three things `sync` just installed name the program by its
# bare name, and only one of them names a path:
#
#   - the session hook carries an ABSOLUTE path, so capture, the org policy loop
#     and the base-URL management work whether or not PATH is set up
#   - the status line key is the bare `opik-cipx statusline`, so off PATH the
#     cipx row silently disappears. The developer's own line survives, because
#     the key is written as `opik-cipx statusline || sh -c '<theirs>'` and Claude
#     Code reads a status line's stdout only on exit 0
#   - the skill and the slash commands tell Claude to run `opik-cipx mcp …`,
#     which off PATH is exit 127 -- not one of the exit codes that command
#     documents, so neither the developer nor the model can tell it apart from
#     a real refusal
#
# So capture keeps working without this and everything a person looks at does
# not.
#
# ~/.local/bin rather than /usr/local/bin: no sudo, per-user, and the
# conventional home for exactly this. Created when absent, because many default
# shell profiles put it on PATH unconditionally — a missing directory there is
# usually one nobody has needed yet, not one nobody will look in.
#
# A symlink rather than moving the binary, so ~/.opik-cipx/bin stays the one
# place cipx owns: an upgrade rewrites the binary and the link needs no second
# step, and `opik-cipx uninstall` removes the link by recognising where it
# points.
link_dir="$HOME/.local/bin"
link="$link_dir/opik-cipx"
case ":$PATH:" in
  *":$CIPX_INSTALL_DIR:"*)
    # Already reachable by name; a link would be a second answer to a solved
    # question, and a second thing to keep in step.
    ;;
  *)
    if [ -e "$link" ] && [ ! -L "$link" ]; then
      # A real file somebody else put there — a wrapper script, a hand-built
      # binary, a package manager's copy. Never overwritten: it is not ours, and
      # replacing it would silently change what `opik-cipx` means on this
      # machine. Whoever put it there gets to keep it.
      echo "opik-cipx: $link exists and is not a link cipx made — leaving it alone. It decides what \`opik-cipx\` means here." >&2
    elif mkdir -p "$link_dir" 2>/dev/null && ln -sfn "$CIPX_INSTALL_DIR/opik-cipx" "$link" 2>/dev/null; then
      echo "opik-cipx: linked $link -> $CIPX_INSTALL_DIR/opik-cipx"
      case ":$PATH:" in
        *":$link_dir:"*) ;;
        *) echo "opik-cipx: add $link_dir to your PATH — without it the status line stays blank and the Cost Intelligence commands (\`opik-cipx mcp list\`, and the /cost-intelligence commands that call them) do not resolve. Capture is unaffected." ;;
      esac
    else
      echo "opik-cipx: could not link into $link_dir — add $CIPX_INSTALL_DIR to your PATH so the Cost Intelligence commands resolve" >&2
    fi
    ;;
esac

echo "© 2026 Comet ML, Inc. All rights reserved. This software is proprietary and confidential."
