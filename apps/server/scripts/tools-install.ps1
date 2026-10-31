# Installs the tools a machine's pools call for and its last check found
# missing: RF_TOOLS, space-separated, from Runyard's fixed list. Uses winget
# with machine scope, so the runner's service account finds them on the
# machine PATH. The packages match WINDOWS_TOOLS in packages/core.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$packages = @{
    git     = "Git.Git"
    unzip   = "7zip.7zip"
    zip     = "7zip.7zip"
    xz      = "TukaaniProject.XZUtils"
    zstd    = "Meta.Zstandard"
    jq      = "jqlang.jq"
    gpg     = "GnuPG.GnuPG"
    cc      = "BrechtSanders.WinLibs.POSIX.UCRT"
    make    = "ezwinports.make"
    python3 = "Python.Python.3.13"
    node    = "OpenJS.NodeJS.LTS"
}
$commands = @{
    git = "git"; unzip = "7z"; zip = "7z"; xz = "xz"; zstd = "zstd"; jq = "jq"; gpg = "gpg"
    cc = "gcc"; make = "make"; python3 = "python"; node = "node"
}
# Installers that leave their directory off PATH; added to the machine PATH when present.
$directories = @{
    "7zip.7zip"   = @("$env:ProgramFiles\7-Zip")
    "GnuPG.GnuPG" = @("$env:ProgramFiles\GnuPG\bin", "${env:ProgramFiles(x86)}\GnuPG\bin")
}
# Exit codes that leave the package installed: already there, or needing a restart to finish.
$installed = @(0, -1978335135, -1978334963, -1978334967)

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

foreach ($id in ($tools | ForEach-Object { $packages[$_] } | Select-Object -Unique)) {
    Write-Output "Installing $id"
    & winget.exe install --exact --id $id --source winget --scope machine `
        --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($installed -notcontains $LASTEXITCODE) { throw "winget couldn't install $id (exit code $LASTEXITCODE)." }
    foreach ($dir in $directories[$id]) {
        if ($dir -and (Test-Path -LiteralPath $dir)) { Add-MachinePath $dir; break }
    }
}

# What the runner's service will see: the machine PATH alone.
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine") -split ";" | Where-Object { $_ }
$unseen = @()
foreach ($tool in $tools) {
    $found = $machinePath | Where-Object { Test-Path -LiteralPath (Join-Path $_ "$($commands[$tool]).exe") } | Select-Object -First 1
    if (-not $found) { $unseen += $commands[$tool] }
}
if ($unseen) {
    throw "Installed, but not on the machine PATH: $(($unseen | Select-Object -Unique) -join ', ')."
}
Write-Output "Installed with winget: $(($tools | ForEach-Object { $packages[$_] } | Select-Object -Unique) -join ', ')"
