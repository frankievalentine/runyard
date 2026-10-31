# Read-only: whether this machine has what CI jobs commonly need. Runs after
# the diagnostics with $RunyardForgeHosts set to the forges' hosts. Reports
# presence (and a few versions) only; changes nothing.

# Tools by the names Runyard gives them, found by the command Windows has for
# each (WINDOWS_TOOLS in packages/core). Found on the machine PATH, which is all
# the runner's service sees; one only this account has is reported apart. The
# WindowsApps stubs (python.exe opening the Store) don't count.
$machineDirs = [Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';' | Where-Object { $_ }
$commands = [ordered]@{
  git = 'git'; curl = 'curl'; tar = 'tar'; unzip = '7z'; zip = '7z'; xz = 'xz'; zstd = 'zstd'
  jq = 'jq'; gpg = 'gpg'; cc = 'gcc'; make = 'make'; python3 = 'python'; node = 'node'
}
$paths = @{}
foreach ($tool in $commands.Keys) {
  $exe = "$($commands[$tool]).exe"
  $found = ''
  foreach ($dir in $machineDirs) {
    try { $candidate = Join-Path $dir $exe } catch { continue }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $found = $candidate; break }
  }
  $paths[$tool] = $found
  Fact "tool_$tool" $found
  if (-not $found) {
    $own = Get-Command $exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\WindowsApps\*' } | Select-Object -First 1
    if ($own) { Fact "tool_$($tool)_account" $own.Source }
  }
}
if ($paths.git) { try { Fact tool_git_version ((& $paths.git --version 2>$null) | Select-Object -First 1) } catch {} }
if ($paths.node) { try { Fact tool_node_version ((& $paths.node --version 2>$null) | Select-Object -First 1) } catch {} }
# The runner runs each PowerShell step and hook as a script file, so the policy
# it gets must allow local scripts: Group Policy first, then the machine's own,
# else Windows' default (Restricted on Windows 10 and 11, RemoteSigned on Server).
$groupPolicy = Get-ExecutionPolicy -Scope MachinePolicy
$machinePolicy = Get-ExecutionPolicy -Scope LocalMachine
if ("$groupPolicy" -ne 'Undefined') { Fact ps_policy "$groupPolicy"; Fact ps_policy_source 'group' }
elseif ("$machinePolicy" -ne 'Undefined') { Fact ps_policy "$machinePolicy"; Fact ps_policy_source 'machine' }
else {
  $workstation = (Get-CimInstance Win32_OperatingSystem).ProductType -eq 1
  Fact ps_policy $(if ($workstation) { 'Restricted' } else { 'RemoteSigned' })
  Fact ps_policy_source 'default'
}
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
