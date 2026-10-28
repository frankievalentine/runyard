# Installs runyard.exe from a release directory (the files `vp run release` writes),
# checking it against that directory's SHA256SUMS. The checksum catches a corrupt or
# swapped download only when SHA256SUMS comes from a source you trust.
#
#   $env:RUNYARD_BASE_URL = 'https://example.com/runyard/0.1.0'; .\install.ps1
#
# RUNYARD_INSTALL_DIR overrides where it goes (default %LOCALAPPDATA%\Programs\Runyard).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$base = if ($env:RUNYARD_BASE_URL) { $env:RUNYARD_BASE_URL } elseif ($args.Count -gt 0) { $args[0] } else { $null }
if (-not $base) { throw "Set RUNYARD_BASE_URL to the release directory's address." }
if ($base -notmatch '^(https|file)://') { throw 'RUNYARD_BASE_URL must start with https:// or file://' }
$base = $base.TrimEnd('/')
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Runyard needs 64-bit Windows.' }
$dir = if ($env:RUNYARD_INSTALL_DIR) { $env:RUNYARD_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\Runyard' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('runyard-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
function Get-ReleaseFile([string]$name) {
  $out = Join-Path $tmp $name
  if ($base -like 'file://*') {
    Copy-Item -LiteralPath ([Uri]"$base/$name").LocalPath -Destination $out
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $out
  }
  return $out
}

try {
  $version = (Get-Content -Raw (Get-ReleaseFile 'VERSION')).Trim()
  $file = "runyard-$version-windows-x64.exe"
  $expected = Get-Content (Get-ReleaseFile 'SHA256SUMS') |
    ForEach-Object { $parts = $_ -split '\s+'; if ($parts[1] -eq $file) { $parts[0] } } |
    Select-Object -First 1
  if (-not $expected) { throw "SHA256SUMS lists no $file." }
  Write-Output "Downloading $file"
  $exe = Get-ReleaseFile $file
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA-256 mismatch for $file; nothing was installed." }

  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $target = Join-Path $dir 'runyard.exe'
  try {
    Move-Item -Force -LiteralPath $exe -Destination $target
  } catch {
    throw "Couldn't replace $target. If Runyard is running, stop it first (Stop-ScheduledTask -TaskName Runyard)."
  }
  Write-Output "Installed runyard $version at $target"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $dir)) {
    [Environment]::SetEnvironmentVariable('Path', (@($userPath.TrimEnd(';'), $dir) -ne '' -join ';'), 'User')
    Write-Output "Added $dir to your PATH; open a new terminal to use it."
  }
  Write-Output ''
  Write-Output 'Next:'
  Write-Output '  runyard                    start it in this terminal'
  Write-Output '  runyard service install    keep it running in the background'
} finally {
  Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
}
