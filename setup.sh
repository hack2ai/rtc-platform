#!/bin/bash
set -e
echo ""
echo "=============================================="
echo "  RTC Platform — Setup Script"
echo "=============================================="
echo ""

if ! command -v node &>/dev/null; then echo "❌ Node.js not found. Install from https://nodejs.org"; exit 1; fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then echo "❌ Node.js 18+ required (found v$NODE_VER)"; exit 1; fi
echo "✅ Node.js $(node -v)"

echo ""
echo "📦 Installing backend dependencies..."
cd backend
if [ ! -f .env ]; then cp .env.example .env; echo "⚠️  Created backend/.env — FILL IN YOUR FIREBASE CREDENTIALS"; fi
npm install --silent
echo "✅ Backend ready"

echo ""
echo "📦 Installing frontend dependencies..."
cd ../frontend
if [ ! -f .env.local ]; then cp .env.example .env.local; echo "⚠️  Created frontend/.env.local — FILL IN YOUR FIREBASE CONFIG"; fi
npm install --silent
echo "✅ Frontend ready"

cd ..
echo ""
echo "=============================================="
echo "  ✅ Setup complete!"
echo "=============================================="
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Fill in backend/.env with your Firebase Admin SDK credentials"
echo "2. Fill in frontend/.env.local with your Firebase web config"
echo "3. Terminal 1: cd backend && npm run dev"
echo "4. Terminal 2: cd frontend && npm run dev"
echo "5. Open http://localhost:3000"
echo ""
