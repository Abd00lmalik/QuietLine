param(
  [string]$ProjectId = "flowra-495207",
  [string]$Zone = "europe-west1-b",
  [string]$Instance = "quietline-coston2"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$requiredPrivateFiles = @(
  (Join-Path $root ".env"),
  (Join-Path $root "fcc\.env.coston2"),
  (Join-Path $root "relayer\.env")
)
foreach ($path in $requiredPrivateFiles) {
  if (-not (Test-Path $path)) {
    throw "Required private configuration is missing: $path"
  }
}

$billing = & $gcloud billing projects describe $ProjectId --format=json | ConvertFrom-Json
if (-not $billing.billingEnabled) {
  throw "Project $ProjectId does not have active billing."
}

$status = & $gcloud compute instances describe $Instance `
  --project=$ProjectId `
  --zone=$Zone `
  --format="value(status)"
if ($status -ne "RUNNING") {
  throw "Instance $Instance is not running."
}

$staging = Join-Path $env:TEMP "quietline-hosting"
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $staging | Out-Null
$archive = Join-Path $staging "quietline.tar"

git -C $root archive --format=tar --output=$archive HEAD
Copy-Item (Join-Path $root ".env") (Join-Path $staging "root.env")
Copy-Item (Join-Path $root "fcc\.env.coston2") (Join-Path $staging "fcc.env")
Copy-Item (Join-Path $root "relayer\.env") (Join-Path $staging "relayer.env")

& $gcloud compute scp `
  --project=$ProjectId `
  --zone=$Zone `
  $archive `
  (Join-Path $staging "root.env") `
  (Join-Path $staging "fcc.env") `
  (Join-Path $staging "relayer.env") `
  "${Instance}:/tmp/"

$remote = @'
set -euo pipefail
sudo install -d -m 0750 /opt/quietline
sudo tar -xf /tmp/quietline.tar -C /opt/quietline
sudo install -m 0600 /tmp/root.env /opt/quietline/.env
sudo install -m 0600 /tmp/fcc.env /opt/quietline/fcc/.env.coston2
sudo install -m 0600 /tmp/relayer.env /opt/quietline/relayer/.env
cd /opt/quietline
sudo docker compose \
  --env-file .env \
  --env-file fcc/.env.coston2 \
  -f fcc/docker-compose.coston2.yaml \
  -f fcc/docker-compose.ngrok.yaml \
  -f fcc/docker-compose.host.yaml \
  build
rm -f /tmp/quietline.tar /tmp/root.env /tmp/fcc.env /tmp/relayer.env
'@

& $gcloud compute ssh $Instance `
  --project=$ProjectId `
  --zone=$Zone `
  --command=$remote
Write-Output "Quietline images and private configuration are staged on $Instance."
