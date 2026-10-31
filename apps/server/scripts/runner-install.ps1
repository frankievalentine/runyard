# Adapted from aarondfrancis/fleet (worker-install.ps1), service mode only.
# Runs on a Windows machine over PowerShell stdin. RF_* values are process-only.
$ErrorActionPreference = "Stop"

foreach ($required in @("RF_ROOT", "RF_NAME", "RF_URL", "RF_LABELS", "RF_TOKEN", "RF_ASSET_URL", "RF_ASSET_NAME")) {
    if (-not [Environment]::GetEnvironmentVariable($required)) { throw "Missing $required" }
}
if ($env:RF_SERVICE_MODE -ne "windows-service") { throw "Unsupported service mode: $env:RF_SERVICE_MODE" }

function Find-RunnerService([string]$RunnerRoot) {
    $needle = $RunnerRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    Get-CimInstance Win32_Service | Where-Object {
        $_.PathName.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -like "actions.runner.*"
    } | Select-Object -First 1
}
$assetUri = [Uri]$env:RF_ASSET_URL
if ($assetUri.Scheme -ne "https" -or $assetUri.Host -ne "github.com" -or -not $assetUri.AbsolutePath.StartsWith("/actions/runner/releases/download/")) {
    throw "Refusing unexpected runner asset URL: $env:RF_ASSET_URL"
}

$allowedRoot = [IO.Path]::GetFullPath("C:\runyard-runners")
$root = [IO.Path]::GetFullPath($env:RF_ROOT)
if (-not $root.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing root outside C:\runyard-runners: $root"
}

$runnerFile = Join-Path $root ".runner"
if (Test-Path -LiteralPath $runnerFile) {
    $configured = Get-Content -LiteralPath $runnerFile -Raw | ConvertFrom-Json
    if ($configured.agentName -ne $env:RF_NAME) {
        throw "Configured runner at exact path is '$($configured.agentName)', expected '$env:RF_NAME'"
    }
    $service = Find-RunnerService $root
    if (-not $service) { throw "Runner is configured but no exact-path Windows service exists" }
    Start-Service -Name $service.Name
    Write-Output "Runner $env:RF_NAME already configured; ensured its service is started"
    exit 0
}

if ((Test-Path -LiteralPath $root) -and (Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1)) {
    throw "Refusing non-empty unconfigured directory: $root"
}

New-Item -ItemType Directory -Force -Path $root | Out-Null
$archive = Join-Path ([IO.Path]::GetTempPath()) ("runyard-" + [guid]::NewGuid() + ".zip")
try {
    Write-Output "Downloading $env:RF_ASSET_NAME"
    Invoke-WebRequest -Uri $env:RF_ASSET_URL -OutFile $archive
    if ($env:RF_CHECKSUM) {
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $env:RF_CHECKSUM.ToLowerInvariant()) { throw "SHA-256 mismatch for $env:RF_ASSET_NAME" }
        Write-Output "Verified GitHub SHA-256 digest"
    } else {
        Write-Warning "GitHub release metadata did not publish an asset digest"
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $root
} finally {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}

# The runner reads .env when it starts: give it the machine's PATH, as runner-path.ps1 does.
$machinePath = (([Environment]::GetEnvironmentVariable("Path", "Machine") -split ";") | ForEach-Object { $_.Trim().TrimEnd("\") } | Where-Object { $_ }) -join ";"
[IO.File]::WriteAllLines((Join-Path $root ".env"), [string[]]@("PATH=$machinePath"))

Set-Location -LiteralPath $root
$arguments = @("--unattended", "--url", $env:RF_URL, "--token", $env:RF_TOKEN, "--name", $env:RF_NAME, "--labels", $env:RF_LABELS, "--runasservice")
if ($env:RF_RUNNER_GROUP) { $arguments += @("--runnergroup", $env:RF_RUNNER_GROUP) }
& .\config.cmd @arguments
if ($LASTEXITCODE -ne 0) { throw "config.cmd failed with exit code $LASTEXITCODE" }
$env:RF_TOKEN = $null
$service = Find-RunnerService $root
if (-not $service) { throw "Runner configured but its exact-path Windows service was not found" }
Start-Service -Name $service.Name
Write-Output "Installed and started $env:RF_NAME at $root"
