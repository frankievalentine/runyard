# Adapted from aarondfrancis/fleet (worker-retire.ps1), service mode only: deregisters
# one exact runner (config.cmd remove also removes its service). The directory is kept.
$ErrorActionPreference = "Stop"
foreach ($required in @("RF_ROOT", "RF_NAME", "RF_TOKEN")) {
    if (-not [Environment]::GetEnvironmentVariable($required)) { throw "Missing $required" }
}
$allowedRoot = [IO.Path]::GetFullPath("C:\ProgramData\Runyard\runners")
$root = [IO.Path]::GetFullPath($env:RF_ROOT)
if (-not $root.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing root outside C:\ProgramData\Runyard\runners: $root"
}
$runnerFile = Join-Path $root ".runner"
if (-not (Test-Path -LiteralPath $runnerFile)) { throw "No configured runner at exact path $root" }
$configured = Get-Content -LiteralPath $runnerFile -Raw | ConvertFrom-Json
if ($configured.agentName -ne $env:RF_NAME) {
    throw "Runner name at exact path is '$($configured.agentName)', expected '$env:RF_NAME'"
}
Set-Location -LiteralPath $root
& .\config.cmd remove --token $env:RF_TOKEN
if ($LASTEXITCODE -ne 0) { throw "config.cmd remove failed with exit code $LASTEXITCODE" }
$env:RF_TOKEN = $null
Write-Output "Removed $env:RF_NAME; kept its directory $root"
