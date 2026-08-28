#!/usr/bin/env bash
set -euo pipefail

printf '\n\033[36mRTC Platform development launcher\033[0m\n\n'

command -v node >/dev/null 2>&1 || { echo 'Node.js 18+ is required: https://nodejs.org/'; exit 1; }

if [[ ! -f backend/.env ]]; then
  cp backend/.env.example backend/.env
  echo 'Created backend/.env — fill in Firebase Admin credentials before starting.'
fi

if [[ ! -f frontend/.env.local ]]; then
  cp frontend/.env.example frontend/.env.local
  echo 'Created frontend/.env.local — fill in Firebase web configuration before using Firebase features.'
fi

if [[ ! -d backend/node_modules ]]; then (cd backend && npm install); fi
if [[ ! -d frontend/node_modules ]]; then (cd frontend && npm install); fi

(cd backend && npm run dev) &
BACKEND_PID=$!
(cd frontend && npm run dev) &
FRONTEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo 'Frontend: http://localhost:3000'
echo 'Backend:  http://localhost:8080'
echo 'Health:   http://localhost:8080/health'
wait
