# Read-only: whether this machine has what CI jobs commonly need. Runs after
# the diagnostics with $RunyardForgeHosts set to the forges' hosts. Reports
# presence (and a few versions) only; changes nothing.
foreach ($tool in @('git', 'curl', 'tar', 'node', 'python')) {
  $found = Get-Command "$tool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { Fact "tool_$tool" $found.Source } else { Fact "tool_$tool" '' }
}
try { Fact tool_git_version ((& git --version 2>$null) | Select-Object -First 1) } catch {}
if (Get-Command docker.exe -ErrorAction SilentlyContinue) {
  Fact docker_cli 'present'
  try { Fact docker_server ((& docker version --format '{{.Server.Version}}' 2>$null) | Select-Object -First 1) } catch {}
}
if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
  try { Fact nvidia_gpu ((& nvidia-smi --query-gpu=name --format=csv,noheader 2>$null) | Select-Object -First 1) } catch {}
}
Fact epoch ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
$i = 0
foreach ($forgeHost in $RunyardForgeHosts) {
  try {
    $response = Invoke-WebRequest -Uri "https://$forgeHost/" -Method Head -TimeoutSec 5 -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop
    Fact "reach_$i" "$forgeHost $($response.StatusCode)"
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status) { Fact "reach_$i" "$forgeHost $status" } else { Fact "reach_$i" "$forgeHost 000" }
  }
  $i++
}
Fact readiness_complete 1
