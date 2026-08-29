$ErrorActionPreference = 'Stop'
$Root = (Get-Location).Path

Write-Host "RTC Platform development launcher" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 18+ is required. Install from https://nodejs.org/" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required and was not found on PATH." }

if (-not (Test-Path "$Root\backend\.env")) {
  Copy-Item "$Root\backend\.env.example" "$Root\backend\.env"
  Write-Warning "Created backend\.env. Add your Firebase Admin credentials for API features."
}
if (-not (Test-Path "$Root\frontend\.env.local")) {
  Copy-Item "$Root\frontend\.env.example" "$Root\frontend\.env.local"
  Write-Warning "Created frontend\.env.local. Add your Firebase web config for authentication."
}

# Pick the first active private IPv4 address so the same launcher works across Wi-Fi networks.
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.IPAddress -match '^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)'
  } |
  Sort-Object InterfaceMetric, PrefixLength |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $lanIp) { $lanIp = '127.0.0.1' }

# Use a DNS hostname for LAN development so Firebase OAuth can authorize it.
$lanHost = if ($lanIp -eq '127.0.0.1') { 'localhost' } else { "$lanIp.nip.io" }

# Keep the client on one origin: browser -> frontend hostname -> API hostname.
$frontendEnvPath = "$Root\frontend\.env.local"
$frontendEnv = Get-Content -LiteralPath $frontendEnvPath -ErrorAction SilentlyContinue
if (-not $frontendEnv) { $frontendEnv = @() }
$frontendEnv = @($frontendEnv | Where-Object {
  $_ -notmatch '^NEXT_PUBLIC_APP_URL=' -and
  $_ -notmatch '^NEXT_PUBLIC_APP_HOST=' -and
  $_ -notmatch '^NEXT_PUBLIC_API_URL='
})
$frontendEnv += "NEXT_PUBLIC_APP_URL=http://$lanHost`:3000"
$frontendEnv += "NEXT_PUBLIC_APP_HOST=$lanHost"
$frontendEnv += "NEXT_PUBLIC_API_URL=http://$lanHost`:8080/api"
$frontendEnv | Set-Content -LiteralPath $frontendEnvPath -Encoding UTF8

# Allow the same LAN hostname in the backend development CORS policy.
$backendEnvPath = "$Root\backend\.env"
$backendEnv = Get-Content -LiteralPath $backendEnvPath -ErrorAction SilentlyContinue
if (-not $backendEnv) { $backendEnv = @() }
$backendEnv = @($backendEnv | Where-Object { $_ -notmatch '^FRONTEND_URL=' -and $_ -notmatch '^CORS_ORIGINS=' })
$backendEnv += "FRONTEND_URL=http://$lanHost`:3000"
$backendEnv += "CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://$lanHost`:3000"
$backendEnv | Set-Content -LiteralPath $backendEnvPath -Encoding UTF8

if (-not (Test-Path "$Root\backend\node_modules")) { Push-Location "$Root\backend"; npm install; Pop-Location }
if (-not (Test-Path "$Root\frontend\node_modules")) { Push-Location "$Root\frontend"; npm install; Pop-Location }

$backendCommand = "Set-Location '$Root\backend'; npm run dev 2>&1 | Tee-Object -FilePath '$Root\backend\dev.log'"
$frontendCommand = "Set-Location '$Root\frontend'; npm run dev -- -H 0.0.0.0 2>&1 | Tee-Object -FilePath '$Root\frontend\dev.log'"

Write-Host "Starting backend on http://$lanHost`:8080 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCommand
Start-Sleep -Seconds 3

Write-Host "Checking backend health..." -ForegroundColor Yellow
$healthy = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}

if ($healthy) {
  Write-Host "Backend is healthy." -ForegroundColor Green
} else {
  Write-Warning "Backend did not become healthy. Check backend\dev.log for the exact error."
}

Write-Host "Starting frontend on http://$lanHost`:3000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCommand
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Frontend (LAN): http://$lanHost`:3000" -ForegroundColor Cyan
Write-Host "Backend  (LAN): http://$lanHost`:8080" -ForegroundColor Cyan
Write-Host "Health:         http://$lanHost`:8080/health" -ForegroundColor Cyan
Write-Host "Logs:           backend\dev.log / frontend\dev.log" -ForegroundColor DarkGray
Write-Host "Firebase: authorize $lanHost in Authentication > Settings > Authorized domains for Google sign-in from another device." -ForegroundColor Yellow
