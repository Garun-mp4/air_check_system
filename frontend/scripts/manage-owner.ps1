[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('bootstrap', 'recover')]
  [string]$Mode,

  [Parameter(Position = 1)]
  [string]$Email
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Email)) {
  $Email = Read-Host 'Owner email'
}

$securePassword = Read-Host -Prompt 'New owner password (12+ characters)' -AsSecureString
$secureConfirmation = Read-Host -Prompt 'Repeat password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
  $securePassword.Dispose()
  $secureConfirmation.Dispose()
}

if ($plainPassword.Length -lt 12 -or $plainPassword.Length -gt 128) {
  $plainPassword = $null
  $plainConfirmation = $null
  throw 'Password must contain 12–128 characters.'
}
if ($plainPassword -cne $plainConfirmation) {
  $plainPassword = $null
  $plainConfirmation = $null
  throw 'Passwords do not match.'
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exitCode = 1
Push-Location $repositoryRoot
try {
  @($plainPassword, $plainConfirmation) | docker compose run --rm -T owner-cli $Mode $Email --password-stdin
  $exitCode = $LASTEXITCODE
} finally {
  $plainPassword = $null
  $plainConfirmation = $null
  Pop-Location
}

exit $exitCode
