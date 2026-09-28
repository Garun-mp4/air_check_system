[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('bootstrap', 'recover')]
  [string]$Mode,

  [Parameter(Position = 1)]
  [string]$Email
)

$ErrorActionPreference = 'Stop'
$passwordPolicy = Get-Content -Raw (Join-Path $PSScriptRoot '..\password-policy.json') | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($Email)) {
  $Email = Read-Host 'Owner email'
}

$securePassword = Read-Host -Prompt "New owner password ($($passwordPolicy.minimumLength)+ characters)" -AsSecureString
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

if ($plainPassword.Length -lt $passwordPolicy.minimumLength -or $plainPassword.Length -gt $passwordPolicy.maximumLength) {
  $plainPassword = $null
  $plainConfirmation = $null
  throw "Password must contain $($passwordPolicy.minimumLength)–$($passwordPolicy.maximumLength) characters."
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
