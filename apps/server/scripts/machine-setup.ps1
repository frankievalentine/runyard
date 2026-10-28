# Runyard machine setup, for Windows. Run on the machine, as the account
# Runyard should sign in as (an administrator account needs an administrator
# PowerShell):
#   & ([scriptblock]::Create((irm <runyard>/api/machine-setup/script.ps1))) <code>
# It adds Runyard's public key to the file Windows OpenSSH reads for this
# account, then reports the account name and SSH host keys back to Runyard,
# which trusts exactly those keys. Nothing is installed.
param([string]$Code)
$ErrorActionPreference = 'Stop'

if (-not $Code -or $Code -notmatch '^[A-Za-z0-9]+$') {
  Write-Error 'Run it with the code Runyard showed.'
  exit 2
}
$reportUrl = '__RUNYARD_ORIGIN__/api/machine-setup/report'
$key = '__RUNYARD_KEY__'

$user = $env:USERNAME
if ($user -notmatch '^[A-Za-z0-9._-]+$') {
  Write-Error "Runyard can't sign in as '$user'; use an account with a plain name."
  exit 2
}

# The SSH server has to be on first: Runyard connects to it.
$sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
if (-not $sshd -or $sshd.Status -ne 'Running') {
  Write-Host 'OpenSSH Server is not running. Turn it on in an administrator PowerShell, then run this again:'
  Write-Host '  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Start-Service sshd; Set-Service -Name sshd -StartupType Automatic'
  exit 1
}

# Members of Administrators sign in with keys from ProgramData, not their profile.
$isAdminMember = (& whoami /groups) -match 'S-1-5-32-544'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$line = "no-agent-forwarding,no-port-forwarding,no-X11-forwarding $key"
$body = ($key -split ' ')[1]
if ($isAdminMember) {
  if (-not $elevated) {
    Write-Error "$user is an administrator, so its key goes in ProgramData: run this in an administrator PowerShell."
    exit 1
  }
  $authorized = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
} else {
  $dir = Join-Path $HOME '.ssh'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $authorized = Join-Path $dir 'authorized_keys'
}
if ((Test-Path $authorized) -and (Select-String -Path $authorized -SimpleMatch -Pattern $body -Quiet)) {
  Write-Host "Runyard's key is already authorized for $user."
} else {
  Add-Content -Path $authorized -Value $line -Encoding ascii
  Write-Host "Authorized Runyard's key for $user."
}
if ($isAdminMember) {
  & icacls.exe $authorized /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
}

$hostKeys = @()
foreach ($file in Get-ChildItem -Path (Join-Path $env:ProgramData 'ssh') -Filter 'ssh_host_*_key.pub' -ErrorAction SilentlyContinue) {
  $parts = (Get-Content -Path $file.FullName -TotalCount 1) -split '\s+'
  if ($parts.Count -ge 2) { $hostKeys += "$($parts[0]) $($parts[1])" }
}

$report = @{ code = $Code; user = $user; os = 'windows'; hostKeys = $hostKeys } | ConvertTo-Json -Compress
try {
  Invoke-RestMethod -Method Post -Uri $reportUrl -ContentType 'application/json' -Body $report | Out-Null
} catch {
  Write-Error "Runyard didn't take the report: $($_.Exception.Message). The code may have expired or been used; show a new one on the machine's page."
  exit 1
}
Write-Host "Done. Runyard is checking this machine now; its page in the dashboard shows the result."
