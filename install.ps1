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
#
# The whole body runs in its own scriptblock: `irm | iex` evaluates this text
# in the caller's session, and without the block $ErrorActionPreference and
# every variable below (including the one holding GH_TOKEN) would outlive the
# install.

& {
  [CmdletBinding()]
  param(
    [string]$Version = $(if ($env:CIPX_VERSION) { $env:CIPX_VERSION } else { 'latest' })
  )

  $ErrorActionPreference = 'Stop'
  # Add TLS 1.2 to whatever the process already allows; do not replace the list.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = if ($env:CIPX_REPO) { $env:CIPX_REPO } else { 'comet-ml/cost-intelligence-proxy' }
  $installDir = if ($env:CIPX_INSTALL_DIR) { $env:CIPX_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.opik-cipx\bin' }

  # A 32-bit PowerShell host (Intune platform scripts by default) reports x86 in
  # PROCESSOR_ARCHITECTURE and keeps the machine's real architecture in
  # PROCESSOR_ARCHITEW6432.
  $rawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $arch = switch ($rawArch) {
    'AMD64' { 'amd64' }
    'ARM64' { 'arm64' }
    default { throw "opik-cipx: unsupported arch $rawArch" }
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

    $stage = Join-Path $tmp 'stage'
    Expand-Archive -Path $zip -DestinationPath $stage -Force
    $staged = Join-Path $stage 'opik-cipx.exe'
    if (-not (Test-Path $staged)) { throw "opik-cipx: $archive does not contain opik-cipx.exe at its root" }

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    $exe = Join-Path $installDir 'opik-cipx.exe'
    $old = Join-Path $installDir 'opik-cipx.exe.old'

    # Swap by rename: a running daemon keeps its own (renamed) file, the way
    # install.sh relies on rename(2) on unix. If the final move fails (zip
    # layout, antivirus holding the new file), put the previous binary back so
    # the hook launcher never finds an empty directory.
    $movedAside = $false
    if (Test-Path $exe) {
      Remove-Item $old -ErrorAction SilentlyContinue
      Move-Item -Path $exe -Destination $old -Force
      $movedAside = $true
    }
    try {
      Move-Item -Path $staged -Destination $exe -Force
    }
    catch {
      if ($movedAside -and -not (Test-Path $exe)) { Move-Item -Path $old -Destination $exe -Force }
      throw
    }
    Remove-Item $old -ErrorAction SilentlyContinue   # fails while the old daemon runs; harmless

    Write-Host "opik-cipx: installed $Version to $installDir"
    Write-Host "opik-cipx: add $installDir to your PATH, then run `opik-cipx sync` from Git Bash or PowerShell."
    Write-Host '© 2026 Comet ML, Inc. All rights reserved. This software is proprietary and confidential.'
  }
  finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
} @args
