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

if (-not (Test-Path "$Root\backend\node_modules")) { Push-Location "$Root\backend"; npm install; Pop-Location }
if (-not (Test-Path "$Root\frontend\node_modules")) { Push-Location "$Root\frontend"; npm install; Pop-Location }

$backendCommand = "Set-Location '$Root\backend'; npm run dev 2>&1 | Tee-Object -FilePath '$Root\backend\dev.log'"
$frontendCommand = "Set-Location '$Root\frontend'; npm run dev 2>&1 | Tee-Object -FilePath '$Root\frontend\dev.log'"

Write-Host "Starting backend on http://localhost:8080 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCommand
Start-Sleep -Seconds 3

Write-Host "Checking backend health..." -ForegroundColor Yellow
$healthy = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $response = Invoke-WebRequest -Uri 'http://localhost:8080/health' -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}

if ($healthy) {
  Write-Host "Backend is healthy." -ForegroundColor Green
} else {
  Write-Warning "Backend did not become healthy. Check backend\dev.log for the exact error."
}

Write-Host "Starting frontend on http://localhost:3000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCommand
Start-Sleep -Seconds 2

Write-Host "" 
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:8080" -ForegroundColor Cyan
Write-Host "Health:   http://localhost:8080/health" -ForegroundColor Cyan
Write-Host "Logs:     backend\dev.log / frontend\dev.log" -ForegroundColor DarkGray
