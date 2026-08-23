Param(
    [switch]$StartDocker
)

Function Prompt-Secret([string]$prompt) {
    Write-Host $prompt -NoNewline
    $s = Read-Host
    return $s
}

function Validate-GoogleClientId([string]$id) {
    if ([string]::IsNullOrWhiteSpace($id)) { return $false }
    # basic pattern check: should end with .apps.googleusercontent.com and contain alnum, - or _ and a dot
    return $id -match '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$'
}

# Ensure we're running from repo root (has client and server folders)
$root = Get-Location
if (-not (Test-Path "$root\client\.env.example")) {
    Write-Error "Cannot find client/.env.example. Run this script from the project root."
    exit 1
}

# Copy examples if missing
if (-not (Test-Path "$root\client\.env")) {
    Copy-Item "$root\client\.env.example" "$root\client\.env"
    Write-Host "Created client/.env from example"
} else {
    Write-Host "client/.env already exists — skipping copy"
}

if (-not (Test-Path "$root\server\.env")) {
    Copy-Item "$root\server\.env.example" "$root\server\.env"
    Write-Host "Created server/.env from example"
} else {
    Write-Host "server/.env already exists — skipping copy"
}

# Prompt for required values
function Prompt-GoogleId([string]$prompt, [string]$current) {
    while ($true) {
        $input = Prompt-Secret "$prompt`n(Current: $current)"
        if ($input -eq "") { return $current }
        if (Validate-GoogleClientId $input) { return $input }
        Write-Host "Invalid Google Client ID format. Expected like: 1234567890-abcde.apps.googleusercontent.com" -ForegroundColor Yellow
    }
}

$clientCurrent = (Get-Content "$root\client\.env" | Select-String -Pattern '^VITE_GOOGLE_CLIENT_ID=' | ForEach-Object { $_.ToString().Split('=')[1].Trim() } ) -join ''
$serverCurrent = (Get-Content "$root\server\.env" | Select-String -Pattern '^GOOGLE_CLIENT_ID=' | ForEach-Object { $_.ToString().Split('=')[1].Trim() } ) -join ''

$viteId = Prompt-GoogleId "Enter VITE_GOOGLE_CLIENT_ID (press Enter to keep current)" $clientCurrent
if ($viteId -ne $clientCurrent) {
    (Get-Content "$root\client\.env") -replace 'VITE_GOOGLE_CLIENT_ID=.*', "VITE_GOOGLE_CLIENT_ID=$viteId" | Set-Content "$root\client\.env"
    Write-Host "Updated client/.env"
}

$goId = Prompt-GoogleId "Enter GOOGLE_CLIENT_ID for server (press Enter to keep current)" $serverCurrent
if ($goId -ne $serverCurrent) {
    (Get-Content "$root\server\.env") -replace 'GOOGLE_CLIENT_ID=.*', "GOOGLE_CLIENT_ID=$goId" | Set-Content "$root\server\.env"
    Write-Host "Updated server/.env"
}

# Generate JWT_SECRET if placeholder present
$serverEnv = Get-Content "$root\server\.env"
if ($serverEnv -match 'JWT_SECRET=replace_with_') {
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $jwt = [Convert]::ToBase64String($bytes)
    $serverEnv = $serverEnv -replace 'JWT_SECRET=.*', "JWT_SECRET=$jwt"
    $serverEnv | Set-Content "$root\server\.env"
    Write-Host "Generated and updated JWT_SECRET in server/.env"
} else {
    Write-Host "server/.env has JWT_SECRET — leaving unchanged"
}

if ($StartDocker) {
    Write-Host "Starting Docker Compose..."
    docker compose up --build
}

Write-Host "Done. For Windows users it's recommended to use WSL or Git Bash if you need POSIX compatibility."