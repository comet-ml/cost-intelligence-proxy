#!/usr/bin/env bash
# opik-cipx installer — downloads the latest release for your OS/arch into
# ~/.opik-cipx/bin/.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.sh | bash -s -- v0.1.0
#
# Note: while the repo is private, GH_TOKEN must be set with read access:
#   GH_TOKEN=ghp_... curl ... | bash
#
# Override env vars:
#   CIPX_VERSION      Tag to install (default: latest release)
#   CIPX_INSTALL_DIR  Install dir (default: ~/.opik-cipx/bin)
#   CIPX_REPO         Override repo (default: comet-ml/cost-intelligence-proxy)

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
  *) echo "opik-cipx: unsupported os $os (use the Windows installer instead)" >&2; exit 1 ;;
esac

archive="opik-cipx-${os}-${arch}.tar.gz"

# Resolve "latest" via the GitHub API (works for private repos with GH_TOKEN).
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
echo "opik-cipx: add $CIPX_INSTALL_DIR to your PATH, then run \`opik-cipx setup\`."
