# Installs the tools a machine's pools call for and its last check found
# missing: RF_TOOLS, space-separated, from Runyard's fixed list. Uses winget
# with machine scope, so the runner's service account finds them on the
# machine PATH. The packages match WINDOWS_TOOLS in packages/core. Python comes
# from uv, into C:\ProgramData\Runyard\python beside any copy an account has.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$packages = @{
    git     = "Git.Git"
    unzip   = "7zip.7zip"
    zip     = "7zip.7zip"
    xz      = "TukaaniProject.XZUtils"
    zstd    = "Meta.Zstandard"
    jq      = "jqlang.jq"
    cc      = "BrechtSanders.WinLibs.POSIX.UCRT"
    make    = "ezwinports.make"
    python3 = "astral-sh.uv"
    node    = "OpenJS.NodeJS.LTS"
}
$commands = @{
    git = "git"; unzip = "7z"; zip = "7z"; xz = "xz"; zstd = "zstd"; jq = "jq"
    cc = "gcc"; make = "make"; python3 = "python"; node = "node"
}
# Installers that leave their directory off PATH; added to the machine PATH when present.
$directories = @{
    "7zip.7zip"   = @("$env:ProgramFiles\7-Zip")
}
# Exit codes that leave the package installed: already there, or needing a restart to finish.
$installed = @(0, -1978335135, -1978334963, -1978334967)
# A download that failed or timed out: winget's own codes, and Windows' internet errors (WinINet).
$downloadFailed = @(-1978335224, -1978335186, -1978335098, -1978334969)
function Test-NetworkFailure([int]$Code) {
    if ($downloadFailed -contains $Code) { return $true }
    $low = $Code -band 0xFFFF
    return ((($Code -shr 16) -band 0xFFFF) -eq 0x8007) -and $low -ge 12000 -and $low -le 12200
}

$tools = "$env:RF_TOOLS".Split(" ", [StringSplitOptions]::RemoveEmptyEntries)
foreach ($tool in $tools) {
    if (-not $packages.ContainsKey($tool)) { throw "Unknown tool: $tool" }
}
if (-not $tools) { Write-Output "Nothing to install."; exit 0 }
if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "winget isn't available. It comes with App Installer on Windows 10 and 11."
}

$key = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
function Add-MachinePath([string]$Directory) {
    # Read unexpanded, so entries like %SystemRoot% stay as they are.
    $current = (Get-Item -LiteralPath $key).GetValue("Path", "", "DoNotExpandEnvironmentNames")
    $entries = $current -split ";" | Where-Object { $_ }
    if ($entries | Where-Object { $_.TrimEnd("\") -eq $Directory.TrimEnd("\") }) { return }
    Set-ItemProperty -LiteralPath $key -Name Path -Value (($entries + $Directory) -join ";") -Type ExpandString
    Write-Output "Added $Directory to the machine PATH"
}

# Every package gets its turn: one that fails doesn't keep the others from installing.
$failed = @()
foreach ($id in ($tools | ForEach-Object { $packages[$_] } | Select-Object -Unique)) {
    foreach ($attempt in 1, 2) {
        Write-Output "Installing $id"
        & winget.exe install --exact --id $id --source winget --scope machine `
            --accept-package-agreements --accept-source-agreements --disable-interactivity
        $code = $LASTEXITCODE
        # One retry for a download that failed: enough for a blip, not an outage.
        if ($attempt -eq 1 -and (Test-NetworkFailure $code)) {
            Write-Output "The download failed; trying $id again in 15 seconds"
            Start-Sleep -Seconds 15
            continue
        }
        break
    }
    if ($installed -notcontains $code) {
        $why = if (Test-NetworkFailure $code) { "its download failed" } else { "exit code $code" }
        $failed += "$id ($why)"
        continue
    }
    # winget extracts portable packages under the installing account, then moves them in,
    # keeping that account's permissions: let them inherit, so the runner's account can run them.
    Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles "WinGet\Packages") -Directory -Filter "$($id)_*" -ErrorAction SilentlyContinue |
        ForEach-Object { & icacls.exe $_.FullName /reset /T /C /Q | Out-Null }
    foreach ($dir in $directories[$id]) {
        if ($dir -and (Test-Path -LiteralPath $dir)) { Add-MachinePath $dir; break }
    }
}

# Python 3.13 from uv, with python.exe and python3.exe in its bin folder on the machine PATH.
if (($tools -contains "python3") -and -not ($failed | Where-Object { $_.StartsWith("astral-sh.uv ") })) {
    $uv = Join-Path $env:ProgramFiles "WinGet\Links\uv.exe"
    if (-not (Test-Path -LiteralPath $uv)) {
        $uv = (Get-Command uv.exe -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*\WindowsApps\*" } | Select-Object -First 1).Source
    }
    if (-not $uv) {
        $failed += "Python 3.13 (uv isn't on this machine)"
    } else {
        $pythonRoot = Join-Path $env:ProgramData "Runyard\python"
        $env:UV_PYTHON_INSTALL_DIR = $pythonRoot
        $env:UV_PYTHON_BIN_DIR = Join-Path $pythonRoot "bin"
        Write-Output "Installing Python 3.13 with uv into $pythonRoot"
        # On this session's PATH too, so uv doesn't warn that it isn't; and --default opted
        # into as the preview feature it is, so uv doesn't warn about that either.
        $env:Path = "$env:UV_PYTHON_BIN_DIR;$env:Path"
        & $uv python install 3.13 --default --preview-features python-install-default
        if ($LASTEXITCODE -ne 0) { $failed += "Python 3.13 (uv exit code $LASTEXITCODE)" }
        else {
            & icacls.exe $pythonRoot /reset /T /C /Q | Out-Null
            Add-MachinePath $env:UV_PYTHON_BIN_DIR
        }
    }
}

# What the runner's service will see: the machine PATH, less folders inside user profiles
# (as machine-readiness.ps1 counts them).
$profiles = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList").ProfilesDirectory.TrimEnd("\") + "\"
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine") -split ";" |
    Where-Object { $_ -and -not ([Environment]::ExpandEnvironmentVariables($_) + "\").StartsWith($profiles, [StringComparison]::OrdinalIgnoreCase) }
$unseen = @()
foreach ($tool in $tools) {
    if ($failed | Where-Object { $_.StartsWith("$($packages[$tool]) ") }) { continue }
    if ($tool -eq "python3" -and ($failed | Where-Object { $_.StartsWith("Python 3.13 ") })) { continue }
    $found = $machinePath | Where-Object { Test-Path -LiteralPath (Join-Path $_ "$($commands[$tool]).exe") } | Select-Object -First 1
    if (-not $found) { $unseen += $commands[$tool] }
}
$problems = @()
if ($failed) { $problems += "Couldn't install $($failed -join ', ')." }
if ($unseen) { $problems += "Installed, but not on the machine PATH: $(($unseen | Select-Object -Unique) -join ', ')." }
if ($problems) { throw ($problems -join " ") }
Write-Output "Installed: $(($tools | ForEach-Object { if ($_ -eq 'python3') { 'Python 3.13 (uv)' } else { $packages[$_] } } | Select-Object -Unique) -join ', ')"
