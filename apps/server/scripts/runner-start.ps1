# Starts one exact runner's Windows service, after checking the directory is that runner.
$ErrorActionPreference = "Stop"
foreach ($required in @("RF_ROOT", "RF_NAME")) {
    if (-not [Environment]::GetEnvironmentVariable($required)) { throw "Missing $required" }
}
$allowedRoot = [IO.Path]::GetFullPath("C:\runyard-runners")
$root = [IO.Path]::GetFullPath($env:RF_ROOT)
if (-not $root.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing root outside C:\runyard-runners: $root"
}
$configured = Get-Content -LiteralPath (Join-Path $root ".runner") -Raw | ConvertFrom-Json
if ($configured.agentName -ne $env:RF_NAME) { throw "Runner name at exact path is '$($configured.agentName)', expected '$env:RF_NAME'" }
$needle = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$service = Get-CimInstance Win32_Service | Where-Object {
    $_.PathName.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -like "actions.runner.*"
} | Select-Object -First 1
if (-not $service) { throw "No exact-path Windows service exists for $env:RF_NAME" }
Start-Service -Name $service.Name
Write-Output "Started $env:RF_NAME"
