<#
.SYNOPSIS
  Sets up staff login for the POS and KMS on the LOCAL development Keycloak
  (INTEGRATION_DESIGN.md §8, Step G). Windows PowerShell 5.1; uses kcadm inside the
  haip-keycloak container through `docker exec`. Never changes HAIP's files.

.DESCRIPTION
  Safe to run again: existing clients, roles, mappers and users are updated, not duplicated.
  Creates on realm "haip":
    - client stayx-pos-api   (confidential, no login flows; holds the POS roles; token audience)
    - roles pos_staff, pos_kitchen, pos_manager on stayx-pos-api
    - clients stayx-pos-web / stayx-kms-web (public, code + PKCE S256), each with an
      audience mapper, a property_ids mapper (multivalued), and only the POS roles in scope
    - test users pos-staff-1, pos-manager-1, kitchen-t1 (hotel A), kitchen-t2 (hotel B)
  Realm-wide changes (affect HAIP's clients too, so each needs its own switch):
    -AllowPropertyIdsAttribute  user profile: unmanaged attributes editable by admins only,
                                so users can carry property_ids (Keycloak 24 drops it otherwise)
    -RotateRefreshTokens        refresh token rotation (revokeRefreshToken, max reuse 0)
  Previous realm values are saved to ..\secrets\keycloak-pos-login-state.json (outside the
  repo) so teardown-pos-login.ps1 can put them back.

  Secrets come from environment variables, or else from ..\secrets\keycloak-local.env
  (KEY=VALUE lines, outside both repos), and are never printed:
    KC_ADMIN_PASSWORD        Keycloak admin password (local dev)
    POS_TEST_USER_PASSWORD   password for the four test users

.EXAMPLE
  .\scripts\keycloak\setup-pos-login.ps1 -AllowPropertyIdsAttribute -RotateRefreshTokens
#>
[CmdletBinding()]
param(
  [string]$Container = 'haip-keycloak',
  [string]$Realm = 'haip',
  [string]$AdminUser = 'admin',
  [string]$PropertyA = 'a0000001-0000-4000-a000-000000000001',
  [string]$PropertyB = 'b0000002-0000-4000-a000-000000000002',
  [string]$PosOrigin = 'http://localhost:5180',
  [string]$KmsOrigin = 'http://localhost:5181',
  [switch]$AllowPropertyIdsAttribute,
  [switch]$RotateRefreshTokens
)

$ErrorActionPreference = 'Stop'
$Kcadm = '/opt/keycloak/bin/kcadm.sh'
$StateFile = Join-Path $PSScriptRoot '..\..\..\secrets\keycloak-pos-login-state.json'
$SecretsFile = Join-Path $PSScriptRoot '..\..\..\secrets\keycloak-local.env'

# Environment variables win; otherwise KEY=VALUE lines from the local secrets file.
# Values go into this process only and are never printed.
function Import-LocalSecrets {
  if (-not (Test-Path $SecretsFile)) { return }
  foreach ($line in Get-Content $SecretsFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=(.*)$' -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($Matches[1]))) {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
  }
}
Import-LocalSecrets

function Get-RequiredSecret([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrEmpty($value)) { throw "Set `$env:$Name or put it in $SecretsFile (it is never printed)." }
  return $value
}

# Runs kcadm in the container. Errors show only the command name, never its arguments
# (which can hold passwords).
function Invoke-Kcadm {
  param([string[]]$KcArgs, [string]$Json)
  # kcadm writes progress (e.g. "Logging into ...") to stderr. With 'Stop', Windows
  # PowerShell turns any stderr line into an error, so judge by the exit code instead,
  # and keep stdout (the JSON) apart from stderr.
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

function Get-ClientUuid([string]$ClientId) {
  $id = Invoke-Kcadm @('get', 'clients', '-r', $Realm, '-q', "clientId=$ClientId", '--fields', 'id', '--format', 'csv', '--noquotes')
  if ($id) { return $id.Split("`n")[0].Trim() } else { return $null }
}

function Set-Client([hashtable]$Spec) {
  $json = $Spec | ConvertTo-Json -Depth 6 -Compress
  $uuid = Get-ClientUuid $Spec.clientId
  if ($uuid) {
    Invoke-Kcadm @('update', "clients/$uuid", '-r', $Realm, '-f', '-') $json | Out-Null
    Write-Host "  updated client $($Spec.clientId)"
  } else {
    Invoke-Kcadm @('create', 'clients', '-r', $Realm, '-f', '-') $json | Out-Null
    $uuid = Get-ClientUuid $Spec.clientId
    Write-Host "  created client $($Spec.clientId)"
  }
  return $uuid
}

function Set-Mapper([string]$ClientUuid, [hashtable]$Mapper) {
  $existing = Invoke-Kcadm @('get', "clients/$ClientUuid/protocol-mappers/models", '-r', $Realm) | ConvertFrom-Json
  $found = @($existing | Where-Object { $_.name -eq $Mapper.name })
  $json = $Mapper | ConvertTo-Json -Depth 6 -Compress
  if ($found.Count -gt 0) {
    $Mapper.id = $found[0].id
    $json = $Mapper | ConvertTo-Json -Depth 6 -Compress
    Invoke-Kcadm @('update', "clients/$ClientUuid/protocol-mappers/models/$($found[0].id)", '-r', $Realm, '-f', '-') $json | Out-Null
  } else {
    Invoke-Kcadm @('create', "clients/$ClientUuid/protocol-mappers/models", '-r', $Realm, '-f', '-') $json | Out-Null
  }
}

# --- 0. Preconditions --------------------------------------------------------
$adminPassword = Get-RequiredSecret 'KC_ADMIN_PASSWORD'
$userPassword = Get-RequiredSecret 'POS_TEST_USER_PASSWORD'
$running = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($running -ne 'true') { throw "Container $Container is not running." }

Write-Host "1. Signing in to Keycloak as $AdminUser (master realm)"
Invoke-Kcadm @('config', 'credentials', '--server', 'http://localhost:8080', '--realm', 'master', '--user', $AdminUser, '--password', $adminPassword) | Out-Null

# --- 2. Realm-wide settings (only with their switches) -----------------------
# An object, not a hashtable: Add-Member notes on a hashtable are lost by ConvertTo-Json.
$state = [pscustomobject]@{ realm = $Realm; savedAt = (Get-Date).ToString('o') }
if (Test-Path $StateFile) { $state = Get-Content $StateFile -Raw | ConvertFrom-Json }

if ($AllowPropertyIdsAttribute) {
  Write-Host '2a. User profile: unmanaged attributes editable by admins (for property_ids)'
  $userProfile = Invoke-Kcadm @('get', 'users/profile', '-r', $Realm) | ConvertFrom-Json
  if (-not ($state.PSObject.Properties.Name -contains 'unmanagedAttributePolicy')) {
    $previous = if ($userProfile.PSObject.Properties.Name -contains 'unmanagedAttributePolicy') { $userProfile.unmanagedAttributePolicy } else { $null }
    $state | Add-Member -NotePropertyName unmanagedAttributePolicy -NotePropertyValue $previous -Force
  }
  $userProfile | Add-Member -NotePropertyName unmanagedAttributePolicy -NotePropertyValue 'ADMIN_EDIT' -Force
  Invoke-Kcadm @('update', 'users/profile', '-r', $Realm, '-f', '-') ($userProfile | ConvertTo-Json -Depth 20 -Compress) | Out-Null
}

if ($RotateRefreshTokens) {
  Write-Host '2b. Refresh token rotation (realm-wide)'
  $realmRep = Invoke-Kcadm @('get', "realms/$Realm", '--fields', 'revokeRefreshToken,refreshTokenMaxReuse') | ConvertFrom-Json
  if (-not ($state.PSObject.Properties.Name -contains 'revokeRefreshToken')) {
    $state | Add-Member -NotePropertyName revokeRefreshToken -NotePropertyValue ([bool]$realmRep.revokeRefreshToken) -Force
    $state | Add-Member -NotePropertyName refreshTokenMaxReuse -NotePropertyValue ([int]$realmRep.refreshTokenMaxReuse) -Force
  }
  Invoke-Kcadm @('update', "realms/$Realm", '-s', 'revokeRefreshToken=true', '-s', 'refreshTokenMaxReuse=0') | Out-Null
}
$state | ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8

# --- 3. The POS API client and its roles --------------------------------------
Write-Host '3. Client stayx-pos-api and roles'
$apiUuid = Set-Client @{
  clientId = 'stayx-pos-api'; name = 'StayX POS API (roles, token audience)'; enabled = $true; protocol = 'openid-connect'
  publicClient = $false; standardFlowEnabled = $false; implicitFlowEnabled = $false
  directAccessGrantsEnabled = $false; serviceAccountsEnabled = $false
}
$roles = @{ pos_staff = 'Takes orders, looks up stays'; pos_kitchen = 'Runs the kitchen board'; pos_manager = 'Everything, incl. menu and outbox' }
$existingRoles = (Invoke-Kcadm @('get', "clients/$apiUuid/roles", '-r', $Realm) | ConvertFrom-Json).name
foreach ($role in $roles.Keys) {
  if ($existingRoles -notcontains $role) {
    Invoke-Kcadm @('create', "clients/$apiUuid/roles", '-r', $Realm, '-s', "name=$role", '-s', "description=$($roles[$role])") | Out-Null
    Write-Host "  created role $role"
  }
}
$roleReps = Invoke-Kcadm @('get', "clients/$apiUuid/roles", '-r', $Realm)

# --- 4. The two screen clients -------------------------------------------------
foreach ($screen in @(@{ id = 'stayx-pos-web'; name = 'StayX POS screen'; origin = $PosOrigin }, @{ id = 'stayx-kms-web'; name = 'StayX kitchen board'; origin = $KmsOrigin })) {
  Write-Host "4. Client $($screen.id)"
  $uuid = Set-Client @{
    clientId = $screen.id; name = $screen.name; enabled = $true; protocol = 'openid-connect'
    publicClient = $true; standardFlowEnabled = $true; implicitFlowEnabled = $false
    directAccessGrantsEnabled = $false; serviceAccountsEnabled = $false
    redirectUris = @("$($screen.origin)/*"); webOrigins = @($screen.origin)
    # Only the POS roles go into these tokens, not every role the user has in HAIP.
    fullScopeAllowed = $false
    attributes = @{ 'pkce.code.challenge.method' = 'S256'; 'post.logout.redirect.uris' = "$($screen.origin)/*" }
  }
  Set-Mapper $uuid @{
    name = 'stayx-pos-api audience'; protocol = 'openid-connect'; protocolMapper = 'oidc-audience-mapper'
    config = @{ 'included.client.audience' = 'stayx-pos-api'; 'access.token.claim' = 'true'; 'id.token.claim' = 'false' }
  }
  Set-Mapper $uuid @{
    name = 'property_ids'; protocol = 'openid-connect'; protocolMapper = 'oidc-usermodel-attribute-mapper'
    config = @{
      'user.attribute' = 'property_ids'; 'claim.name' = 'property_ids'; 'jsonType.label' = 'String'; 'multivalued' = 'true'
      'access.token.claim' = 'true'; 'id.token.claim' = 'false'; 'userinfo.token.claim' = 'false'
    }
  }
  Invoke-Kcadm @('create', "clients/$uuid/scope-mappings/clients/$apiUuid", '-r', $Realm, '-f', '-') $roleReps | Out-Null
}

# --- 5. Test users --------------------------------------------------------------
$users = @(
  @{ username = 'pos-staff-1'; role = 'pos_staff'; property = $PropertyA; first = 'Pos'; last = 'Staff' },
  @{ username = 'pos-manager-1'; role = 'pos_manager'; property = $PropertyA; first = 'Pos'; last = 'Manager' },
  @{ username = 'kitchen-t1'; role = 'pos_kitchen'; property = $PropertyA; first = 'Kitchen'; last = 'Tablet 1' },
  @{ username = 'kitchen-t2'; role = 'pos_kitchen'; property = $PropertyB; first = 'Kitchen'; last = 'Tablet 2' }
)
foreach ($u in $users) {
  Write-Host "5. User $($u.username) ($($u.role), hotel $($u.property.Substring(0, 8)))"
  # Names and e-mail are filled so Keycloak 24 doesn't ask the user to complete a profile.
  $rep = @{
    username = $u.username; enabled = $true; emailVerified = $true; email = "$($u.username)@stayx.test"
    firstName = $u.first; lastName = $u.last; attributes = @{ property_ids = @($u.property) }
  } | ConvertTo-Json -Depth 5 -Compress
  $userId = Invoke-Kcadm @('get', 'users', '-r', $Realm, '-q', "username=$($u.username)", '-q', 'exact=true', '--fields', 'id', '--format', 'csv', '--noquotes')
  if ($userId) {
    Invoke-Kcadm @('update', "users/$($userId.Split("`n")[0].Trim())", '-r', $Realm, '-f', '-') $rep | Out-Null
  } else {
    Invoke-Kcadm @('create', 'users', '-r', $Realm, '-f', '-') $rep | Out-Null
  }
  Invoke-Kcadm @('set-password', '-r', $Realm, '--username', $u.username, '--new-password', $userPassword) | Out-Null
  Invoke-Kcadm @('add-roles', '-r', $Realm, '--uusername', $u.username, '--cclientid', 'stayx-pos-api', '--rolename', $u.role) | Out-Null
  # Check the attribute survived (it is silently dropped if the user profile doesn't allow it).
  $saved = Invoke-Kcadm @('get', 'users', '-r', $Realm, '-q', "username=$($u.username)", '-q', 'exact=true') | ConvertFrom-Json
  if (-not $saved[0].attributes.property_ids) { Write-Warning "  property_ids was NOT stored for $($u.username) (user profile drops it; see -AllowPropertyIdsAttribute)" }
}

Write-Host ''
Write-Host "Done. Realm state saved to $StateFile"
