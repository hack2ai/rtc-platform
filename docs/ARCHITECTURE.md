# Architecture

## System boundaries

RTC Platform is split into four primary layers:

1. **Frontend** — Next.js/React UI, browser media capture, Firebase Web SDK, and REST API client.
2. **Backend** — Express/TypeScript API responsible for authenticated application operations and Firebase Admin access.
3. **Firebase** — Authentication, Firestore data/signaling, and Storage.
4. **WebRTC infrastructure** — STUN/TURN services used by browsers for ICE candidate discovery and NAT traversal.

## Request flow

```text
Browser
  │
  ├── Firebase Web SDK ──────────────► Auth / Firestore / Storage
  │
  ├── REST API ─► Next.js proxy ─────► Express API ─► Firebase Admin
  │
  └── WebRTC media ◄───────────────► Remote browser
                    ▲
                    │
              Firestore signaling
```

## Meeting lifecycle

A participant resolves the meeting code, authenticates, joins the meeting through the API, and loads the current participant set. WebRTC peer connections are then established between active participants using signaling messages stored under the meeting's Firestore signaling collection.

The media plane is browser-to-browser; application API traffic and signaling remain separate from the actual audio/video media path.

## WebRTC responsibilities

WebRTC code should explicitly handle:

- local audio/video acquisition;
- peer connection creation and lifecycle;
- SDP offer/answer exchange;
- ICE candidate exchange and buffering;
- `track` events and remote stream attachment;
- connection state and ICE state transitions;
- camera/microphone enablement;
- screen-share start/stop using track replacement where supported.

WebRTC failures should be logged with enough context to distinguish signaling failures from ICE/network failures and media-permission failures.

## Configuration principles

- Browser-visible Firebase Web configuration is not a substitute for server authorization.
- Server credentials belong only in backend environment/secret stores.
- Production browser traffic should use the frontend's public origin and same-origin API proxy when required by deployment topology.
- CORS should allow only the intended frontend origins.
- TURN credentials must never be hard-coded into client source.

## Scaling considerations

The current design uses a mesh of peer connections, which is straightforward for small meetings but becomes increasingly expensive as participant count grows. A future large-scale deployment should evaluate an SFU architecture rather than extending the mesh indefinitely.
