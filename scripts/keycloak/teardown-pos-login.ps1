<#
.SYNOPSIS
  Undoes setup-pos-login.ps1 on the LOCAL development Keycloak: deletes the POS screen
  clients, the stayx-pos-api client (and with it its roles) and the four test users, and
  puts back the realm settings saved in ..\secrets\keycloak-pos-login-state.json.
  Does not touch the stayx-pos service principal (HAIP stay lookup, §15).

  Needs KC_ADMIN_PASSWORD, from the environment or ..\secrets\keycloak-local.env (never printed).
#>
[CmdletBinding()]
param(
  [string]$Container = 'haip-keycloak',
  [string]$Realm = 'haip',
  [string]$AdminUser = 'admin'
)

$ErrorActionPreference = 'Stop'
$Kcadm = '/opt/keycloak/bin/kcadm.sh'
$StateFile = Join-Path $PSScriptRoot '..\..\..\secrets\keycloak-pos-login-state.json'
$SecretsFile = Join-Path $PSScriptRoot '..\..\..\secrets\keycloak-local.env'

# Environment variables win; otherwise KEY=VALUE lines from the local secrets file.
function Import-LocalSecrets {
  if (-not (Test-Path $SecretsFile)) { return }
  foreach ($line in Get-Content $SecretsFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=(.*)$' -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($Matches[1]))) {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
  }
}
Import-LocalSecrets

function Invoke-Kcadm {
  param([string[]]$KcArgs, [string]$Json)
  # kcadm writes progress to stderr; judge by the exit code and keep stdout apart (see setup).
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Json) {
      # Through a file, not a pipe: Windows PowerShell can put a byte-order mark in front
      # of piped text, which Keycloak rejects. The file is written without one.
      $local = Join-Path $env:TEMP ("stayx-kcadm-" + [guid]::NewGuid().ToString('N') + '.json')
      $remote = '/tmp/' + (Split-Path $local -Leaf)
      [IO.File]::WriteAllText($local, $Json, (New-Object System.Text.UTF8Encoding($false)))
      docker cp $local "$($Container):$remote" 2>&1 | Out-Null
      $fileArgs = @($KcArgs | ForEach-Object { if ($_ -eq '-') { $remote } else { $_ } })
      $all = docker exec $Container $Kcadm @fileArgs 2>&1
      $code = $LASTEXITCODE
      docker exec $Container rm -f $remote 2>&1 | Out-Null
      Remove-Item $local -ErrorAction SilentlyContinue
    } else {
      $all = docker exec $Container $Kcadm @KcArgs 2>&1
      $code = $LASTEXITCODE
    }
  } finally {
    $ErrorActionPreference = $previous
  }
  $stdout = @($all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
  $stderr = @($all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
  if ($code -ne 0) { throw "kcadm $($KcArgs[0]) $($KcArgs[1]) failed (exit $code): $($stderr -join ' ') $($stdout -join ' ')" }
  return ($stdout -join "`n").Trim()
}

$adminPassword = [Environment]::GetEnvironmentVariable('KC_ADMIN_PASSWORD')
if ([string]::IsNullOrEmpty($adminPassword)) { throw "Set `$env:KC_ADMIN_PASSWORD or put it in $SecretsFile (it is never printed)." }
Invoke-Kcadm @('config', 'credentials', '--server', 'http://localhost:8080', '--realm', 'master', '--user', $AdminUser, '--password', $adminPassword) | Out-Null

foreach ($username in @('pos-staff-1', 'pos-manager-1', 'kitchen-t1', 'kitchen-t2')) {
  $id = Invoke-Kcadm @('get', 'users', '-r', $Realm, '-q', "username=$username", '-q', 'exact=true', '--fields', 'id', '--format', 'csv', '--noquotes')
  if ($id) { Invoke-Kcadm @('delete', "users/$($id.Split("`n")[0].Trim())", '-r', $Realm) | Out-Null; Write-Host "deleted user $username" }
}
foreach ($clientId in @('stayx-pos-web', 'stayx-kms-web', 'stayx-pos-api')) {
  $id = Invoke-Kcadm @('get', 'clients', '-r', $Realm, '-q', "clientId=$clientId", '--fields', 'id', '--format', 'csv', '--noquotes')
  if ($id) { Invoke-Kcadm @('delete', "clients/$($id.Split("`n")[0].Trim())", '-r', $Realm) | Out-Null; Write-Host "deleted client $clientId" }
}

if (Test-Path $StateFile) {
  $state = Get-Content $StateFile -Raw | ConvertFrom-Json
  if ($state.PSObject.Properties.Name -contains 'revokeRefreshToken') {
    Invoke-Kcadm @('update', "realms/$Realm", '-s', "revokeRefreshToken=$($state.revokeRefreshToken.ToString().ToLower())", '-s', "refreshTokenMaxReuse=$($state.refreshTokenMaxReuse)") | Out-Null
    Write-Host "restored refresh token settings (revoke=$($state.revokeRefreshToken), maxReuse=$($state.refreshTokenMaxReuse))"
  }
  if ($state.PSObject.Properties.Name -contains 'unmanagedAttributePolicy') {
    $userProfile = Invoke-Kcadm @('get', 'users/profile', '-r', $Realm) | ConvertFrom-Json
    if ($null -eq $state.unmanagedAttributePolicy) {
      $userProfile.PSObject.Properties.Remove('unmanagedAttributePolicy')
    } else {
      $userProfile | Add-Member -NotePropertyName unmanagedAttributePolicy -NotePropertyValue $state.unmanagedAttributePolicy -Force
    }
    Invoke-Kcadm @('update', 'users/profile', '-r', $Realm, '-f', '-') ($userProfile | ConvertTo-Json -Depth 20 -Compress) | Out-Null
    Write-Host "restored user profile unmanaged attribute policy ($($state.unmanagedAttributePolicy))"
  }
  Remove-Item $StateFile
}
Write-Host 'Teardown done.'
