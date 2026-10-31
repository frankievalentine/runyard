# Runyard machine teardown, for Windows: removes what Runyard's setup left,
# once Runyard has removed its runners (decommission the machine and run its
# review first). Run as the account Runyard used (an administrator account
# needs an administrator PowerShell):
#   irm <runyard>/api/machine-setup/teardown.ps1 | iex
# It deletes C:\ProgramData\Runyard\runners (and Runyard's folder there, once empty) and Runyard's key from the file Windows OpenSSH
# reads for this account, and refuses while any runner is still configured.
$ErrorActionPreference = 'Stop'
$key = '__RUNYARD_KEY__'
$body = ($key -split ' ')[1]

$root = Join-Path $env:ProgramData 'Runyard\runners'
if (Test-Path $root) {
  $configured = Get-ChildItem -Path $root -Recurse -Force -Filter '.runner' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($configured) {
    Write-Error "A runner is still configured at $($configured.DirectoryName). Decommission the machine in Runyard and run its review first."
    exit 1
  }
  Remove-Item -Recurse -Force $root
  Write-Host "Removed $root."
}
$parent = Join-Path $env:ProgramData 'Runyard'
if ((Test-Path $parent) -and -not (Get-ChildItem -Force $parent | Select-Object -First 1)) { Remove-Item -Force $parent }

$isAdminMember = (& whoami /groups) -match 'S-1-5-32-544'
$files = @(Join-Path $HOME '.ssh\authorized_keys')
if ($isAdminMember) { $files += Join-Path $env:ProgramData 'ssh\administrators_authorized_keys' }
foreach ($file in $files) {
  if ((Test-Path $file) -and (Select-String -Path $file -SimpleMatch -Pattern $body -Quiet)) {
    $kept = Get-Content -Path $file | Where-Object { -not $_.Contains($body) }
    Set-Content -Path $file -Value $kept -Encoding ascii
    Write-Host "Removed Runyard's key from $file."
  }
}
Write-Host "Done. Runyard no longer has access here."
