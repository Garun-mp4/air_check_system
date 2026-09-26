param(
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $Python) {
    $venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
    $Python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }
}

Push-Location $repoRoot
try {
    & $Python --version
    if ($LASTEXITCODE -ne 0) { throw "Python executable failed: $Python" }
    & $Python setup.py build_apps
    if ($LASTEXITCODE -ne 0) { throw "Panda3D standalone build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
