$ErrorActionPreference = 'Stop'

Write-Host "RTC Platform development launcher" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 18+ is required. Install it from https://nodejs.org/"
}

if (-not (Test-Path "backend\.env")) {
  Copy-Item "backend\.env.example" "backend\.env"
  Write-Warning "Created backend\.env. Fill in Firebase Admin credentials before starting the backend."
}

if (-not (Test-Path "frontend\.env.local")) {
  Copy-Item "frontend\.env.example" "frontend\.env.local"
  Write-Warning "Created frontend\.env.local. Fill in Firebase web configuration before using Firebase features."
}

if (-not (Test-Path "backend\node_modules")) { Push-Location backend; npm install; Pop-Location }
if (-not (Test-Path "frontend\node_modules")) { Push-Location frontend; npm install; Pop-Location }

Write-Host "Starting backend on http://localhost:8080 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', 'Set-Location "$PWD\backend"; npm run dev'

Start-Sleep -Seconds 2
Write-Host "Starting frontend on http://localhost:3000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', 'Set-Location "$PWD\frontend"; npm run dev'

Write-Host "" 
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend:  http://localhost:8080" -ForegroundColor Cyan
Write-Host "Health:   http://localhost:8080/health" -ForegroundColor Cyan
