# Sets a GitHub runner's job hooks on Windows, as cleanup-configure.sh does
# elsewhere: both record each job for run history, and the job-completed one
# also clears the job's workspace when RF_CLEANUP is workspace. Writes
# runyard-job-started.ps1 and runyard-job-completed.ps1 into its directory,
# points .env at them (keeping its PATH), records the mode in .runyard-cleanup
# and the hooks in .runyard-history, and restarts the service so the runner
# reads .env again. Runyard only sends this for an idle runner.
$ErrorActionPreference = "Stop"
foreach ($required in @("RF_ROOT", "RF_CLEANUP")) {
    if (-not [Environment]::GetEnvironmentVariable($required)) { throw "Missing $required" }
}
$runnersRoot = [IO.Path]::GetFullPath("C:\ProgramData\Runyard\runners")
$root = [IO.Path]::GetFullPath($env:RF_ROOT)
if (-not $root.StartsWith($runnersRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing root outside C:\ProgramData\Runyard\runners: $root"
}
if ($env:RF_CLEANUP -notin @("off", "workspace")) { throw "Cleanup on Windows is off or workspace, not $env:RF_CLEANUP" }
$runnerFile = Join-Path $root ".runner"
if (-not (Test-Path -LiteralPath $runnerFile)) { throw "No configured runner at $root" }
$agent = (Get-Content -LiteralPath $runnerFile -Raw | ConvertFrom-Json).agentName
$needle = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$service = Get-CimInstance Win32_Service | Where-Object {
    $_.PathName.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -like "actions.runner.*"
} | Select-Object -First 1
if (-not $service) { throw "No exact-path Windows service exists for $agent" }

# One job log for every runner on the machine, which their service accounts append to.
$log = Join-Path $runnersRoot ".runyard-jobs.log"
if (-not (Test-Path -LiteralPath $log)) { [IO.File]::WriteAllText($log, "") }
$account = if ($service.StartName) { $service.StartName } else { "NT AUTHORITY\NETWORK SERVICE" }
$sid = ([Security.Principal.NTAccount]$account).Translate([Security.Principal.SecurityIdentifier]).Value
& icacls.exe $log /grant "*${sid}:(M)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Couldn't let $account write the job log $log" }

function Quote([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }
foreach ($hook in "started", "completed") {
    $lines = @(
        "# Written by Runyard. Records this job for run history and never fails it."
        "`$log = $(Quote $log)"
        "`$runner = $(Quote $agent)"
        "`$kind = '$hook'"
        @'
try {
    $name = if ($env:RUNNER_NAME) { $env:RUNNER_NAME } else { $runner }
    $attempt = if ($env:GITHUB_RUN_ATTEMPT) { $env:GITHUB_RUN_ATTEMPT } else { '1' }
    $workflow = "$env:GITHUB_WORKFLOW" -replace "[`t`r`n]", ' '
    $fields = @([DateTimeOffset]::UtcNow.ToUnixTimeSeconds(), $kind, $name, $env:GITHUB_REPOSITORY, $env:GITHUB_RUN_ID, $attempt, $workflow)
    [IO.File]::AppendAllText($log, ($fields -join "`t") + "`n")
    # Past 1 MB, only the newest 5000 lines are kept.
    if ((Get-Item -LiteralPath $log).Length -gt 1000000) {
        $keep = Get-Content -LiteralPath $log -Tail 5000
        [IO.File]::WriteAllText($log, ($keep -join "`n") + "`n")
    }
} catch {}
'@
    )
    if ($hook -eq "completed" -and $env:RF_CLEANUP -eq "workspace") {
        $lines += @(
            "# Clears the job's workspace, only inside this runner's _work directory."
            "`$work = $(Quote (Join-Path $root '_work'))"
            @'
try {
    $ws = if ($env:GITHUB_WORKSPACE) { [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE) } else { '' }
    if ($ws.StartsWith($work + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $ws) {
            Get-ChildItem -LiteralPath $ws -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output "Runyard: cleared $ws"
        }
    } else {
        Write-Output "Runyard: left the workspace alone; it isn't under $work"
    }
} catch {}
'@
        )
    }
    $lines += "exit 0"
    [IO.File]::WriteAllLines((Join-Path $root "runyard-job-$hook.ps1"), [string[]]$lines)
}

# The hooks go in .env beside its PATH; the runner reads it when it starts.
$envFile = Join-Path $root ".env"
$kept = @()
if (Test-Path -LiteralPath $envFile) {
    $kept = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -notlike "ACTIONS_RUNNER_HOOK_JOB_STARTED=*" -and $_ -notlike "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=*" })
}
$kept += "ACTIONS_RUNNER_HOOK_JOB_STARTED=$(Join-Path $root 'runyard-job-started.ps1')"
$kept += "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$(Join-Path $root 'runyard-job-completed.ps1')"
[IO.File]::WriteAllLines($envFile, [string[]]$kept)
[IO.File]::WriteAllText((Join-Path $root ".runyard-history"), "1`n")
if ($env:RF_CLEANUP -eq "off") {
    Remove-Item -LiteralPath (Join-Path $root ".runyard-cleanup") -Force -ErrorAction SilentlyContinue
    Write-Output "Set the runner to record its jobs for run history; it clears nothing after them."
} else {
    [IO.File]::WriteAllText((Join-Path $root ".runyard-cleanup"), "workspace`n")
    Write-Output "Set the runner to record its jobs and clear its workspace after each one."
}
Restart-Service -Name $service.Name
Write-Output "Restarted the runner."
