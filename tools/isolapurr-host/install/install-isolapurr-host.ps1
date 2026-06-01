param(
    [string]$Version = "latest",
    [string]$InstallDir = "",
    [switch]$Force,
    [switch]$DryRun,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/IvanLi-CN/isolappurr-usb-hub"

function Show-Usage {
    @"
Install IsolaPurr host tools for the current user.

Usage:
  powershell -ExecutionPolicy Bypass -File install-isolapurr-host.ps1 [-Version <tag>] [-InstallDir <dir>] [-Force] [-DryRun]

Defaults:
  -Version latest
  -InstallDir %LOCALAPPDATA%\Programs\IsolaPurr\bin
"@
}

function Fail($Message) {
    Write-Error $Message
    exit 1
}

function Normalize-Version([string]$Value) {
    $normalized = $Value -replace '^[^0-9]*', ''
    $normalized = $normalized -replace '[-+].*$', ''
    return $normalized
}

function Compare-Semver([string]$Left, [string]$Right) {
    $leftParts = (Normalize-Version $Left).Split(".")
    $rightParts = (Normalize-Version $Right).Split(".")
    for ($i = 0; $i -lt 3; $i++) {
        $leftValue = 0
        $rightValue = 0
        if ($i -lt $leftParts.Length -and $leftParts[$i] -match '^\d+$') {
            $leftValue = [int]$leftParts[$i]
        }
        if ($i -lt $rightParts.Length -and $rightParts[$i] -match '^\d+$') {
            $rightValue = [int]$rightParts[$i]
        }
        if ($leftValue -lt $rightValue) { return -1 }
        if ($leftValue -gt $rightValue) { return 1 }
    }
    return 0
}

if ($Help) {
    Show-Usage
    exit 0
}

if (-not [Environment]::Is64BitOperatingSystem) {
    Fail "unsupported Windows architecture; expected x86_64"
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\IsolaPurr\bin"
}

$Archive = "isolapurr-host-tools-windows-x86_64.tar.gz"
if ($Version -eq "latest") {
    $BaseUrl = "$RepoUrl/releases/latest/download"
} else {
    $BaseUrl = "$RepoUrl/releases/download/$Version"
}
$ArchiveUrl = "$BaseUrl/$Archive"
$ChecksumUrl = "$BaseUrl/SHA256SUMS"

Write-Host "IsolaPurr host tools install plan"
Write-Host "  source: $BaseUrl"
Write-Host "  archive: $Archive"
Write-Host "  install_dir: $InstallDir"
Write-Host "  force: $($Force.IsPresent)"

if ($DryRun) {
    Write-Host "dry-run: no files downloaded or installed"
    exit 0
}

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    Fail "missing required command: tar"
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("isolapurr-install-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
    $ArchivePath = Join-Path $TempDir $Archive
    $ChecksumsPath = Join-Path $TempDir "SHA256SUMS"

    $ArchiveResponse = Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath -MaximumRedirection 5 -PassThru
    Invoke-WebRequest -Uri $ChecksumUrl -OutFile $ChecksumsPath -MaximumRedirection 5 | Out-Null

    $TargetTag = $Version
    if ($Version -eq "latest") {
        $EffectiveUrl = $ArchiveResponse.BaseResponse.ResponseUri.AbsoluteUri
        if ($EffectiveUrl -match '/releases/download/([^/]+)/') {
            $TargetTag = $Matches[1]
        }
    }

    $InstalledVersion = ""
    $InstalledPath = Join-Path $InstallDir "isolapurr.exe"
    if (Test-Path $InstalledPath) {
        try {
            $InstalledVersion = (& $InstalledPath --version 2>$null | Select-Object -First 1).Split(" ")[-1]
        } catch {
            $InstalledVersion = ""
        }
    } else {
        $Installed = Get-Command isolapurr -ErrorAction SilentlyContinue
        if ($Installed) {
            try {
                $InstalledVersion = (& $Installed.Source --version 2>$null | Select-Object -First 1).Split(" ")[-1]
            } catch {
                $InstalledVersion = ""
            }
        }
    }
    $DevdAvailable = $false
    $DevdPath = Join-Path $InstallDir "isolapurr-devd.exe"
    if (Test-Path $DevdPath) {
        try {
            & $DevdPath --help | Out-Null
            $DevdAvailable = $true
        } catch {
            $DevdAvailable = $false
        }
    } else {
        $DevdCommand = Get-Command isolapurr-devd -ErrorAction SilentlyContinue
        if ($DevdCommand) {
            try {
                & $DevdCommand.Source --help | Out-Null
                $DevdAvailable = $true
            } catch {
                $DevdAvailable = $false
            }
        }
    }

    $TargetVersion = Normalize-Version $TargetTag
    if ($InstalledVersion -and $TargetVersion) {
        $Compare = Compare-Semver $TargetVersion $InstalledVersion
        if ($Compare -eq 0 -and -not $Force -and $DevdAvailable) {
            Write-Host "isolapurr $InstalledVersion is already installed; use -Force to reinstall"
            exit 0
        }
        if ($Compare -lt 0 -and -not $Force) {
            Fail "refusing to downgrade isolapurr $InstalledVersion to $TargetTag; use -Force to override"
        }
    }

    $Expected = ""
    foreach ($Line in Get-Content $ChecksumsPath) {
        $Parts = $Line.Trim() -split '\s+'
        if ($Parts.Length -ge 2 -and $Parts[1] -eq $Archive) {
            $Expected = $Parts[0].ToLowerInvariant()
            break
        }
    }
    if (-not $Expected) {
        Fail "SHA256SUMS does not contain $Archive"
    }

    $Actual = (Get-FileHash -Algorithm SHA256 $ArchivePath).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) {
        Fail "checksum mismatch for $Archive"
    }

    $ExtractDir = Join-Path $TempDir "extract"
    New-Item -ItemType Directory -Path $ExtractDir | Out-Null
    tar -xzf $ArchivePath -C $ExtractDir

    $Isolapurr = Join-Path $ExtractDir "isolapurr.exe"
    $Devd = Join-Path $ExtractDir "isolapurr-devd.exe"
    if (-not (Test-Path $Isolapurr)) { Fail "archive missing isolapurr.exe" }
    if (-not (Test-Path $Devd)) { Fail "archive missing isolapurr-devd.exe" }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Force $Isolapurr (Join-Path $InstallDir "isolapurr.exe")
    Copy-Item -Force $Devd (Join-Path $InstallDir "isolapurr-devd.exe")

    & (Join-Path $InstallDir "isolapurr.exe") --help | Out-Null
    & (Join-Path $InstallDir "isolapurr-devd.exe") --help | Out-Null

    Write-Host "installed IsolaPurr host tools to $InstallDir"
    $PathEntries = @($env:PATH -split ';') | Where-Object { $_ }
    if ($PathEntries -notcontains $InstallDir) {
        Write-Host "PATH note: add this directory before using isolapurr from a new shell:"
        Write-Host "  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$InstallDir', 'User')"
    }
} finally {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
