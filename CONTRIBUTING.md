# Contributing to RTC Platform

Thanks for contributing. RTC Platform contains a browser client, REST API, Firebase rules, and WebRTC signaling/media behavior, so focused changes and explicit validation are especially important.

## Before you start

1. Read `README.md` and `docs/ARCHITECTURE.md`.
2. Create a focused branch from `main`.
3. Do not commit `.env`, service-account JSON, private keys, build output, or local logs.

## Development workflow

### Backend

```bash
cd backend
npm install
npm run typecheck
npm run build
npm test
```

### Frontend

```bash
cd frontend
npm install
npm run typecheck
npm run build
npm test
```

For changes involving WebRTC, also perform a manual browser test with the target desktop/mobile browsers. A successful TypeScript build is not sufficient to prove peer media connectivity.

## Pull requests

Keep pull requests small enough to review. A good PR should explain:

- what changed and why;
- how the change was tested;
- any configuration or migration steps;
- known limitations or follow-up work.

Use conventional commit-style messages when practical, for example:

```text
fix: handle remote media track replacement
feat: add participant moderation controls
docs: improve local development setup
chore: update CI checks
```

Do not include secrets, real user data, or private meeting media in issues or pull requests.

## WebRTC changes

When changing media or signaling code, document the expected behavior for:

- initial camera and microphone publication;
- remote `track` events;
- ICE candidate exchange;
- reconnect/connection state handling;
- screen-share start and stop;
- device or permission failures.

## Review expectations

CI must remain green. Changes to Firebase rules, authentication, CORS, file access, or WebRTC signaling should receive extra scrutiny because they affect security and interoperability.
