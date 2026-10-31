# Gives one exact runner the machine's current PATH, after checking the
# directory is that runner. The runner reads its .env when it starts, whatever
# environment Windows gives its service, so PATH goes there and the service
# restarts. Nothing restarts when it already matches.
$ErrorActionPreference = "Stop"
foreach ($required in @("RF_ROOT", "RF_NAME")) {
    if (-not [Environment]::GetEnvironmentVariable($required)) { throw "Missing $required" }
}
$allowedRoot = [IO.Path]::GetFullPath("C:\ProgramData\Runyard\runners")
$root = [IO.Path]::GetFullPath($env:RF_ROOT)
if (-not $root.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing root outside C:\ProgramData\Runyard\runners: $root"
}
$configured = Get-Content -LiteralPath (Join-Path $root ".runner") -Raw | ConvertFrom-Json
if ($configured.agentName -ne $env:RF_NAME) { throw "Runner name at exact path is '$($configured.agentName)', expected '$env:RF_NAME'" }
$needle = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$service = Get-CimInstance Win32_Service | Where-Object {
    $_.PathName.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -like "actions.runner.*"
} | Select-Object -First 1
if (-not $service) { throw "No exact-path Windows service exists for $env:RF_NAME" }

$path = (([Environment]::GetEnvironmentVariable("Path", "Machine") -split ";") | ForEach-Object { $_.Trim().TrimEnd("\") } | Where-Object { $_ }) -join ";"
$envFile = Join-Path $root ".env"
$lines = @()
if (Test-Path -LiteralPath $envFile) { $lines = @(Get-Content -LiteralPath $envFile) }
if (($lines | Where-Object { $_ -like "PATH=*" } | Select-Object -Last 1) -eq "PATH=$path") {
    Write-Output "$env:RF_NAME already has the machine's PATH"
    exit 0
}
$lines = @($lines | Where-Object { $_ -notlike "PATH=*" }) + "PATH=$path"
[IO.File]::WriteAllLines($envFile, [string[]]$lines)
Restart-Service -Name $service.Name
Write-Output "Gave $env:RF_NAME the machine's PATH and restarted it"
