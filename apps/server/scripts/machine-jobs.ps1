# Read-only: run history's lines from this machine's job log, newer than
# $RunyardJobsSince (seconds; that second again, since re-reading only merges).
# Runyard's runner hooks append one line when a job starts and one when it
# ends: seconds, event, runner, repository, run, attempt, workflow,
# tab-separated. At most the newest 500 lines per read.
try {
  $jobsLog = Join-Path $env:ProgramData 'Runyard\runners\.runyard-jobs.log'
  if (Test-Path -LiteralPath $jobsLog) {
    Get-Content -LiteralPath $jobsLog -Tail 5000 |
      Where-Object { $_ -match '^(\d+)\t' -and [long]$Matches[1] -ge $RunyardJobsSince } |
      Select-Object -Last 500 |
      ForEach-Object { "RFJ`t$_" }
  }
} catch {}
