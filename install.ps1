# opik-cipx installer for Windows — downloads the latest release for this
# machine into %USERPROFILE%\.opik-cipx\bin.
#
# Usage (PowerShell 5.1 or 7):
#   irm https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/comet-ml/cost-intelligence-proxy/main/install.ps1))) v0.0.90
#
# The repo is public, so no auth is needed. GH_TOKEN is honored if set (e.g.
# to raise the GitHub API rate limit).
#
# Override env vars (same names as install.sh):
#   CIPX_VERSION      Tag to install (default: latest release)
#   CIPX_INSTALL_DIR  Install dir (default: %USERPROFILE%\.opik-cipx\bin)
#   CIPX_REPO         Override repo (default: comet-ml/cost-intelligence-proxy)
#
# Git for Windows is required by the Claude Code plugin itself (its hooks run
# through Git Bash); this script only places the binary.

[CmdletBinding()]
param(
  [string]$Version = $(if ($env:CIPX_VERSION) { $env:CIPX_VERSION } else { 'latest' })
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = if ($env:CIPX_REPO) { $env:CIPX_REPO } else { 'comet-ml/cost-intelligence-proxy' }
$installDir = if ($env:CIPX_INSTALL_DIR) { $env:CIPX_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.opik-cipx\bin' }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'amd64' }
  'ARM64' { 'arm64' }
  default { throw "opik-cipx: unsupported arch $($env:PROCESSOR_ARCHITECTURE)" }
}
$archive = "opik-cipx-windows-$arch.zip"

$headers = @{ 'Accept' = 'application/vnd.github+json' }
if ($env:GH_TOKEN) { $headers['Authorization'] = "Bearer $env:GH_TOKEN" }

if ($Version -eq 'latest') {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers
  $Version = $release.tag_name
  if (-not $Version) { throw 'opik-cipx: could not resolve latest release tag' }
}

$url = "https://github.com/$repo/releases/download/$Version/$archive"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("opik-cipx-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "opik-cipx: downloading $url"
  $zip = Join-Path $tmp $archive
  Invoke-WebRequest -Uri $url -Headers $headers -OutFile $zip -UseBasicParsing

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  # Expand next to the destination and move over it: a running daemon keeps
  # its own (renamed) file, the way install.sh relies on rename(2) on unix.
  $stage = Join-Path $tmp 'stage'
  Expand-Archive -Path $zip -DestinationPath $stage -Force
  $exe = Join-Path $installDir 'opik-cipx.exe'
  $old = Join-Path $installDir 'opik-cipx.exe.old'
  if (Test-Path $exe) {
    Remove-Item $old -ErrorAction SilentlyContinue
    Move-Item -Path $exe -Destination $old -Force
  }
  Move-Item -Path (Join-Path $stage 'opik-cipx.exe') -Destination $exe -Force
  Remove-Item $old -ErrorAction SilentlyContinue   # fails while the old daemon runs; harmless

  Write-Host "opik-cipx: installed $Version to $installDir"
  Write-Host "opik-cipx: add $installDir to your PATH, then run `opik-cipx sync` from Git Bash or PowerShell."
  Write-Host '© 2026 Comet ML, Inc. All rights reserved. This software is proprietary and confidential.'
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
