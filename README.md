# RTC Platform

> A production-minded real-time collaboration workspace built with Next.js, React, TypeScript, Express, Firebase, and WebRTC.

[![CI](https://github.com/hack2ai/rtc-platform/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hack2ai/rtc-platform/actions/workflows/ci-cd.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

RTC Platform is a browser-based collaboration workspace for private meetings. It combines authenticated meeting rooms, real-time chat, WebRTC media, screen sharing, shared files, a collaborative workspace, moderation controls, and deployment scaffolding in one repository.

## Product goals

- Reliable browser-to-browser audio/video communication
- Fast, understandable meeting UX across desktop and mobile browsers
- Secure authentication and Firebase-backed collaboration data
- Clear separation between browser configuration and server-only credentials
- Reproducible development and CI workflows

## Core capabilities

| Area | Capability |
|---|---|
| Meetings | Create, join, lock, schedule, and manage rooms |
| Media | WebRTC audio/video with STUN/TURN configuration |
| Screen sharing | Browser screen capture and track replacement |
| Chat | Real-time meeting messages and collaboration surfaces |
| Moderation | Waiting room, host approval, participant controls |
| Data | Firebase Authentication, Firestore, and Storage |
| API | Express + TypeScript REST API |
| Frontend | Next.js 14 + React + Tailwind CSS |
| Deployment | Docker, GitHub Actions, Vercel/Render scaffolding |

## Architecture

```text
                         RTC Platform

 ┌──────────────────────── Browser ────────────────────────┐
 │ Next.js 14 / React / TypeScript / Tailwind / Redux     │
 │                                                        │
 │  Auth & data ───────────► Firebase Web SDK             │
 │  REST calls ─────────────► Next.js API proxy           │
 │  Meeting media ──────────► WebRTC peer connections     │
 │  Signaling ──────────────► Firestore signaling docs    │
 └────────────────────────────────────────────────────────┘
                     │                  │
                     ▼                  ▼
             Express API          STUN / TURN
             TypeScript           NAT traversal
                     │
                     ▼
              Firebase Admin SDK
                     │
            ┌────────┴────────┐
            ▼                 ▼
        Firestore          Storage
```

### Repository layout

```text
rtc-platform/
├── backend/                     # Express + TypeScript API
├── frontend/                    # Next.js application
├── firebase/                    # Firestore and Storage rules/indexes
├── .github/
│   ├── workflows/               # CI/CD automation
│   ├── ISSUE_TEMPLATE/          # Issue forms/templates
│   ├── CODEOWNERS               # Review ownership
│   └── pull_request_template.md
├── docs/                        # Architecture and development docs
├── docker-compose.yml
├── setup.sh
├── start-dev.ps1
├── start-dev.sh
├── LICENSE
├── CHANGELOG.md
└── README.md
```

## Prerequisites

- Node.js 20+
- npm 10+
- A Firebase project with Authentication, Firestore, and Storage enabled
- Docker Desktop (optional)
- A TURN provider for production WebRTC reliability across restrictive networks

## Local development

### 1. Clone the repository

```bash
git clone https://github.com/hack2ai/rtc-platform.git
cd rtc-platform
```

### 2. Configure environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill in the required Firebase and application values. **Never commit runtime `.env` files or Firebase Admin credentials.**

### 3. Install dependencies

```bash
cd backend
npm install
cd ../frontend
npm install
```

### 4. Start the backend

```bash
cd backend
npm run dev
```

The API listens on `http://localhost:8080` by default.

### 5. Start the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`.

For LAN/device testing, use the repository's development helper scripts where appropriate.

## Validation commands

### Backend

```bash
cd backend
npm run typecheck
npm run build
npm test
```

### Frontend

```bash
cd frontend
npm run typecheck
npm run build
npm test
```

The CI workflow runs the backend type-check/build/test and the frontend type-check/build/test paths.

## Firebase setup

1. Create a Firebase project.
2. Enable Authentication and configure the required sign-in providers.
3. Create a Firestore database.
4. Enable Firebase Storage.
5. Install and authenticate with the Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
```

6. Deploy rules and indexes from the repository root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Review security rules before production deployment and align them with your organization's identity and retention requirements.

## Environment configuration

### Backend

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime environment |
| `PORT` | API port |
| `FRONTEND_URL` | Allowed frontend origin for CORS |
| `JWT_SECRET` | Server-side signing secret |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account email |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin private key |
| `FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `TURN_SERVER` | Optional TURN server URL(s) |
| `TURN_USERNAME` | Optional TURN username |
| `TURN_CREDENTIAL` | Optional TURN credential |

### Frontend

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Local/direct API base URL for development |
| `NEXT_PUBLIC_APP_URL` | Public application URL used for invite links |
| `NEXT_PUBLIC_APP_HOST` | Development host/origin configuration |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web SDK configuration |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase authentication domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Web app ID |

Firebase Web configuration is designed to be client-visible. Firebase Admin service-account credentials are server-only and must remain outside source control.

## WebRTC notes

RTC Platform uses Firestore as its signaling transport and browser WebRTC for media. STUN is required for ICE discovery, while a properly configured TURN service is strongly recommended for production and mobile/corporate-network reliability.

WebRTC behavior should be tested independently from application API connectivity. A successful page load or chat session does not by itself prove that peer media negotiation and ICE connectivity are healthy.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the intended separation of concerns.

## Security and privacy

- Keep Firebase Admin credentials and other server secrets in a secret manager.
- Restrict CORS to the deployed frontend origin.
- Use a unique, strong `JWT_SECRET` where applicable.
- Review Firestore and Storage rules before production use.
- Configure TURN credentials securely; never hard-code them into client source.
- Do not commit `.env`, `.env.local`, service-account JSON, private keys, or generated build artifacts.

Report security issues privately according to [`SECURITY.md`](SECURITY.md).

## CI/CD

GitHub Actions validates the repository on pushes to `main`/`develop` and pull requests targeting `main`.

Deployment jobs for Render and Vercel are intentionally conditional and run only when the corresponding repository secrets are configured.

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Small, focused changes with clear validation steps are preferred.

## Project status

🚧 **Release candidate — v1.0.0.** Core authentication, meeting, API, collaboration, and deployment scaffolding is in place. Production WebRTC interoperability should still be validated across the target browsers, devices, and network environments.

## License

RTC Platform is licensed under the [MIT License](LICENSE).

## Release

The v1.0.0 release notes are documented in [`CHANGELOG.md`](CHANGELOG.md). GitHub Releases can be published from the repository's **Releases** page using the `v1.0.0` tag.
