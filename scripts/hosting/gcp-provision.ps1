param(
  [string]$ProjectId = "flowra-495207",
  [string]$Zone = "europe-west1-b",
  [string]$Instance = "quietline-coston2"
)

$ErrorActionPreference = "Stop"
$gcloud = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if (-not (Test-Path $gcloud)) {
  throw "Google Cloud CLI is not installed."
}

$account = & $gcloud auth list --filter=status:ACTIVE --format="value(account)"
if (-not $account) {
  throw "Google Cloud CLI has no active account. Run gcloud auth login first."
}

$billing = & $gcloud billing projects describe $ProjectId --format=json | ConvertFrom-Json
if (-not $billing.billingEnabled) {
  throw "Project $ProjectId does not have active billing. Link an open billing account before provisioning."
}

& $gcloud config set project $ProjectId | Out-Null
& $gcloud services enable compute.googleapis.com

$existing = & $gcloud compute instances list `
  --filter="name=($Instance) AND zone:($Zone)" `
  --format="value(name)"
if ($existing) {
  Write-Output "Instance $Instance already exists in $Zone."
  exit 0
}

$startupScript = Join-Path $PSScriptRoot "gcp-startup.sh"
& $gcloud compute instances create $Instance `
  --zone=$Zone `
  --machine-type=e2-standard-4 `
  --boot-disk-size=50GB `
  --boot-disk-type=pd-balanced `
  --image-family=ubuntu-2404-lts-amd64 `
  --image-project=ubuntu-os-cloud `
  --metadata-from-file=startup-script=$startupScript `
  --labels=app=quietline,network=coston2 `
  --deletion-protection

& $gcloud compute instances describe $Instance `
  --zone=$Zone `
  --format="table(name,status,machineType.basename(),networkInterfaces[0].accessConfigs[0].natIP)"
