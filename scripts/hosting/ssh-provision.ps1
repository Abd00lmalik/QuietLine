param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$User = "ubuntu",
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\quietline_tencent"
)

$ErrorActionPreference = "Stop"
$bootstrap = Join-Path $PSScriptRoot "host-bootstrap.sh"
if (-not (Test-Path $IdentityFile)) {
  throw "SSH identity file does not exist: $IdentityFile"
}

$ssh = @(
  "-i", $IdentityFile,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new"
)

& scp @ssh $bootstrap "${User}@${HostName}:/tmp/quietline-host-bootstrap.sh"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to upload the host bootstrap script."
}

& ssh @ssh "${User}@${HostName}" `
  "sudo bash /tmp/quietline-host-bootstrap.sh '$User' && rm -f /tmp/quietline-host-bootstrap.sh"
if ($LASTEXITCODE -ne 0) {
  throw "Remote host provisioning failed."
}

Write-Output "Quietline host provisioning completed on $HostName."
