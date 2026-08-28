# RTC Platform

> A production-minded real-time communication platform built with Next.js, Express, TypeScript, Firebase, and WebRTC.

[![CI](https://github.com/hack2ai/rtc-platform/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hack2ai/rtc-platform/actions/workflows/ci-cd.yml)

RTC Platform provides browser-based meetings with authentication, real-time chat, screen sharing, a collaborative whiteboard, file sharing, recording, meeting management, and admin controls.

## Highlights

- 🎥 WebRTC video/audio meetings with STUN/TURN support
- 🔐 Firebase Authentication with Email/Password and Google sign-in
- 💬 Real-time meeting chat, reactions, typing indicators, and read receipts
- 🖥️ Screen sharing and meeting controls
- 🧑‍🤝‍🧑 Waiting room, host approval, participant moderation, and meeting locking
- 📝 Collaborative whiteboard with Firebase-backed synchronization
- 📁 Secure file sharing through Firebase Storage
- ⏺️ Browser-side meeting recording with MediaRecorder
- 📊 Meeting history and analytics surfaces
- 🛡️ Helmet, CORS, rate limiting, validation, XSS protection, and Firebase rules
- 🐳 Docker support for local/container deployments
- 🚀 GitHub Actions workflow for CI and optional Vercel/Render deployments

## Architecture

```text
┌─────────────────────── Browser ───────────────────────┐
│ Next.js 14 + React + Tailwind + Redux Toolkit         │
│       │                  │                 │           │
│       ▼                  ▼                 ▼           │
│ Firebase Web SDK     REST API          WebRTC P2P     │
│ Auth/Firestore/      │                 Media + Data   │
│ Storage              ▼                                │
└──────────────────────┼────────────────────────────────┘
                       │
                       ▼
             Express + TypeScript API
                       │
                       ▼
              Firebase Admin SDK

       Firestore also acts as WebRTC signaling
       STUN/TURN provides NAT traversal support
```

## Repository layout

```text
rtc-platform/
├── backend/                 # Express + TypeScript API
├── frontend/                # Next.js web application
├── firebase/                # Firestore/Storage rules and indexes
├── .github/workflows/       # CI/CD automation
├── docker-compose.yml
├── setup.sh
└── README.md
```

## Requirements

- Node.js 20+
- npm 10+
- A Firebase project with Authentication, Firestore, and Storage enabled
- Docker Desktop (optional)
- A TURN server for reliable WebRTC connectivity across restrictive networks (recommended for production)

## Quick start

### 1. Clone

```bash
git clone https://github.com/hack2ai/rtc-platform.git
cd rtc-platform
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill the files with your Firebase and application settings. **Never commit real credentials.** The repository ignores `.env` runtime files.

### 3. Start the API

```bash
cd backend
npm install
npm run dev
```

The API listens on `http://localhost:8080` by default.

### 4. Start the web app

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Firebase setup

1. Create a Firebase project.
2. Enable **Authentication** and configure Email/Password and Google providers.
3. Create a **Firestore** database.
4. Enable **Storage**.
5. Install the Firebase CLI and authenticate:

```bash
npm install -g firebase-tools
firebase login
```

6. From the repository root, deploy the included rules and indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

For production, review the Firebase rules against your organization's identity, retention, and access requirements before deployment.

## Docker

```bash
cp backend/.env.example backend/.env
# Fill backend/.env with Firebase Admin credentials.
# Add the NEXT_PUBLIC_* values required by the frontend build.

docker compose up --build
```

Then visit `http://localhost:3000`.

## Environment variables

### Backend

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime environment |
| `PORT` | API listening port |
| `FRONTEND_URL` | Allowed frontend origin for CORS |
| `JWT_SECRET` | Application signing secret |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account email |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin private key |
| `FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `TURN_SERVER` | Optional TURN server URL |
| `TURN_USERNAME` | Optional TURN username |
| `TURN_CREDENTIAL` | Optional TURN credential |

### Frontend

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web SDK API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase authentication domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Web app ID |

Firebase Web configuration values are intended for client-side use; Firebase Admin service-account credentials are **server-only**.

## CI/CD

The GitHub Actions workflow validates the backend build/tests and frontend production build on pushes to `main`/`develop` and pull requests targeting `main`. Optional deployment jobs target Render and Vercel when the required repository secrets are configured.

Required deployment secrets:

- `RENDER_BACKEND_SERVICE_ID`
- `RENDER_API_KEY`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Security checklist

- Use a strong, unique `JWT_SECRET`.
- Store Firebase Admin credentials in your hosting provider's secret manager.
- Configure a real TURN service for production WebRTC reliability.
- Review Firestore and Storage rules for your exact authorization model.
- Restrict CORS to the deployed frontend origin.
- Keep dependencies and GitHub Actions dependencies updated.

## Development workflow

```bash
# Backend
cd backend
npm install
npm run build
npm test

# Frontend
cd frontend
npm install
npm run build
npm test
```

## License

No license has been selected yet. Add a `LICENSE` file before distributing this project under an open-source license.

## Status

🚧 **Active development** — the architecture and deployment scaffolding are in place; production hardening and feature-level testing should be completed before handling real users or sensitive meetings.
