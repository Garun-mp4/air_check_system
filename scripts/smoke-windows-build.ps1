param(
    [string]$Executable = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $Executable) {
    $candidate = Get-ChildItem -LiteralPath (Join-Path $repoRoot "build\win_amd64") -Filter "AirCheck 3D Simulator.exe" -File -Recurse -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $candidate) { throw "Build executable not found. Run scripts/build-windows.ps1 first." }
    $Executable = $candidate.FullName
}

if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable not found: $Executable" }
$process = Start-Process -FilePath $Executable -ArgumentList "--smoke-test-seconds 4" -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Standalone smoke test failed with exit code $($process.ExitCode)" }
Write-Output "Standalone smoke test passed: $Executable"
