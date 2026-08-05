param(
  [string]$ProjectId = "flowra-495207",
  [string]$Zone = "europe-west1-b",
  [string]$Instance = "quietline-coston2"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$composeFiles = @(
  "-f", "fcc/docker-compose.coston2.yaml",
  "-f", "fcc/docker-compose.ngrok.yaml"
)
$oldSigner = (Get-Content (Join-Path $root "deployments\coston2.json") -Raw |
  ConvertFrom-Json).teeSigner
$staging = Join-Path $env:TEMP "quietline-cutover"
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $staging | Out-Null

Push-Location $root
try {
  docker compose --env-file .env --env-file fcc/.env.coston2 @composeFiles `
    stop relayer ngrok-fcc public-gateway extension-tee tee-proxy

  foreach ($volume in @(
    @{ Name = "fcc_quietline-private-state-v2"; Archive = "private-state.tgz" },
    @{ Name = "fcc_quietline-relayer-data"; Archive = "relayer-state.tgz" }
  )) {
    docker volume inspect $volume.Name | Out-Null
    docker run --rm `
      -v "$($volume.Name):/source:ro" `
      -v "${staging}:/backup" `
      alpine:3.22 `
      tar -C /source -czf "/backup/$($volume.Archive)" .
  }

  & $gcloud compute scp `
    --project=$ProjectId `
    --zone=$Zone `
    (Join-Path $staging "private-state.tgz") `
    (Join-Path $staging "relayer-state.tgz") `
    "${Instance}:/tmp/"

  $remote = @'
set -euo pipefail
cd /opt/quietline
sudo docker volume create fcc_quietline-private-state-v2 >/dev/null
sudo docker volume create fcc_quietline-relayer-data >/dev/null
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
  & $gcloud compute ssh $Instance `
    --project=$ProjectId `
    --zone=$Zone `
    --command=$remote

  $headers = @{ "ngrok-skip-browser-warning" = "quietline" }
  $deadline = (Get-Date).AddMinutes(3)
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
    throw "Remote FCC proxy did not become reachable within three minutes."
  }

  corepack pnpm@10.33.2 coston2:register-machine
  $env:STALE_TEE_ID = $oldSigner
  corepack pnpm@10.33.2 coston2:pause-stale-machine
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
  & $gcloud compute ssh $Instance `
    --project=$ProjectId `
    --zone=$Zone `
    --command=$startRelayer

  $health = Invoke-RestMethod `
    -Uri "https://speculate-ipod-harmful.ngrok-free.dev/api/health" `
    -Headers $headers
  if ($health.status -ne "ok") {
    throw "Remote Quietline health check is not healthy."
  }
  corepack pnpm@10.33.2 coston2:seed-lender
  Write-Output "Quietline cutover completed and the previous TEE was retired."
} finally {
  Remove-Item Env:STALE_TEE_ID -ErrorAction SilentlyContinue
  Pop-Location
}
