param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$User = "ubuntu",
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\quietline_tencent"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$composeFiles = @(
  "-f", "fcc/docker-compose.coston2.yaml",
  "-f", "fcc/docker-compose.ngrok.yaml"
)
$oldSigner = (Get-Content (Join-Path $root "deployments\coston2.json") -Raw |
  ConvertFrom-Json).teeSigner
$staging = Join-Path $env:TEMP "quietline-ssh-cutover"
$ssh = @(
  "-i", $IdentityFile,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new"
)

Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $staging | Out-Null

Push-Location $root
try {
  $health = Invoke-RestMethod `
    -Uri "https://speculate-ipod-harmful.ngrok-free.dev/api/health" `
    -Headers @{ "ngrok-skip-browser-warning" = "quietline" }
  if ($health.status -ne "ok") {
    throw "Local Quietline health check is not healthy before cutover."
  }

  docker compose --env-file .env --env-file fcc/.env.coston2 @composeFiles `
    stop relayer ngrok-fcc public-gateway extension-tee tee-proxy redis
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop the local Quietline services cleanly."
  }

  foreach ($volume in @(
    @{ Name = "fcc_quietline-private-state-v2"; Archive = "private-state.tgz" },
    @{ Name = "fcc_quietline-relayer-data"; Archive = "relayer-state.tgz" }
  )) {
    docker volume inspect $volume.Name | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Required local Docker volume is missing: $($volume.Name)"
    }
    docker run --rm `
      -v "$($volume.Name):/source:ro" `
      -v "${staging}:/backup" `
      alpine:3.22 `
      tar -C /source -czf "/backup/$($volume.Archive)" .
    if ($LASTEXITCODE -ne 0) {
      throw "Could not export $($volume.Name)."
    }
  }

  & scp @ssh `
    (Join-Path $staging "private-state.tgz") `
    (Join-Path $staging "relayer-state.tgz") `
    "${User}@${HostName}:/tmp/"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload Quietline state archives."
  }

  $remote = @'
set -euo pipefail
cd /opt/quietline
sudo docker volume create fcc_quietline-private-state-v2 >/dev/null
sudo docker volume create fcc_quietline-relayer-data >/dev/null
sudo docker volume create fcc_quietline-redis-data >/dev/null
sudo docker run --rm \
  -v fcc_quietline-private-state-v2:/target \
  -v /tmp:/backup:ro \
  alpine:3.22 sh -c 'rm -rf /target/* && tar -C /target -xzf /backup/private-state.tgz'
sudo docker run --rm \
  -v fcc_quietline-relayer-data:/target \
  -v /tmp:/backup:ro \
  alpine:3.22 sh -c 'rm -rf /target/* && tar -C /target -xzf /backup/relayer-state.tgz'
sudo docker compose \
  --env-file .env \
  --env-file fcc/.env.coston2 \
  -f fcc/docker-compose.coston2.yaml \
  -f fcc/docker-compose.ngrok.yaml \
  -f fcc/docker-compose.host.yaml \
  up -d redis tee-proxy extension-tee
sudo docker compose \
  --env-file .env \
  --env-file fcc/.env.coston2 \
  -f fcc/docker-compose.coston2.yaml \
  -f fcc/docker-compose.ngrok.yaml \
  -f fcc/docker-compose.host.yaml \
  up -d --no-deps public-gateway ngrok-fcc
rm -f /tmp/private-state.tgz /tmp/relayer-state.tgz
'@
  & ssh @ssh "${User}@${HostName}" $remote
  if ($LASTEXITCODE -ne 0) {
    throw "Remote state restoration or FCC startup failed."
  }

  $headers = @{ "ngrok-skip-browser-warning" = "quietline" }
  $deadline = (Get-Date).AddMinutes(5)
  do {
    Start-Sleep -Seconds 5
    try {
      $info = Invoke-RestMethod `
        -Uri "https://speculate-ipod-harmful.ngrok-free.dev/info" `
        -Headers $headers
    } catch {
      $info = $null
    }
  } while (-not $info -and (Get-Date) -lt $deadline)
  if (-not $info) {
    throw "Remote FCC proxy did not become reachable within five minutes."
  }

  Remove-Item (Join-Path $root ".cache\register-tee.state") -Force -ErrorAction SilentlyContinue
  corepack pnpm@10.33.2 coston2:register-machine
  if ($LASTEXITCODE -ne 0) {
    throw "The remote TEE could not be registered."
  }

  $env:STALE_TEE_ID = $oldSigner
  corepack pnpm@10.33.2 coston2:pause-stale-machine
  if ($LASTEXITCODE -ne 0) {
    throw "The previous TEE could not be paused."
  }
  Remove-Item Env:STALE_TEE_ID

  $startRelayer = @'
set -euo pipefail
cd /opt/quietline
sudo docker compose \
  --env-file .env \
  --env-file fcc/.env.coston2 \
  -f fcc/docker-compose.coston2.yaml \
  -f fcc/docker-compose.ngrok.yaml \
  -f fcc/docker-compose.host.yaml \
  up -d relayer
'@
  & ssh @ssh "${User}@${HostName}" $startRelayer
  if ($LASTEXITCODE -ne 0) {
    throw "The remote relayer could not be started."
  }

  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 5
    try {
      $health = Invoke-RestMethod `
        -Uri "https://speculate-ipod-harmful.ngrok-free.dev/api/health" `
        -Headers $headers
    } catch {
      $health = $null
    }
  } while (
    (!$health -or $health.status -ne "ok") -and
    (Get-Date) -lt $deadline
  )
  if (!$health -or $health.status -ne "ok") {
    throw "Remote Quietline health check did not become healthy."
  }

  Write-Output "Quietline cutover completed and the previous TEE was retired."
} catch {
  Write-Warning "Cutover failed. The local services will be restarted."
  docker compose --env-file .env --env-file fcc/.env.coston2 @composeFiles up -d
  throw
} finally {
  Remove-Item Env:STALE_TEE_ID -ErrorAction SilentlyContinue
  Pop-Location
}
