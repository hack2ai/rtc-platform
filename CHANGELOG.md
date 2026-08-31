# Changelog

All notable changes to RTC Platform are documented here.

## [1.0.0] — 2026-08-31

### Added

- MIT license for the repository.
- Production-oriented README and release documentation.
- Authentication, meetings, collaboration, chat, file sharing, moderation, and WebRTC/screen-sharing capabilities.
- GitHub Actions CI/CD validation for frontend and backend.

### Improved

- Hardened authentication and API error handling.
- Improved same-origin API proxy and development CORS handling.
- Reduced unnecessary Firestore reads in authentication and meeting history flows.
- Improved meeting signaling and WebRTC recovery behavior.
- Consolidated the meeting route around the canonical meeting client.

### Release notes

This release is the internship submission release candidate for RTC Platform. Production deployments should provide secure Firebase Admin credentials and a TURN service for reliable WebRTC connectivity across restrictive networks.

[1.0.0]: https://github.com/hack2ai/rtc-platform/releases/tag/v1.0.0
