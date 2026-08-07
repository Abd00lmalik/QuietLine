param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$User = "ubuntu",
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\quietline_tencent"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$requiredPrivateFiles = @(
  (Join-Path $root ".env"),
  (Join-Path $root "fcc\.env.coston2"),
  (Join-Path $root "fcc\generated\proxy.coston2.toml"),
  (Join-Path $root "relayer\.env")
)
foreach ($path in $requiredPrivateFiles) {
  if (-not (Test-Path $path)) {
    throw "Required private configuration is missing: $path"
  }
}
if (-not (Test-Path $IdentityFile)) {
  throw "SSH identity file does not exist: $IdentityFile"
}

$ssh = @(
  "-i", $IdentityFile,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new"
)
$staging = Join-Path $env:TEMP "quietline-ssh-hosting"
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $staging | Out-Null
$archive = Join-Path $staging "quietline.tar"

git -C $root archive --format=tar --output=$archive HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Could not archive the current Git revision."
}
Copy-Item (Join-Path $root ".env") (Join-Path $staging "root.env")
Copy-Item (Join-Path $root "fcc\.env.coston2") (Join-Path $staging "fcc.env")
Copy-Item (Join-Path $root "fcc\generated\proxy.coston2.toml") (Join-Path $staging "proxy.toml")
Copy-Item (Join-Path $root "relayer\.env") (Join-Path $staging "relayer.env")

& scp @ssh `
  $archive `
  (Join-Path $staging "root.env") `
  (Join-Path $staging "fcc.env") `
  (Join-Path $staging "proxy.toml") `
  (Join-Path $staging "relayer.env") `
  "${User}@${HostName}:/tmp/"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to upload the Quietline release."
}

$remote = @'
set -euo pipefail
if ! grep -q '^AUTH_TOKEN=' /tmp/root.env; then
  recovered_auth_token="$(
    sudo docker inspect \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      fcc-ngrok-fcc-1 2>/dev/null |
      sed -n 's/^AUTH_TOKEN=//p' |
      head -n 1
  )"
  if [ -z "$recovered_auth_token" ]; then
    echo "AUTH_TOKEN is missing and could not be recovered from the running ngrok container." >&2
    exit 1
  fi
  printf '\nAUTH_TOKEN=%s\n' "$recovered_auth_token" >> /tmp/root.env
fi
sudo install -d -m 0750 -o "$USER" -g "$USER" /opt/quietline
sudo find /opt/quietline -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo tar -xf /tmp/quietline.tar -C /opt/quietline
sudo install -m 0600 /tmp/root.env /opt/quietline/.env
sudo install -m 0600 /tmp/fcc.env /opt/quietline/fcc/.env.coston2
sudo install -d -m 0750 /opt/quietline/fcc/generated
sudo install -m 0640 -o root -g 1001 /tmp/proxy.toml /opt/quietline/fcc/generated/proxy.coston2.toml
sudo install -m 0600 /tmp/relayer.env /opt/quietline/relayer/.env
cd /opt/quietline
sudo docker compose \
  --env-file .env \
  --env-file fcc/.env.coston2 \
  -f fcc/docker-compose.coston2.yaml \
  -f fcc/docker-compose.ngrok.yaml \
  -f fcc/docker-compose.host.yaml \
  config --quiet
sudo docker compose \
  --env-file .env \
  --env-file fcc/.env.coston2 \
  -f fcc/docker-compose.coston2.yaml \
  -f fcc/docker-compose.ngrok.yaml \
  -f fcc/docker-compose.host.yaml \
  build
rm -f /tmp/quietline.tar /tmp/root.env /tmp/fcc.env /tmp/proxy.toml /tmp/relayer.env
'@

& ssh @ssh "${User}@${HostName}" $remote
if ($LASTEXITCODE -ne 0) {
  throw "Remote Quietline staging or image build failed."
}

Remove-Item -Recurse -Force $staging
Write-Output "Quietline images and private configuration are staged on $HostName."
